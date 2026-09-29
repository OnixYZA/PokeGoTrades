-- Untradable Pokémon: a listing, its looking[] ("wanted in return") list and a formal offer can never name
-- a creature that cannot change hands in Pokémon GO.
--
-- The rule. `isPokemonUntradable` in constants/pokedex.ts is the client copy, and constants/pokedex.test.ts
-- fails if the three lines tagged `-- UNTRADABLE_*` below drift from it:
--   * Mythicals, except Meltan (808) and Melmetal (809)
--   * Zygarde (718), in every form
--   * the fused forms: White/Black Kyurem (646) and Dusk Mane/Dawn Wings Necrozma (800)
-- Shadow Pokémon are untradable too. Nothing here needs to say so: `listings.bg <> 'shadow'` already refuses
-- them, and no creature jsonb shape has a shadow flag.
--
-- Enforcement uses one BEFORE trigger per table. It is not a CHECK, and not only a test inside open_offer:
--   * In-chat offers are plain `chat_messages` inserts (lib/api/chats.ts `sendChatMessage`) that never go
--     through `open_offer`, so an RPC-only test would miss them. A trigger on the table covers both paths.
--     `open_offer` inherits it because it inserts through the same table, and the raise rolls back the chat
--     it created a moment earlier.
--   * A trigger can raise a stable `PT400` message that the client maps to a sentence (lib/rpc-errors.ts).
--     A CHECK only surfaces as a generic 23514.
--   * `formal_offer_is_valid` is deliberately left alone. `completed_trades.buyer_gave` is checked with it
--     too, so tightening it would make `confirm_trade` fail on an offer accepted before this migration.
-- Neither trigger re-checks a value that did not change, so an unrelated update to an older row still goes
-- through.
--
-- `listings.untradable` stays a moderator flag. Because of the rejection below, no new listing can need it for
-- this reason. Section 3 sets it only on rows that predate this migration.

-- ===== 1. The rule =====
-- `coalesce`: a null form code makes the row comparison null, and `false or null` is null, not false.
create function public.is_creature_untradable(p_pokemon_id integer, p_form_code text default null)
returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(
       p_pokemon_id = any ('{151,251,385,386,489,490,491,492,493,494,647,648,649,719,720,721,801,802,807,893,1025}'::integer[]) -- UNTRADABLE_MYTHICAL_IDS
    or p_pokemon_id = any ('{718}'::integer[]) -- UNTRADABLE_SPECIES_IDS
    or (p_pokemon_id, p_form_code) in ((646, 'WHITE'), (646, 'BLACK'), (800, 'DUSK_MANE'), (800, 'DAWN_WINGS')) -- UNTRADABLE_FORM_COMBINATIONS
  , false)
$$;

-- The same rule applied to a creature jsonb (`CreatureRef` / `FormalOffer`). Malformed input returns `false`
-- here: BEFORE triggers run ahead of CHECK constraints, and a bad shape must fail with the table's own
-- `creature_ref_is_valid` / `formal_offer_is_valid` error, not with a cast error raised from this function.
create function private.creature_json_is_untradable(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when jsonb_typeof(p->'pokemonId') is distinct from 'number' or (p->>'pokemonId') !~ '^[1-9][0-9]{0,3}$' then false
    else public.is_creature_untradable((p->>'pokemonId')::integer, p->>'formCode')
  end
$$;
-- No execute grants: only the security-definer trigger functions below call these two functions.

-- ===== 2. Existing listings: drop untradable entries from looking[] =====
-- When this was written, the hosted project had two such entries, on seed listings b…002 (Deoxys) and b…006
-- (Mew). No buyer can ever fulfil such a want, and the chat trigger below will refuse any offer of one, so each
-- entry is removed and the remaining entries keep their order. `looking` is outside guard_listing_update's
-- frozen tuple, so this is not a bait-and-switch edit, even on a listing that already has offers.
update public.listings l
   set looking = coalesce((
         select jsonb_agg(t.e order by t.ord)
           from jsonb_array_elements(l.looking) with ordinality as t(e, ord)
          where not private.creature_json_is_untradable(t.e)), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(l.looking) e where private.creature_json_is_untradable(e));

-- ===== 3. Existing listings OF an untradable creature: close them to offers =====
-- The hosted project had none when this was written. This is kept so that any older database also ends up
-- with no listing that `open_offer` would still accept (it already refuses `untradable` listings).
update public.listings set untradable = true
 where public.is_creature_untradable(pokemon_id, form_code) and not untradable;

-- ===== 4. listings: refuse an untradable creature or looking[] entry =====
create function private.guard_listing_tradable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or (new.pokemon_id, new.form_code) is distinct from (old.pokemon_id, old.form_code))
     and public.is_creature_untradable(new.pokemon_id, new.form_code) then
    raise sqlstate 'PT400' using message = 'untradable_pokemon_listed';
  end if;
  if (tg_op = 'INSERT' or new.looking is distinct from old.looking)
     and jsonb_typeof(new.looking) = 'array'
     and exists (select 1 from jsonb_array_elements(new.looking) e where private.creature_json_is_untradable(e)) then
    raise sqlstate 'PT400' using message = 'untradable_pokemon_wanted';
  end if;
  return new;
end $$;
create trigger listings_tradable_guard before insert or update of pokemon_id, form_code, looking on public.listings
  for each row execute function private.guard_listing_tradable();

-- ===== 5. chat_messages: refuse a formal offer of an untradable creature =====
-- Insert-only: messages are immutable (no UPDATE grant or policy).
create function private.guard_offer_tradable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.creature_json_is_untradable(new.offer) then
    raise sqlstate 'PT400' using message = 'untradable_pokemon_offered';
  end if;
  return new;
end $$;
create trigger chat_messages_tradable_offer before insert on public.chat_messages
  for each row when (new.offer is not null) execute function private.guard_offer_tradable();
