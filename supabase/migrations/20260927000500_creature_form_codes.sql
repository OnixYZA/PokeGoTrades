-- Creature form codes: national dex id + PokeMiners form code, replacing synthetic PokéAPI form ids.
--
-- Sprites are served from our own Supabase `sprites` Storage bucket, keyed
-- `pokemon/{dex}[.f{FORM}][.c{COSTUME}][.s].png` (lib/sprite-url.ts `spriteObjectKey`). That key only
-- ever accepts a TRUE national dex id (the id `constants/pokedex.ts` can look up) plus an optional
-- PokeMiners form/costume code (`[A-Z0-9_]+`, e.g. `CROWNED_SWORD`, `ALOLA`). `listings.pokemon_id`,
-- `looking[].pokemonId` and `creature_ref_is_valid` instead grew a handful of PokéAPI's synthetic
-- per-FORM ids (10188 = zacian-crowned, 10001 = deoxys-attack, ...) — ids with no entry in
-- `constants/pokedex.ts`, so the client can never resolve a sprite for them and falls back to the `?`
-- placeholder tile. This migration adds `form_code` (and, for symmetry with `spriteObjectKey`'s costume
-- layer, `costume_code`, even though nothing seeds one yet), backfills every known synthetic id to its
-- true dex id + form code, and tightens every validator so a synthetic id can never be written again.
--
-- Backfill mapping (verified against the bucket — see the sprite pipeline notes for how these were
-- confirmed to exist, including their `.s` shiny counterparts):
--   10188 -> 888 / CROWNED_SWORD   (Crowned Sword Zacian)
--   150 + form 'Genesis Armor'    -> form_code 'A'  (Armored Mewtwo; dex id was already correct)
--   10001 -> 386 / ATTACK          (Attack Forme Deoxys)
--   10246 -> 484 / ORIGIN          (Origin Forme Palkia)
--   10079 -> 384 / MEGA            (Mega Rayquaza)
--   10078 -> 383 / PRIMAL          (Primal Groudon)
--
-- "Apex" Lugia/Ho-Oh (249/250) are deliberately left unmapped: `249/250.fS` exists in the bucket but we
-- cannot confirm it is the GO-only "Apex" variant rather than something else, so those listings keep
-- form_code null and fall back to the base-species sprite (AGENTS.md: never hallucinate game data).

-- ===== 1. New columns =====
-- Nullable: most listings/looking entries have no form at all, or are never a costume. Constrained to
-- the same bare-token shape lib/sprite-url.ts's `normalizeCode`/`CODE_RE` accepts, so nothing can ever
-- be written here that `spriteObjectKey` would silently drop.
alter table public.listings
  add column form_code text check (form_code ~ '^[A-Z0-9_]{1,40}$'),
  add column costume_code text check (costume_code ~ '^[A-Z0-9_]{1,40}$');

-- Column grants (§2.1 pattern, ...000100_listing_attributes): seller-settable, like `costume`/`pokeball`.
grant insert (form_code, costume_code),
      update (form_code, costume_code)
  on public.listings to authenticated;

