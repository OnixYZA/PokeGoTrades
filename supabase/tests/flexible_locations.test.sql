-- Regression test for supabase/migrations/20261112000300_flexible_locations.sql.
--
-- What must hold: `listings.loc` is no longer a foreign key to the preset table, so any short place label is
-- accepted; `loc_key` is `lower(loc)`; and coordinate-like text is refused by the CHECK constraints on
-- `listings.loc` and `profile_private.safe_loc` even from an authenticated client (the DB backstop for the
-- client-side sanitizer in constants/locations.ts).
--
-- Fixture (supabase/seed.sql): listing b…005 belongs to IronGlass (a…006), is `open` and has zero chats, so
-- `guard_listing_update` does not freeze `loc`. IronGlass's own profile_private row carries safe_loc. No listings
-- are inserted (the security-hardening rate limit counts them).
begin;
select plan(22);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— structure ———
select is(
  (select count(*) from pg_constraint where conname = 'listings_loc_fkey'),
  0::bigint, 'listings_loc_fkey no longer exists');
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'listings_feed_key_idx'),
  1::bigint, 'listings_feed_key_idx exists');
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'listings_feed_idx'),
  0::bigint, 'listings_feed_idx is gone');

-- ——— the seller can use any place label ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000006');   -- IronGlass, seller of b...005
set local role authenticated;
select lives_ok(
  $$ update public.listings set loc = 'Puducherry' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can set loc to a city outside the old presets');
select lives_ok(
  $$ update public.listings set loc = 'Indiranagar, Bengaluru' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can set a free-text label');
select is(
  (select loc_key from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  'indiranagar, bengaluru', 'loc_key is lower(loc)');

-- ——— coordinate-like text is refused (keep in sync with COORDINATE_LIKE_SAMPLES in constants/locations.ts) ———
select throws_ok(
  $$ update public.listings set loc = '13.0012, 80.2565' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses "13.0012, 80.2565"');
select throws_ok(
  $$ update public.listings set loc = '13.0012,80.2565' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses "13.0012,80.2565"');
select throws_ok(
  $$ update public.listings set loc = '-33.8688 151.2093' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses "-33.8688 151.2093"');
select throws_ok(
  $$ update public.listings set loc = '12.9716; 77.5946' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses "12.9716; 77.5946"');
select throws_ok(
  $$ update public.listings set loc = '13.00123' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses "13.00123"');
select throws_ok(
  $$ update public.listings set loc = '13°00′N 80°15′E' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses degree notation');
select throws_ok(
  $$ update public.listings set loc = '7JFJ+2V Chennai' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses a plus code');
select throws_ok(
  $$ update public.listings set loc = 'geo:13.0,80.2' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses a geo: URI');
select throws_ok(
  $$ update public.listings set loc = 'Near 13.0012, 80.2565' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses a label with an embedded coordinate pair');

-- ——— shape ———
select throws_ok(
  format($$ update public.listings set loc = %L where id = 'b0000000-0000-4000-8000-000000000005' $$, repeat('x', 61)),
  '23514', null, 'listings.loc refuses 61 characters');
select throws_ok(
  $$ update public.listings set loc = ' Adyar' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses untrimmed text');
select throws_ok(
  $$ update public.listings set loc = '' where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'listings.loc refuses the empty string');

-- ——— profile_private.safe_loc (the owner's own row) ———
select lives_ok(
  $$ update public.profile_private set safe_loc = 'East Tambaram' where user_id = 'a0000000-0000-4000-8000-000000000006' $$,
  'the owner can set safe_loc to a place label');
select lives_ok(
  $$ update public.profile_private set safe_loc = null where user_id = 'a0000000-0000-4000-8000-000000000006' $$,
  'the owner can clear safe_loc');
select throws_ok(
  $$ update public.profile_private set safe_loc = '13.0012, 80.2565' where user_id = 'a0000000-0000-4000-8000-000000000006' $$,
  '23514', null, 'safe_loc refuses a coordinate pair');
select throws_ok(
  format($$ update public.profile_private set safe_loc = %L where user_id = 'a0000000-0000-4000-8000-000000000006' $$, repeat('x', 81)),
  '23514', null, 'safe_loc refuses 81 characters');
reset role;

select * from finish();
rollback;
