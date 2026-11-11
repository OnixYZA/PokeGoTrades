-- Drop `listings.form`: `listings.form_code` is the only statement of a listing's form.
--
-- A listing carried its form twice: `form`, free text (`not null default 'Standard'`, 1-40 chars, written by
-- the seller's client), and `form_code`, a PokeMiners code (migration 20260927000500). Nothing tied the two
-- together, and they drifted: the seed said "Genesis Armor" beside `A`, "Frostmoves" and "Apex" beside null,
-- and "Standard" everywhere a creature simply had no form. Only `form_code` is something the rest of the
-- system can use: it picks the sprite (`lib/sprite-url.ts`), types the creature (`constants/pokedex.ts`),
-- feeds the type filter (`lib/api/type-filter.ts`), the untradable guard (`listings_tradable_guard`) and the
-- display label (`lib/format.ts` `creatureFormLabel`). A string only the seller's own screen understood could
-- never be correct in all of those places at once, so the column is removed instead of kept in sync.
--
-- WHAT DEPENDED ON THE COLUMN (found by grepping every migration, view, RPC, policy, trigger, grant, the
-- pgTAP suite, seed.sql and workers/ for the word `form`):
--   * `private.guard_listing_update` read `new.form` / `old.form` in its frozen-columns tuple. Its body is
--     plpgsql text, so Postgres does NOT track that dependency: dropping the column alone would succeed and
--     then fail EVERY later `update` on `listings` with 42703 (record "new" has no field "form"), including a
--     seller editing their own notes. It is recreated first, below, without `form`.
--   * The column-level `insert`/`update` grants to `authenticated` (20260916000400) and the
--     `char_length(form) between 1 and 40` check (20260916000200) are removed with the column by Postgres.
--   * Historical data fixes that mention `form` (20260927000100's `purified` backfill, 20260927000500's
--     Armored Mewtwo `form_code`) have already run; migrations are never re-run, so they stay as written.
--   * NOT dependent, verified: the views (`my_inbox`, `my_trade_history`, `pokemon_market_demand` name their
--     columns), every RPC (`open_offer`, `lock_trade`, `confirm_trade`, ... read listing fields by name, none
--     `form`; their `public.listings` row variables simply lose the field), every RLS policy, every trigger
--     (none is `update of form`), the indexes, realtime (listing broadcasts carry only id + status), the OCR
--     worker (it reads and writes only `lucky` / `size_class`) and the pgTAP suite (no test names `form`).
--
-- DEPLOY ORDER MATTERS. The app that is live today selects `form` in `lib/api/listings.ts` and, on create,
-- inserts it. The client that no longer does either must be out BEFORE this is applied; an older client
-- against a database without the column gets PostgREST 400 (feed) / PGRST204 (create).
--
-- WHAT IS LOST. `form` text that had no `form_code` beside it cannot be carried over (inventing a code would
-- break "never hallucinate game data"). The `raise notice` below lists exactly that, per distinct text and
-- count, so the loss is visible in the `supabase db push` output rather than silent. On the seed rows that is
-- "Frostmoves" (not a form at all; data/listings.ts and seed.sql now carry it as the listing's `notes`) and
-- "Apex" (a real Pokemon GO variant with no PokeMiners code, deliberately unmapped: see 20260927000500).
-- 'Standard' is the column default, i.e. "no form", so it is not reported.

-- ===== 1. guard_listing_update: the same frozen columns, minus `form` =====
-- This is the function exactly as 20260927000500 section 7 defines it (its latest definition: no later
-- migration redefines it), with `new.form` and `old.form` removed and nothing else changed: `form_code` and
-- `costume_code` still freeze once a chat exists, so the form a buyer saw cannot be swapped under them.
-- `create or replace` keeps the `listings_guard` trigger bound to it.
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball,
      new.form_code, new.costume_code)
     is distinct from
     (old.name, old.pokemon_id, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball,
      old.form_code, old.costume_code)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;

-- ===== 2. Report the text that is about to be discarded =====
-- A notice, not an exception: the known seed rows ("Frostmoves", "Apex") would abort the migration, and they
-- are exactly the losses this migration accepts. Guarded on the column still existing so a re-run is a no-op.
do $$
declare
  v_lost record;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'listings' and column_name = 'form') then
    for v_lost in execute
      'select form, count(*) as n from public.listings
        where form <> ''Standard'' and form_code is null
        group by form order by form'
    loop
      raise notice 'drop listings.form: % listing(s) had form % and no form_code; that text is discarded',
        v_lost.n, quote_literal(v_lost.form);
    end loop;
  end if;
end $$;

-- ===== 3. Drop the column =====
-- Also removes, with it, the column-level insert/update grants and the length check (see the header).
alter table public.listings drop column if exists form;

comment on column public.listings.form_code is
  'The listing''s form, and the ONLY statement of one: a PokeMiners form code ([A-Z0-9_]{1,40}, e.g. '
  'CROWNED_SWORD, ALOLA, A for Armored Mewtwo), null = the species'' default form. Displayed through '
  'creatureFormLabel (lib/format.ts), never as the raw code. Frozen once a chat exists (guard_listing_update). '
  'Replaces the free-text `form` column, dropped by migration 20261017000300.';

-- ===== Applying it =====
--   1. Ship the client that no longer reads or writes `listings.form` (this branch) to every channel that is
--      live: web deploy, and an EAS Update / store build for native.
--   2. supabase db push                                                  (hosted: never `db reset`)
--   3. supabase gen types typescript --linked > lib/database.types.ts   (gitignored, generated: `form` leaves
--                                                                          Row / Insert / Update)
--   4. npx tsc --noEmit && npx tsc -p e2e/tsconfig.json --noEmit         (nothing may still name `form`)
--   5. Optional, to keep the hosted seed listings in step with seed.sql (not done by this migration, since a
--      migration should not rewrite fixture content):
--        update public.listings set notes = 'Frostmoves'
--         where id = 'b0000000-0000-4000-8000-000000000005' and notes is null;