-- ===== 2. creature_ref_is_valid: allow formCode/costumeCode, tighten pokemonId to a true dex id =====
-- MUST run before the data fix (section 4): `listings.looking` carries
-- `check (creature_ref_array_is_valid(looking, 3))`, which calls this function with its DEFAULT key list.
-- The old default has no `formCode`, so rewriting looking[] under the old validator would violate that
-- check and abort the migration. Only rows actually written are re-checked, so tightening pokemonId here
-- does not trip on the synthetic ids still sitting in untouched rows until section 4 rewrites them.
create or replace function public.creature_ref_is_valid(
  p jsonb,
  p_allowed_keys text[] default array['name', 'pokemonId', 'hue', 'shiny', 'lucky', 'formCode', 'costumeCode']
) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when jsonb_typeof(p->'name')      is distinct from 'string' then false
    when jsonb_typeof(p->'pokemonId') is distinct from 'number' then false
    when jsonb_typeof(p->'hue')       is distinct from 'number' then false
    else char_length(p->>'name') between 1 and 40
      and (p->>'pokemonId') ~ '^[1-9][0-9]{0,3}$'      -- true national dex id (1-9999); no PokéAPI synthetic
                                                        -- form ids (e.g. 10188 zacian-crowned) — use formCode instead
      and (p->>'hue')::numeric between 0 and 360
      and coalesce(jsonb_typeof(p->'shiny'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p->'lucky'), 'boolean') = 'boolean'
      -- formCode/costumeCode: absent is fine (defaults the typeof check via coalesce); present must be a
      -- JSON string matching the same [A-Z0-9_]{1,40} bare-token shape spriteObjectKey accepts. A present
      -- JSON `null` is rejected (jsonb_typeof returns the non-null text 'null', which fails the 'string'
      -- check) rather than treated like absence — deliberate, since the client omits the key entirely for
      -- "no form/costume" and never sends an explicit null.
      and coalesce(jsonb_typeof(p->'formCode'), 'string') = 'string'
      and (p->>'formCode' is null or p->>'formCode' ~ '^[A-Z0-9_]{1,40}$')
      and coalesce(jsonb_typeof(p->'costumeCode'), 'string') = 'string'
      and (p->>'costumeCode' is null or p->>'costumeCode' ~ '^[A-Z0-9_]{1,40}$')
      and (select bool_and(k = any (p_allowed_keys)) from jsonb_object_keys(p) as k)
  end
