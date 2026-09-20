-- Regression test for supabase/migrations/20260920000200_lock_lucky_to_service_role.sql.
--
-- Before the fix, `listings.lucky` was in the insert AND update column grants for `authenticated`, so any
-- seller could set the "Guaranteed Lucky" badge themselves and skip the OCR appraisal pipeline entirely
-- (workers/ocr/src/process.ts `grantLucky` is meant to be the only writer). Verified against the local
-- stack before patching: `update public.listings set lucky = true` as `authenticated` returned UPDATE 1.
--
-- Privilege checks run before RLS, so the denials below are column-grant failures (42501), independent of
-- which policy would have matched. The positive cases are the other half of the fix: revoking the grant
-- must not break ordinary listing creation or edits, and must not lock the service role out.
--
-- Fixture (supabase/seed.sql): listing b…004 belongs to EmberVale (a…005), is `open`, has lucky = false and
-- zero chats — so `private.guard_listing_update` (which freezes trade fields once an offer exists) stays
-- out of the way and the update paths below test the grant, not the trigger.
begin;
select plan(9);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— fixture sanity ———
select is(
  (select lucky from public.listings where id = 'b0000000-0000-4000-8000-000000000004'),
  false, 'fixture: EmberVale''s listing starts not lucky');

-- ——— the escalation itself ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');
set local role authenticated;

select throws_ok(
  $$ update public.listings set lucky = true where id = 'b0000000-0000-4000-8000-000000000004' $$,
  '42501', null,
  'a seller cannot UPDATE lucky on their own open listing');

select throws_ok(
  $$ insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type, lucky)
     values ('b0000000-0000-4000-8000-0000000000f1', 'pgTAP Lucky Probe', 25, 2020, 25,
             'East Tambaram', 'Unregistered (Standard)', true) $$,
  '42501', null,
  'nor smuggle lucky in at INSERT time');

-- Even `lucky = false` is refused: PostgREST sends every key in the body as a column, which is why the
-- client had to stop sending the field at all (lib/api/listings.ts `toFields`), not just stop sending true.
select throws_ok(
  $$ insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type, lucky)
     values ('b0000000-0000-4000-8000-0000000000f2', 'pgTAP Lucky Probe', 25, 2020, 25,
             'East Tambaram', 'Unregistered (Standard)', false) $$,
  '42501', null,
  'including when the value sent is false');

-- ——— the fix must not break ordinary use ———
select lives_ok(
  $$ update public.listings set notes = 'pgTAP touched this'
      where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'the other granted columns still update normally');

select lives_ok(
  $$ insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type)
     values ('b0000000-0000-4000-8000-0000000000f3', 'pgTAP Lucky Probe', 25, 2020, 25,
             'East Tambaram', 'Unregistered (Standard)') $$,
  'and a listing that simply omits lucky is created as usual');

select is(
  (select lucky from public.listings where id = 'b0000000-0000-4000-8000-0000000000f3'),
  false, 'which the column default leaves not lucky');

reset role;

-- ——— the OCR worker's path is untouched ———
-- `grantLucky` connects with SUPABASE_SERVICE_ROLE_KEY; service_role bypasses grants and RLS.
set local role service_role;
select lives_ok(
  $$ update public.listings set lucky = true where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'the service role can still award the badge');
select is(
  (select lucky from public.listings where id = 'b0000000-0000-4000-8000-000000000004'),
  true, 'and the write lands');
reset role;

select * from finish();
rollback;
