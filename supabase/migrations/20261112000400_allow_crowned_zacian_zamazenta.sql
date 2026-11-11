-- Allow Crowned Sword Zacian and Crowned Shield Zamazenta to be listed, wanted and offered.
--
-- THE DECISION (the owner's, 2026-11-12). The project now lets players list and trade Crowned Sword Zacian
-- (888, `CROWNED_SWORD`) and Crowned Shield Zamazenta (889, `CROWNED_SHIELD`). The pinned game master carries
-- no `isTradable` on the `ZACIAN_CROWNED_SWORD` and `ZAMAZENTA_CROWNED_SHIELD` templates, so it marks them
-- untradable: this is a deliberate override in the opposite direction to Pecharunt's (game master untradable,
-- app tradable; Pecharunt is game master tradable, app untradable). It is recorded as two entries in
-- `TRADABILITY_OVERRIDES` (scripts/pokedex-source.ts), which is what lets the Pokédex generator's tradability
-- cross-check keep passing. This migration only states the owner's decision to list them. It makes no claim
-- about how those forms behave in the game.
--
-- WHAT CHANGES. Only the form list of `public.is_creature_untradable`. 20261018000100 added (888,
-- 'CROWNED_SWORD') and (889, 'CROWNED_SHIELD') to it; this migration removes exactly those two pairs and
-- changes nothing else, so the list again matches `UNTRADABLE_FORM_COMBINATIONS` in constants/untradable.ts
-- (`constants/pokedex.test.ts` compares the three `-- UNTRADABLE_*` lines of the NEWEST migration that defines
-- the function with that file, so the tags and the one-line-per-list layout below must stay as they are).
-- The mythical list and the species list are untouched, and Hero Zacian and Hero Zamazenta (the default forms)
-- were never on the rule.
--
-- THE TRIGGERS NEED NO CHANGE. `listings_tradable_guard` (insert, and update of pokemon_id, form_code, looking)
-- and `chat_messages_tradable_offer` call the function by name, so `create or replace` is enough: they read the
-- new rule on their next firing.
--
-- WHAT IS NOT RESTORED. 20261018000100 removed Crowned entries from `looking[]` and from chat offers while the
-- rule was in force. This migration does NOT bring them back: that data is gone, and a trainer who still wants
-- one adds it again. Nothing is rewritten in chat_messages, trainer_creatures or completed_trades.
--
-- GRANTS. `create or replace` keeps the function's ACL. 20261112000100 revoked EXECUTE on
-- public.is_creature_untradable from public, anon and authenticated, and that stays in place, so this
-- migration adds no grant or revoke.
--
-- APPLYING IT. Order does not matter for correctness. Client first: the app lets a player pick a Crowned form
-- while the database still refuses it with `untradable_pokemon_listed`, an error the app already maps, so the
-- player sees a refusal, not a crash. Database first: harmless, the app simply has not offered the forms yet.
--
-- IDEMPOTENT. `create or replace` can be run any number of times, and section 2 selects nothing once no
-- listing of those two species is still flagged.

-- ===== 1. The rule =====
-- The same function as in 20261018000100, byte for byte, except that the form combinations lose
-- (888, 'CROWNED_SWORD') and (889, 'CROWNED_SHIELD'):
--   UNTRADABLE_FORM_COMBINATIONS   (646, 'WHITE'), (646, 'BLACK'), (800, 'DUSK_MANE'), (800, 'DAWN_WINGS'), (800, 'ULTRA')
--   UNTRADABLE_MYTHICAL_IDS        unchanged (1025 Pecharunt is on it)
--   UNTRADABLE_SPECIES_IDS         unchanged ({718,890})
-- `coalesce`: a null form code makes the row comparison null, and `false or null` is null, not false.
create or replace function public.is_creature_untradable(p_pokemon_id integer, p_form_code text default null)
returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(
       p_pokemon_id = any ('{151,251,385,386,489,490,491,492,493,494,647,648,649,719,720,721,801,802,807,893,1025}'::integer[]) -- UNTRADABLE_MYTHICAL_IDS
    or p_pokemon_id = any ('{718,890}'::integer[]) -- UNTRADABLE_SPECIES_IDS
    or (p_pokemon_id, p_form_code) in ((646, 'WHITE'), (646, 'BLACK'), (800, 'DUSK_MANE'), (800, 'DAWN_WINGS'), (800, 'ULTRA')) -- UNTRADABLE_FORM_COMBINATIONS
  , false)
$$;

-- ===== 2. Existing listings: clear the flag the old rule set =====
-- Section 3 of 20261018000100 set `listings.untradable` on every listing OF a newly untradable creature, so a
-- Crowned Sword Zacian listing is flagged today (hosted has exactly one). The flag is server-owned and is not
-- recomputed by any trigger when only the rule changes, so it is recomputed here from the rule itself. That is
-- deliberately a recomputation, not a blanket `untradable = false`: a Hero listing that was flagged for any
-- other reason keeps its flag. The statement is limited to the two species and to rows that are flagged, and
-- it touches no frozen or guarded column: `untradable` is outside `guard_listing_update`'s frozen tuple and
-- outside `listings_tradable_guard`'s `update of` columns, so neither trigger fires on it, even for a listing
-- that already has chats.
update public.listings
   set untradable = public.is_creature_untradable(pokemon_id, form_code)
 where untradable
   and pokemon_id in (888, 889);
