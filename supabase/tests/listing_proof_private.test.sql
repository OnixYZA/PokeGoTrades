-- Regression test for supabase/migrations/20260927000200_listing_proof_private.sql.
--
-- `listing_proof_private` must be readable by the listing's own seller and nobody else, and it must have no
-- client write path at all (insert/update/delete): only the OCR worker, running as service_role, ever writes
-- it. The fixture proof and its catch location are inserted here directly (no seeded listing_proofs rows
-- exist yet), the same way profile_proofs.test.sql inserts its own fixture rows rather than relying on seed.sql.
--
-- Fixture (supabase/seed.sql): listing b…001 belongs to DriftCoral (a…001). PixelKite (a…00a) is the BUYER on
-- chat c…003, also against b…001 — deliberately, not a bystander: `listing_proofs_read` lets PixelKite see
-- the proof row itself (it inherits `listings_read`, which any non-blocked trainer satisfies for an open
-- listing), so the "0 rows" case below proves the seller-only policy on `listing_proof_private` holds even
-- for a trainer already inside an active chat on that exact listing, not just for a total stranger.
begin;
select plan(7);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— fixture setup: one proof on b...001, with a private catch location ———
insert into public.listing_proofs (id, listing_id, kind, storage_path) values (
  'e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'appraisal',
  'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal');
insert into public.listing_proof_private (proof_id, catch_location) values (
  'e0000000-0000-4000-8000-000000000001', 'Community park, Adyar — near the east gate');

select is(
  (select count(*) from public.listing_proof_private
    where proof_id = 'e0000000-0000-4000-8000-000000000001'),
  1::bigint, 'fixture: the private row exists');

-- ——— the listing's own seller can read it ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');   -- DriftCoral, seller of b...001
set local role authenticated;
select is(
  (select count(*) from public.listing_proof_private
    where proof_id = 'e0000000-0000-4000-8000-000000000001'),
  1::bigint, 'the listing''s seller sees the private row');
select is(
  (select catch_location from public.listing_proof_private
    where proof_id = 'e0000000-0000-4000-8000-000000000001'),
  'Community park, Adyar — near the east gate', 'and reads the exact catch location');
reset role;

-- ——— a non-seller gets zero rows, never an error — even a buyer already chatting about this listing ———
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');   -- PixelKite: buyer on chat c...003, still not the seller
set local role authenticated;
select is(
  (select count(*) from public.listing_proof_private
    where proof_id = 'e0000000-0000-4000-8000-000000000001'),
  0::bigint, 'a non-seller gets 0 rows, not an error, from listing_proof_private');

-- ——— no client write path exists at all: column grants deny insert/update/delete outright (42501) ———
select throws_ok(
  $$ insert into public.listing_proof_private (proof_id, catch_location)
     values ('e0000000-0000-4000-8000-000000000002', 'nice try') $$,
  '42501', null, 'authenticated cannot insert into listing_proof_private');
select throws_ok(
  $$ update public.listing_proof_private set catch_location = 'nice try'
      where proof_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor update an existing row');
select throws_ok(
  $$ delete from public.listing_proof_private where proof_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor delete one, even the seller''s own');
reset role;

select * from finish();
rollback;
