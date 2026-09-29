-- Regression test for supabase/migrations/20260927000100_listing_attributes.sql.
--
-- Three things must hold: `size_class` is service-role only, exactly like `lucky`
-- (supabase/tests/lucky_is_service_role_only.test.sql is the model this borrows its shape from);
-- `pokeball` / `costume` / `purified` are ordinary seller-writable columns on an open listing with no offers
-- yet; and once a chat exists, changing `purified` is refused by `guard_listing_update` the same way changing
-- `lucky` or `shiny` already is.
--
-- Fixture (supabase/seed.sql): listing b…004 belongs to EmberVale (a…005), is `open`, and has zero chats —
-- the same listing the lucky test uses, and for the same reason (nothing here can trip the guard). Listing
-- b…001 belongs to DriftCoral (a…001) and already has chat c…001 on it, so it is used for the guard case.
begin;
select plan(8);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— fixture sanity ———
select is(
  (select purified from public.listings where id = 'b0000000-0000-4000-8000-000000000004'),
  false, 'fixture: EmberVale''s listing starts not purified');
select is(
  (select count(*) from public.chats where listing_id = 'b0000000-0000-4000-8000-000000000004'),
  0::bigint, 'and has zero chats, so the guard cannot fire on it yet');

-- ——— size_class is service-role only ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');   -- EmberVale, seller of b...004
set local role authenticated;
select throws_ok(
  $$ update public.listings set size_class = 'XL' where id = 'b0000000-0000-4000-8000-000000000004' $$,
  '42501', null,
  'authenticated cannot update size_class, even on their own open listing');

-- ——— the seller CAN set pokeball / costume / purified while no offers exist yet ———
select lives_ok(
  $$ update public.listings set pokeball = 'ultra', costume = true, purified = true
      where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'the seller can set pokeball / costume / purified on their own open, offer-free listing');
select is(
  (select row(pokeball, costume, purified) from public.listings where id = 'b0000000-0000-4000-8000-000000000004'),
  row('ultra'::public.pokeball, true, true),
  'and all three values land');
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
select lives_ok(
  $$ update public.listings set notes = 'pgTAP touched this' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'while an unrelated column on the same listing still updates fine');
reset role;

select * from finish();
rollback;
