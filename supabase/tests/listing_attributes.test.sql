-- Regression test for supabase/migrations/20260927000100_listing_attributes.sql.
--
-- Also covers migrations 20261103000200_listings_cp_and_size_grant.sql and 20261103000300_listings_is_gigantamax.sql.
--
-- What must hold: `pokeball` / `costume` / `purified` / `cp` / `size_class` / `is_gigantamax` are ordinary
-- seller-writable columns on an open listing with no offers yet; `is_gigantamax` defaults to false; `cp` is
-- range-checked (listings_cp_range, 10..10000); and once a chat exists, changing `purified`, `cp`, `size_class` or
-- `is_gigantamax` is refused by `guard_listing_update` the same way changing `lucky` or `shiny` already is. Which
-- species may be G-Max is checked client-side only (`canGigantamax`); the database stores the flag as given.
--
-- INVERTED ASSERTION: this file used to assert `authenticated` could NOT update `size_class` (42501), because
-- 20260927000100 made it service-role-only like `lucky`. Migration 20261103000200 reverses that decision (sellers
-- now declare size at listing time), so that assertion now expects success. `lucky` is unchanged and still
-- service-role-only; that is covered by supabase/tests/lucky_is_service_role_only.test.sql.
--
-- Fixture (supabase/seed.sql): listing b…005 belongs to IronGlass (a…006), is `open`, is not purified (seed.sql
-- marks only b…004 and b…006 purified) and has zero chats — nothing here can trip the guard. (b…004 was used
-- until seed.sql started setting it purified; the asserted "starts not purified -> becomes purified" needs a
-- listing that really starts un-purified.) Listing b…001 belongs to DriftCoral (a…001) and already has chat
-- c…001 on it, so it is used for the guard case.
begin;
select plan(18);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— fixture sanity ———
select is(
  (select purified from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  false, 'fixture: IronGlass''s listing starts not purified');
select is(
  (select count(*) from public.chats where listing_id = 'b0000000-0000-4000-8000-000000000005'),
  0::bigint, 'and has zero chats, so the guard cannot fire on it yet');

-- ——— is_gigantamax (20261103000300) defaults to false on a row inserted without it ———
select is(
  (select is_gigantamax from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  false, 'a listing inserted without is_gigantamax (the seed) has it false by default');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'listings' and column_name = 'is_gigantamax'),
  'false', 'the column default is false');

-- ——— the seller CAN set pokeball / costume / purified / cp / size_class while no offers exist yet ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000006');   -- IronGlass, seller of b...005
set local role authenticated;
select lives_ok(
  $$ update public.listings set pokeball = 'ultra', costume = true, purified = true, cp = 2500, size_class = 'XL'
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can set pokeball / costume / purified / cp / size_class on their own open, offer-free listing (size_class was 42501 before 20261103000200)');
select is(
  (select row(pokeball, costume, purified, cp, size_class)
     from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  row('ultra'::public.pokeball, true, true, 2500, 'XL'::public.pokemon_size),
  'and all five values land');

-- ——— cp range: listings_cp_range = 10..10000 ———
select throws_ok(
  $$ update public.listings set cp = 5 where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', 'new row for relation "listings" violates check constraint "listings_cp_range"',
  'cp = 5 is rejected by listings_cp_range');
select throws_ok(
  $$ update public.listings set cp = 10001 where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', 'new row for relation "listings" violates check constraint "listings_cp_range"',
  'cp = 10001 is rejected by listings_cp_range');
select lives_ok(
  $$ update public.listings set cp = 10 where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'cp = 10 (lower bound) is accepted');
select lives_ok(
  $$ update public.listings set cp = 10000 where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'cp = 10000 (upper bound) is accepted');
select lives_ok(
  $$ update public.listings set is_gigantamax = true where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can set is_gigantamax on their own open, offer-free listing');
select is(
  (select is_gigantamax from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  true, 'and it lands');
reset role;

-- ——— guard: purified changing after a chat exists is rejected, like lucky/shiny already are ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');   -- DriftCoral, seller of b...001 (chat c...001 exists)
set local role authenticated;
select isnt(
  (select count(*) from public.chats where listing_id = 'b0000000-0000-4000-8000-000000000001'), 0::bigint,
  'fixture: b...001 already has at least one chat');
select throws_ok(
  $$ update public.listings set purified = true where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'the guard rejects purified changing once a chat exists, exactly like lucky/shiny');
select throws_ok(
  $$ update public.listings set cp = 3251 where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'the guard rejects cp changing once a chat exists');
select throws_ok(
  $$ update public.listings set size_class = 'XL' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'the guard rejects size_class changing once a chat exists');
select throws_ok(
  $$ update public.listings set is_gigantamax = true where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'the guard rejects is_gigantamax changing once a chat exists');
select lives_ok(
  $$ update public.listings set notes = 'pgTAP touched this' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'while an unrelated column on the same listing still updates fine');
reset role;

select * from finish();
rollback;