$$;
-- create or replace keeps the existing `grant execute ... to authenticated, service_role` from
-- ...000100_extensions_enums_validators.sql. Changing p_allowed_keys' default VALUE is allowed under
-- CREATE OR REPLACE (only removing an existing default, or changing a parameter's name/type/order, is not).

-- ===== 3. formal_offer_is_valid: allow formCode/costumeCode in the offer shape too =====
create or replace function public.formal_offer_is_valid(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select public.creature_ref_is_valid(p, array['name', 'pokemonId', 'hue', 'shiny', 'lucky', 'formCode', 'costumeCode', 'iv', 'move'])
    and coalesce(jsonb_typeof(p->'iv'),   'string') = 'string' and coalesce(char_length(p->>'iv'),   0) <= 40
    and coalesce(jsonb_typeof(p->'move'), 'string') = 'string' and coalesce(char_length(p->>'move'), 0) <= 40
$$;

-- ===== 4. Data fix: rewrite synthetic PokéAPI form ids to dex id + form_code =====
-- `listings_guard` (private.guard_listing_update) raises `listing_has_offers` when pokemon_id changes on
-- a listing that already has a chat — a bait-and-switch guard. This is a one-time correction of an id
-- ENCODING (the creature the listing represents does not change, only how its id is spelled), not a
-- trade-relevant edit, so it is safe to run with the guard disabled for just this section.
alter table public.listings disable trigger listings_guard;

update public.listings set pokemon_id = 888, form_code = 'CROWNED_SWORD' where pokemon_id = 10188;

-- Armored Mewtwo already used the true dex id (150); it only needs the PokeMiners form code that
-- distinguishes it from base Mewtwo, since `pokemon_id` alone can't carry that.
update public.listings set form_code = 'A'
  where pokemon_id = 150 and form = 'Genesis Armor' and form_code is null;

-- looking[] entries carry the same synthetic ids. Rewrite each matching element in place, preserving
-- array order (`with ordinality` / `jsonb_agg(... order by ord)`), leaving every non-matching element
-- (including every listing whose looking[] has no synthetic id at all) untouched. The mapping lives in
-- exactly one place: this VALUES list.
with mapping (old_id, new_id, code) as (
  values (10001, 386, 'ATTACK'),          -- deoxys-attack
         (10246, 484, 'ORIGIN'),          -- palkia-origin
         (10079, 384, 'MEGA'),            -- rayquaza-mega
         (10078, 383, 'PRIMAL'),          -- groudon-primal
         (10188, 888, 'CROWNED_SWORD')    -- zacian-crowned (defensive: not known to appear in looking[] today)
),
affected as (
  select l.id from public.listings l
   where exists (select 1 from jsonb_array_elements(l.looking) e where (e->>'pokemonId')::int >= 10000)
),
rewritten as (
  select a.id,
         jsonb_agg(
           case when m.new_id is not null
                then t.e || jsonb_build_object('pokemonId', m.new_id, 'formCode', m.code)
                else t.e
           end order by t.ord
         ) as new_looking
    from affected a
    join public.listings l on l.id = a.id
    cross join lateral jsonb_array_elements(l.looking) with ordinality as t(e, ord)
    left join mapping m on m.old_id = (t.e->>'pokemonId')::int
   group by a.id
)
update public.listings l
   set looking = r.new_looking
  from rewritten r
 where r.id = l.id;

alter table public.listings enable trigger listings_guard;

-- ===== 5. Assertion: no synthetic (>= 10000) pokemon id survives anywhere =====
-- Fails the migration loudly, rather than leaving rows the tightened `creature_ref_is_valid` (above) /
-- `listings_pokemon_id_check` (below) would silently start rejecting on the next unrelated write. (An
-- unmapped synthetic id inside a rewritten looking[] already fails that UPDATE's own check in section 4.)
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.listings where pokemon_id >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.listings row(s) still have pokemon_id >= 10000', v_count;
  end if;

  select count(*) into v_count
    from public.listings l, jsonb_array_elements(l.looking) e
   where (e->>'pokemonId')::int >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.listings.looking element(s) still have pokemonId >= 10000', v_count;
  end if;

  select count(*) into v_count
    from public.trainer_creatures where (creature->>'pokemonId')::int >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.trainer_creatures row(s) still have pokemonId >= 10000', v_count;
  end if;

  select count(*) into v_count
    from public.chat_messages where offer is not null and (offer->>'pokemonId')::int >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.chat_messages.offer row(s) still have pokemonId >= 10000', v_count;
  end if;

  select count(*) into v_count
    from public.completed_trades where (seller_gave->>'pokemonId')::int >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.completed_trades.seller_gave row(s) still have pokemonId >= 10000', v_count;
  end if;

  select count(*) into v_count
    from public.completed_trades where buyer_gave is not null and (buyer_gave->>'pokemonId')::int >= 10000;
  if v_count > 0 then
    raise exception 'creature_form_codes: % public.completed_trades.buyer_gave row(s) still have pokemonId >= 10000', v_count;
  end if;
end $$;

-- ===== 6. Tighten listings.pokemon_id: true dex ids only, no PokéAPI synthetic form ids =====
-- Confirmed via pg_constraint against the hosted project: the original inline CHECK is auto-named
-- `listings_pokemon_id_check` (`pokemon_id between 1 and 99999`); `drop ... if exists` kept anyway as a
-- defensive no-op if that name is ever wrong. PokéAPI's synthetic per-form ids (zacian-crowned = 10188,
-- deoxys-attack = 10001, ...) start at 10001, so 9999 excludes all of them cleanly. Deliberately NOT
-- hardcoding today's national dex max (1025 as of this writing) into the constraint — nobody would
-- remember to bump it release over release, and 9999 already does the job this constraint exists for.
alter table public.listings drop constraint if exists listings_pokemon_id_check;
alter table public.listings add constraint listings_pokemon_id_check check (pokemon_id between 1 and 9999);

-- ===== 7. guard_listing_update: freeze form_code/costume_code once a chat exists, like pokemon_id already does =====
-- form_code/costume_code are creature-identity facts exactly like pokemon_id/form/shiny/lucky — changing
-- which form a listing represents after a buyer has already messaged is the same bait-and-switch the
-- existing frozen-fields tuple exists to block, so both new columns join it on both sides (new.*, old.*).
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.form, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball,
      new.form_code, new.costume_code)
     is distinct from
     (old.name, old.pokemon_id, old.form, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball,
      old.form_code, old.costume_code)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;

-- ===== 8. confirm_trade: carry form_code/costume_code into completed_trades.seller_gave =====
-- Copied verbatim from ...20260916000500_rpcs.sql (the only definition), except seller_gave's jsonb_build_object
-- now also merges in formCode/costumeCode when the listing has them, via jsonb_strip_nulls so a null
-- form_code/costume_code omits the key entirely rather than writing an explicit JSON null (matches how
-- shiny/lucky already always write real booleans, and how creature_ref_is_valid treats a present null
-- as invalid rather than "absent").
create or replace function public.confirm_trade(p_chat_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  v_listing_id uuid;
  v_listing    public.listings;
  v_lock       public.trade_locks;
  v_is_seller  boolean;
  v_trade_id   uuid;
  v_sibling    uuid;
begin
  select c.listing_id into v_listing_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null then raise sqlstate 'PT403' using message = 'not_participant'; end if;

  select * into v_listing from public.listings where id = v_listing_id for update;
  select * into v_lock from public.trade_locks
   where listing_id = v_listing_id and chat_id = p_chat_id for update;
  if not found then raise sqlstate 'PT409' using message = 'no_active_lock'; end if;    -- not the lock holder
  if v_uid not in (v_lock.seller_id, v_lock.buyer_id) then
    raise sqlstate 'PT403' using message = 'not_participant';
  end if;
  v_is_seller := (v_uid = v_lock.seller_id);

  -- idempotent retry: I already confirmed
  if (v_is_seller and v_lock.seller_confirmed_at is not null)
     or (not v_is_seller and v_lock.buyer_confirmed_at is not null) then
    return jsonb_build_object('state', 'awaiting_partner');
  end if;

  -- first confirmation of the pair
  if (v_is_seller and v_lock.buyer_confirmed_at is null)
     or (not v_is_seller and v_lock.seller_confirmed_at is null) then
    update public.trade_locks
       set seller_confirmed_at = case when v_is_seller then v_now else seller_confirmed_at end,
           buyer_confirmed_at  = case when v_is_seller then buyer_confirmed_at else v_now end
     where listing_id = v_listing_id;
    perform private.system_message(p_chat_id,
      case when v_is_seller then 'seller_confirmed' else 'buyer_confirmed' end::public.system_event,
      'One trainer confirmed the trade. Waiting for the other.');
    return jsonb_build_object('state', 'awaiting_partner');
  end if;

  -- second confirmation: finalize atomically
  insert into public.completed_trades (
    listing_id, chat_id, seller_id, buyer_id, seller_handle, buyer_handle, seller_gave, buyer_gave,
    trade_type, locked_at, seller_confirmed_at, buyer_confirmed_at, completed_at)
  select v_listing.id, p_chat_id, v_lock.seller_id, v_lock.buyer_id, ps.handle, pb.handle,
         jsonb_build_object('name', v_listing.name, 'pokemonId', v_listing.pokemon_id, 'hue', v_listing.hue,
                            'shiny', v_listing.shiny, 'lucky', v_listing.lucky)
           || jsonb_strip_nulls(jsonb_build_object('formCode', v_listing.form_code, 'costumeCode', v_listing.costume_code)),
         (select m.offer from public.chat_messages m where m.id = v_lock.accepted_offer_message_id),
         v_listing.trade_type, v_lock.locked_at,
         coalesce(v_lock.seller_confirmed_at, v_now), coalesce(v_lock.buyer_confirmed_at, v_now), v_now
    from public.profiles ps, public.profiles pb
   where ps.id = v_lock.seller_id and pb.id = v_lock.buyer_id
  returning id into v_trade_id;

  delete from public.trade_locks where listing_id = v_listing_id;
  update public.listings set status = 'completed', locked_at = null, completed_at = v_now where id = v_listing_id;
  update public.chats set status = 'completed', closed_at = v_now where id = p_chat_id;
  update public.chat_members set archived_at = v_now where chat_id = p_chat_id;      -- archived for both (archiveChat)

  for v_sibling in
    update public.chats set status = 'closed', closed_at = v_now
     where listing_id = v_listing_id and id <> p_chat_id and status = 'open'
    returning id
  loop
    perform private.system_message(v_sibling, 'closed_listing_completed', 'This listing was traded to another trainer.');
  end loop;

  update public.profiles set trades_count = trades_count + 1 where id in (v_lock.seller_id, v_lock.buyer_id);
  perform private.system_message(p_chat_id, 'completed', 'Trade completed.');
  return jsonb_build_object('state', 'completed', 'trade_id', v_trade_id);
end $$;
-- create or replace keeps the existing execute grants/revokes from ...20260916000500_rpcs.sql's own
-- `revoke ... from public, anon` / `grant ... to authenticated` block; nothing else in this migration
-- touches confirm_trade's permissions.
