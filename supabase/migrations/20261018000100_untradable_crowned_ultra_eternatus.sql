-- Untradable Pokémon, second pass: the Crowned wolves, Ultra Necrozma and all of Eternatus.
--
-- 20260929000100_enforce_untradable_pokemon.sql made `public.is_creature_untradable` the one rule that the
-- listing and offer triggers consult. This migration only extends that rule's data. It adds nothing new to
-- enforce:
--   * Zacian in the Crowned Sword form (888, `CROWNED_SWORD`)
--   * Zamazenta in the Crowned Shield form (889, `CROWNED_SHIELD`)
--   * Necrozma in the Ultra form (800, `ULTRA`), beside the two fused forms it already lists
--   * Eternatus (890) as a WHOLE SPECIES, so every form is untradable, `ETERNAMAX` included. This is a species
--     rule, not a form pair: a form code spelled differently (or added to the game later) is covered without
--     another migration.
-- Zacian and Zamazenta in their default (Hero) form stay tradable, and so does Necrozma outside its fused and
-- Ultra forms. That is why these three are FORM COMBINATIONS, not species ids.
--
-- Pecharunt (1025) is NOT a change. It is already in the Mythical list below and stays there. The game master
-- data marks it as tradable; the product owner decided to treat it as untradable anyway, and that decision
-- overrides the game master here. Do not "correct" it by removing 1025: `constants/untradable.ts` carries the same
-- override, and `constants/pokedex.test.ts` fails if the two lists drift.
--
-- THE TS COPY. `constants/untradable.ts` (`isPokemonUntradable`, re-exported by `constants/pokedex.ts`) is the client's copy, and `constants/pokedex.test.ts`
-- compares its three lists with the three lines tagged `-- UNTRADABLE_*` in the NEWEST migration that defines
-- `public.is_creature_untradable`, which is this file. The function below therefore keeps the original's exact
-- layout, one tagged line per list. Only the list contents differ from the original definition.
--
-- WHAT DOES NOT NEED TO CHANGE
--   * `private.creature_json_is_untradable`, `private.guard_listing_tradable` (trigger `listings_tradable_guard`)
--     and `private.guard_offer_tradable` (trigger `chat_messages_tradable_offer`) all reach the rule by calling
--     `public.is_creature_untradable` by name, and a `language sql` / plpgsql body is resolved when it runs, not
--     when it is created. `create or replace` of the one function is enough: the triggers stay bound, and no
--     grant, owner or ACL on the function changes (`create or replace` keeps them).
--   * The error codes (`untradable_pokemon_listed` / `_wanted` / `_offered`) are mapped in `lib/rpc-errors.ts`
--     already, so this adds no client string.
--   * `formal_offer_is_valid` stays untouched, for the reason the original gives: `completed_trades.buyer_gave` is
--     checked with it, so tightening it would break `confirm_trade` on an offer accepted before the rule grew.
--
-- WHAT IS DELIBERATELY LEFT ALONE (the owner's decision: the rule is forward-looking for these)
--   * chat_messages.offer rows that already name one of these creatures. Messages are immutable and the offer
--     trigger is insert-only, so an old offer stays in its chat, and the seller can still accept it
--     (`lock_trade` only checks that the message is an offer). Nothing new can be sent.
--   * trainer_creatures (Arsenal / Wishlist). There is no trigger on that table, before or after this migration.
--   * completed_trades. They are history.
--   * A listing that is OF one of these creatures and already has chats is not edited, only flagged (section 3).
--     `guard_listing_update` freezes `pokemon_id` and `form_code` once a chat exists, so the creature cannot be
--     swapped under the buyers in those chats, and this migration does not try to.
--
-- IDEMPOTENT, AND HARMLESS ON AN EMPTY DATABASE. `create or replace` can be run any number of times. Section 2's
-- `where exists` selects nothing once the entries are gone, and section 3's `and not untradable` selects nothing
-- once the flag is set. On a database with no listings, both statements update zero rows. On a local
-- `supabase db reset` migrations run BEFORE seed.sql, so these two updates see an empty table, and the rule
-- itself is then enforced on the seed's own inserts. That is why seed.sql's listing b…001 had to become a
-- default-form Zacian: a Crowned Sword one would be refused by `listings_tradable_guard` at load time.

-- ===== 1. The rule =====
-- The same function as in 20260929000100, with these list changes and nothing else:
--   UNTRADABLE_SPECIES_IDS         {718}  ->  {718,890}      (+ Eternatus, every form)
--   UNTRADABLE_FORM_COMBINATIONS   + (800, 'ULTRA'), (888, 'CROWNED_SWORD'), (889, 'CROWNED_SHIELD')
--   UNTRADABLE_MYTHICAL_IDS        unchanged (1025 Pecharunt is on it, see the header)
-- `coalesce`: a null form code makes the row comparison null, and `false or null` is null, not false.
create or replace function public.is_creature_untradable(p_pokemon_id integer, p_form_code text default null)
returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(
       p_pokemon_id = any ('{151,251,385,386,489,490,491,492,493,494,647,648,649,719,720,721,801,802,807,893,1025}'::integer[]) -- UNTRADABLE_MYTHICAL_IDS
    or p_pokemon_id = any ('{718,890}'::integer[]) -- UNTRADABLE_SPECIES_IDS
    or (p_pokemon_id, p_form_code) in ((646, 'WHITE'), (646, 'BLACK'), (800, 'DUSK_MANE'), (800, 'DAWN_WINGS'), (800, 'ULTRA'), (888, 'CROWNED_SWORD'), (889, 'CROWNED_SHIELD')) -- UNTRADABLE_FORM_COMBINATIONS
  , false)
$$;

-- ===== 2. Existing listings: drop newly untradable entries from looking[] =====
-- Same statement as 20260929000100 section 2, now matching the wider rule. No buyer can ever fulfil such a want,
-- and the chat trigger refuses any offer of one, so each entry is removed and the remaining entries keep their
-- order. `looking` is outside `guard_listing_update`'s frozen tuple (name, pokemon_id, catch_year, lucky, shiny,
-- trade_type, iv_*, bg, loc, purified, costume, pokeball, form_code, costume_code), so this is not a
-- bait-and-switch edit even on a listing that already has chats. `listings_tradable_guard` fires too (the
-- statement updates `looking`), and it passes: it only rejects a `looking` that still holds an untradable
-- entry, and the new one holds none.
update public.listings l
   set looking = coalesce((
         select jsonb_agg(t.e order by t.ord)
           from jsonb_array_elements(l.looking) with ordinality as t(e, ord)
          where not private.creature_json_is_untradable(t.e)), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(l.looking) e where private.creature_json_is_untradable(e));

