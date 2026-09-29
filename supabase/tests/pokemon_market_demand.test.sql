-- Regression test for supabase/migrations/20260927000300_pokemon_market_demand.sql.
--
-- Three behaviors the view's math rests on: it counts DISTINCT trainers, not rows (a trainer with both a
-- wishlist entry and a matching `looking[]` entry counts once); a withdrawn listing is neither supply nor
-- demand (not just "counts as zero" — no row at all is produced for a pokemon only a withdrawn listing
-- mentions); and shiny / non-shiny never share a row, even for the same pokemon_id.
--
-- All fixture rows use fictional pokemon_id values (55501-55599) that no seeded row in supabase/seed.sql
-- references, so every count below is fully determined by what this file inserts — no need to account for
-- seed.sql's existing arsenal/wishlist/listings entries. Queried with no role set (the pgTAP session's own
-- role, which bypasses RLS): this file is checking the view's GROUP BY / UNION / join logic, not RLS, and
-- `security_invoker` only changes which rows an *authenticated* caller sees, not the arithmetic being tested.
begin;
select plan(8);

-- ——— fixture: GraniteFox wants 55501 two ways (wishlist AND a listing's looking[], the latter with no
-- "shiny" key at all, exercising "missing shiny means false"); NoxTrainer wants it a third way. Two distinct
-- trainers, three demand rows. ———
insert into public.trainer_creatures (owner_id, list, creature, sort_order) values
  ('a0000000-0000-4000-8000-000000000003', 'wishlist',
   '{"name":"Test Mon A","pokemonId":55501,"hue":10,"shiny":false}', 0),   -- GraniteFox
  ('a0000000-0000-4000-8000-000000000004', 'wishlist',
   '{"name":"Test Mon A","pokemonId":55501,"hue":10,"shiny":false}', 0);   -- NoxTrainer

insert into public.listings (
  id, seller_id, name, pokemon_id, catch_year, hue, loc, trade_type, shiny, status, withdrawn_at, looking
) values
  -- GraniteFox's own listing (sells 55510, unrelated) ALSO wants 55501 via looking[] — same trainer as above.
  ('b0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000003',
   'pgTAP Demand Probe', 55510, 2020, 10, 'Velachery', 'Standard / Registered', false, 'open', null,
   '[{"name":"Test Mon A","pokemonId":55501,"hue":10}]'::jsonb),
  -- Supply side for pokemon_id=55502: one WITHDRAWN (must not count) and one OPEN (must count).
  ('b0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000006',
   'pgTAP Withdrawn Probe', 55502, 2020, 10, 'Velachery', 'Standard / Registered', false, 'withdrawn', now(),
   '[]'::jsonb),
  ('b0000000-0000-4000-8000-0000000000e3', 'a0000000-0000-4000-8000-000000000007',
   'pgTAP Open Supply Probe', 55502, 2020, 10, 'Velachery', 'Standard / Registered', false, 'open', null,
   '[]'::jsonb),
  -- Same pokemon_id (55503), one shiny listing and one non-shiny listing: must land in two separate rows.
  ('b0000000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000008',
   'pgTAP Shiny Probe', 55503, 2020, 10, 'Velachery', 'Standard / Registered', true, 'open', null, '[]'::jsonb),
  ('b0000000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000009',
   'pgTAP Nonshiny Probe', 55503, 2020, 10, 'Velachery', 'Standard / Registered', false, 'open', null, '[]'::jsonb),
  -- pokemon_id=55599: mentioned ONLY by a withdrawn listing. Must produce no row at all, not a 0/0 row.
  ('b0000000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-00000000000b',
   'pgTAP Withdrawn Only Probe', 55599, 2020, 10, 'Velachery', 'Standard / Registered', false, 'withdrawn', now(),
   '[]'::jsonb);

-- ——— distinct users, not rows: 3 demand rows (2 wishlist + 1 looking[]) but only 2 distinct trainers ———
select is(
  (select wanted_count from public.pokemon_market_demand where pokemon_id = 55501 and shiny = false),
  2, 'wanted_count de-dupes GraniteFox''s wishlist entry against their own looking[] entry');

-- ——— withdrawn listings are not supply: only VoidQuill's open probe counts, IronGlass''s withdrawn one does not ———
select is(
  (select offered_count from public.pokemon_market_demand where pokemon_id = 55502 and shiny = false),
  1, 'a withdrawn listing does not add to offered_count');

-- ——— shiny and non-shiny never merge into one row, even for the same pokemon_id ———
select is(
  (select count(*) from public.pokemon_market_demand where pokemon_id = 55503),
  2::bigint, 'shiny and non-shiny 55503 are two separate rows');
select is(
  (select offered_count from public.pokemon_market_demand where pokemon_id = 55503 and shiny = true),
  1, 'the shiny row counts only the shiny listing');
select is(
  (select offered_count from public.pokemon_market_demand where pokemon_id = 55503 and shiny = false),
  1, 'the non-shiny row counts only the non-shiny listing');

-- ——— demand_ratio = round(wanted / greatest(offered, 1), 2) ———
select is(
  (select demand_ratio from public.pokemon_market_demand where pokemon_id = 55501 and shiny = false),
  2.00::numeric(8, 2), '2 wanted / 0 offered (floored to 1) = 2.00');
select is(
  (select demand_ratio from public.pokemon_market_demand where pokemon_id = 55502 and shiny = false),
  0.00::numeric(8, 2), '0 wanted / 1 offered = 0.00');

-- ——— a pokemon only a withdrawn listing mentions is neither supply nor demand: no row, not a 0/0 row ———
select is(
  (select count(*) from public.pokemon_market_demand where pokemon_id = 55599),
  0::bigint, 'a withdrawn-only pokemon produces no row at all');

select * from finish();
rollback;
