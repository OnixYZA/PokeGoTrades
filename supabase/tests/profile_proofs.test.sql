-- Contract test for supabase/migrations/20260926000100_profile_proofs.sql: the profile_proofs table's RLS
-- (session must be permanent, path must be the caller's own, only one in-flight proof per trainer) and the
-- apply_profile_proof RPC (service-role-only; the verified path; the handle_taken collision path, which must
-- leave the losing trainer's own profile untouched).
--
-- This pgTAP session cannot perform a real Storage upload, so `pg_temp.put_object` inserts the `storage.objects`
-- row `private.profile_proof_object_exists` looks for directly, standing in for one.
--
-- Fixture (supabase/seed.sql): GraniteFox (a…0003) is used for the RLS cases below and has no other test's
-- dependencies on it. IronGlass (a…0006) is used for the verified RPC path. VoidQuill (a…0007, handle
-- 'VoidQuill', friend code '100000000007') attempts to steal AzureRift's (a…0002) handle 'AzureRift' for the
-- handle_taken path.
begin;
select plan(18);

create function pg_temp.act_as(p_uid uuid, p_anonymous boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anonymous)::text, true)
$$;

-- Stands in for the client's real Storage upload: a row `private.profile_proof_object_exists` will find.
create function pg_temp.put_object(p_uid uuid, p_id uuid) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('profile-proofs', p_uid::text || '/' || p_id::text, p_uid::text)
$$;

-- ——— fixture sanity (the handle_taken case below depends on this) ———
select is(
  (select handle from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'),
  'AzureRift', 'fixture: AzureRift''s handle is what the handle_taken case tries to steal');
select is(
  (select friend_code from public.profile_private where user_id = 'a0000000-0000-4000-8000-000000000007'),
  '100000000007', 'fixture: VoidQuill''s own friend code, before the attempt');

-- ——— RLS: an anonymous session cannot insert, even at its own correct path ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000003', true);   -- GraniteFox, anonymous session
set local role authenticated;
select throws_ok(
  $$ insert into public.profile_proofs (id, storage_path)
     values ('f0000000-0000-4000-8000-000000000001',
             'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'an anonymous session cannot insert a profile proof, even at its own correct path');
reset role;

-- ——— RLS: a path that is not <own uid>/<id> is refused ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');   -- GraniteFox, permanent session
set local role authenticated;
select pg_temp.put_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.profile_proofs (id, storage_path)
     values ('f0000000-0000-4000-8000-000000000002',
             'a0000000-0000-4000-8000-000000000099/f0000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'a storage_path not equal to <own uid>/<id> is refused');

-- ——— the matching own-path insert succeeds (scaffolding for the in-flight test below) ———
select lives_ok(
  $$ insert into public.profile_proofs (id, storage_path)
     values ('f0000000-0000-4000-8000-000000000002',
             'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000002') $$,
  'the matching own-path insert succeeds once the object exists');

-- ——— RLS: a second in-flight proof for the same trainer is 23505 ———
select pg_temp.put_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ insert into public.profile_proofs (id, storage_path)
     values ('f0000000-0000-4000-8000-000000000003',
             'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000003') $$,
  '23505', null,
  'a second in-flight proof for the same trainer collides on the partial unique index');
reset role;

-- ——— apply_profile_proof is service_role-only ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.apply_profile_proof('f0000000-0000-4000-8000-000000000002', 'Whatever123', '123456789099') $$,
  '42501', null,
  'authenticated cannot execute apply_profile_proof');
reset role;

-- ——— apply_profile_proof: verified path (IronGlass) ———
-- Forced back to a placeholder first, so the flip to handle_is_placeholder = false is actually exercised here
-- rather than already having happened when seed.sql gave IronGlass its handle.
update public.profiles set handle_is_placeholder = true where id = 'a0000000-0000-4000-8000-000000000006';
insert into public.profile_proofs (id, user_id, storage_path, ocr_status, ocr_extracted) values (
  'f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000006/f0000000-0000-4000-8000-000000000004',
  'processing', jsonb_build_object('claimedAt', now()));

set local role service_role;
select is(
  (select public.apply_profile_proof(
     'f0000000-0000-4000-8000-000000000004', 'IronGlassOcr', '135792468013')),
  'verified', 'a processing row with a free handle and friend code verifies');
reset role;

select is(
  (select handle from public.profiles where id = 'a0000000-0000-4000-8000-000000000006'),
  'IronGlassOcr', 'and profiles.handle is written');
select is(
  (select handle_is_placeholder from public.profiles where id = 'a0000000-0000-4000-8000-000000000006'),
  false, 'and handle_is_placeholder flips to false');
select is(
  (select friend_code from public.profile_private where user_id = 'a0000000-0000-4000-8000-000000000006'),
  '135792468013', 'and profile_private.friend_code is written');
select is(
  (select ocr_status from public.profile_proofs where id = 'f0000000-0000-4000-8000-000000000004'),
  'verified'::public.ocr_status, 'and the proof row itself settles to verified');
select is(
  (select ocr_extracted from public.profile_proofs where id = 'f0000000-0000-4000-8000-000000000004'),
  jsonb_build_object('handle', 'IronGlassOcr'), 'with just the handle recorded, not the friend code');

-- ——— apply_profile_proof: handle_taken leaves the losing trainer's own profile untouched (VoidQuill) ———
insert into public.profile_proofs (id, user_id, storage_path, ocr_status, ocr_extracted) values (
  'f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000007/f0000000-0000-4000-8000-000000000005',
  'processing', jsonb_build_object('claimedAt', now()));

set local role service_role;
select is(
  (select public.apply_profile_proof(
     'f0000000-0000-4000-8000-000000000005', 'AzureRift', '246813579024')),
  'handle_taken', 'stealing another trainer''s handle is refused as handle_taken');
reset role;

select is(
  (select handle from public.profiles where id = 'a0000000-0000-4000-8000-000000000007'),
  'VoidQuill', 'VoidQuill''s own handle is untouched by the failed attempt');
select is(
  (select friend_code from public.profile_private where user_id = 'a0000000-0000-4000-8000-000000000007'),
  '100000000007', 'and VoidQuill''s own friend code is untouched too');
select is(
  (select ocr_status from public.profile_proofs where id = 'f0000000-0000-4000-8000-000000000005'),
  'failed'::public.ocr_status, 'the proof row settles to failed');
select is(
  (select ocr_extracted from public.profile_proofs where id = 'f0000000-0000-4000-8000-000000000005'),
  jsonb_build_object('reason', 'handle_taken', 'handle', 'AzureRift', 'friendCode', '246813579024'),
  'recording the reason and both attempted values, for the app''s manual fallback form');

select * from finish();
rollback;