-- ===== 3. Existing listings OF a newly untradable creature: close them to offers =====
-- `open_offer` already refuses an `untradable` listing, so flagging is enough to stop new chats. A listing that
-- already has chats keeps its creature (it is frozen, see the header) and its existing chats and any lock or
-- confirmation carry on; only new offers stop. The statement does not touch `pokemon_id`, `form_code` or
-- `looking`, so `listings_tradable_guard` (an `update of` trigger on those three) does not fire, and
-- `guard_listing_update` passes because `untradable` is not in its frozen tuple either.
update public.listings set untradable = true
 where public.is_creature_untradable(pokemon_id, form_code) and not untradable;

-- ===== Applying it =====
-- Order does not matter for correctness, because this changes data and one function body but no column, type,
-- RPC signature or error code:
--   * Database first: an app build that predates the matching `constants/untradable.ts` still lets a trainer pick
--     Crowned Sword Zacian, and the insert is then refused with `untradable_pokemon_listed`, which
--     `lib/rpc-errors.ts` already turns into a sentence.
--   * Client first: its pickers refuse the creature up front, and the database simply has not caught up yet.
--   1. supabase db push                                                  (hosted: never `db reset`)
--   2. supabase gen types typescript --linked > lib/database.types.ts   (no schema change, so no diff is expected)
--   3. Local: npx supabase start -x logflare,vector, then npx supabase db reset
