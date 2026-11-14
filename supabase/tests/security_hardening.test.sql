-- Contract test for supabase/migrations/20261112000100_security_hardening.sql.
--
-- CANNOT RUN AGAINST HOSTED SUPABASE: it needs the local stack (`npm run db:test`, which resets the local
-- database). It is written but was not run in the environment that produced it.
--
-- What must hold:
--   * Privilege invariants (the architectural guard: supabase_admin's default ACLs and Postgres' built-in PUBLIC
--     EXECUTE mean a new object leaks to anon/authenticated unless its own migration revokes it, and a migration
--     cannot change those defaults): nothing in `public` is reachable by anon; authenticated has no TRUNCATE /
--     REFERENCES / TRIGGER; no function in public/private is executable by anon; every SECURITY DEFINER function
--     pins search_path = ''; the public functions authenticated can execute are exactly an allowlist; and the
--     private trigger functions plus the rate-limit ledger are out of authenticated's reach.
--   * Rate limits (sqlstate PT429): profile_proofs 5/hour, listing_proofs 30/hour (counted on an append-only
--     ledger, so delete + re-insert does not evade it), listings 10/hour, and a 10-object/hour storage cap on the
--     profile-proofs bucket (a RESTRICTIVE policy, so plain 42501). Idempotent retries still hit their 23505, and
--     inserts with no auth.uid() (seed, migrations, the service-role worker) are never limited.
--   * bail_and_block: a second bail on an already-closed chat is PT409 chat_not_open and charges nothing.
--
-- Fixture (supabase/seed.sql):
--   * GraniteFox (a…0003) for the profile_proofs row limit; NoxTrainer (a…0004) is used for the profile-proofs
--     object cap only as the object uploader (also the seller on chat c…004, but that test never touches it
--     before bail_and_block, and each test file is its own rolled-back transaction).
--   * DriftCoral (a…0001), seller of open listing b…001, for the listing_proofs limit (no seeded listing_proofs).
--   * EmberVale (a…0005) for the listings limit; his seeded listings are backdated first so they do not count.
--   * Chat c…004 on b…003: seller NoxTrainer, buyer SolstonKid (a…000b), seed lock has buyer_confirmed_at set and
--     seller_confirmed_at null, so SolstonKid reporting 'unresponsive' past the grace penalises NoxTrainer
--     (-0.3, bails +1). reputation_and_anti_bail.test.sql also uses c…004, but restages it; nothing carries over.
begin;
select plan(28);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

create function pg_temp.no_uid() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)
$$;

-- Stands in for a real profile-proofs Storage upload (see profile_proofs.test.sql).
create function pg_temp.put_profile_object(p_uid uuid, p_id uuid) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('profile-proofs', p_uid::text || '/' || p_id::text, p_uid::text)
$$;

create function pg_temp.rb(p_uid uuid) returns text language sql as $$
  select rep::text || '/' || bails_count from public.profiles where id = p_uid
$$;

-- ——— privilege invariants ———
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S')
        and (case when c.relkind = 'S'
                  then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                  else has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') end) $$,
  'no relation in public grants anything to anon: revoke it from anon (and PUBLIC) in the migration that created it');

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
        and has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER') $$,
  'no relation in public grants TRUNCATE, REFERENCES or TRIGGER to authenticated: revoke them in the migration that created it');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') $$,
  'a new public/private function leaked to anon: revoke execute from public, anon in the migration that created it');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and not coalesce('search_path=""' = any (p.proconfig), false) $$,
  'a SECURITY DEFINER function does not pin search_path: add `set search_path = ''''` to it');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') $$,
  $$ select unnest(array['bail_and_block', 'confirm_trade', 'get_handshake', 'lock_trade', 'open_offer', 'unlock_trade',
                         'withdraw_listing', 'withdraw_trade_confirmation', 'array_is_distinct',
                         'creature_ref_array_is_valid', 'creature_ref_is_valid', 'formal_offer_is_valid']) $$,
  'the public functions authenticated can execute differ from the allowlist: revoke the new one, or add it here on purpose');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('guard_listing_tradable', 'guard_offer_tradable', 'notify_profile_ocr',
                          'enforce_proof_rate_limit', 'enforce_listing_rate_limit')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  'a private trigger function is executable by authenticated: revoke execute from public, anon, authenticated');

select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-000000000003',
  'role', 'authenticated', 'is_anonymous', false)::text, true);
set local role authenticated;
select throws_ok($$ select * from private.proof_upload_log $$, '42501', null,
  'authenticated cannot read private.proof_upload_log: revoke all on it from public, anon, authenticated');
reset role;

select ok(has_table_privilege('authenticated', 'public.pokemon_market_demand', 'SELECT')
      and has_table_privilege('service_role', 'public.pokemon_market_demand', 'SELECT')
      and not has_table_privilege('authenticated', 'public.pokemon_market_demand', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'pokemon_market_demand is SELECT-only for authenticated and service_role');

-- ——— profile_proofs: 5 rows per rolling hour (GraniteFox) ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a1') $$, 'profile proof 1 of 5');
reset role; update public.profile_proofs set ocr_status = 'failed' where id = 'f0000000-0000-4000-8000-0000000000a1'; set local role authenticated;

select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a2');
select lives_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a2',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a2') $$, 'profile proof 2 of 5');
reset role; update public.profile_proofs set ocr_status = 'failed' where id = 'f0000000-0000-4000-8000-0000000000a2'; set local role authenticated;

select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a3');
select lives_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a3',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a3') $$, 'profile proof 3 of 5');
reset role; update public.profile_proofs set ocr_status = 'failed' where id = 'f0000000-0000-4000-8000-0000000000a3'; set local role authenticated;

select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a4');
select lives_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a4',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a4') $$, 'profile proof 4 of 5');
reset role; update public.profile_proofs set ocr_status = 'failed' where id = 'f0000000-0000-4000-8000-0000000000a4'; set local role authenticated;

select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a5');
select lives_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a5',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a5') $$, 'profile proof 5 of 5');
reset role; update public.profile_proofs set ocr_status = 'failed' where id = 'f0000000-0000-4000-8000-0000000000a5'; set local role authenticated;

select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a6');
select throws_ok($$ insert into public.profile_proofs (id, storage_path) values ('f0000000-0000-4000-8000-0000000000a6',
  'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a6') $$,
  'PT429', 'proof_rate_limited', 'the 6th profile proof within the hour is rate limited');
reset role;

-- ——— profile-proofs storage cap: 10 objects per rolling hour (NoxTrainer) ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');
set local role authenticated;
select lives_ok($$ do $b$ begin
    for i in 1..10 loop
      perform pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000004', gen_random_uuid());
    end loop;
  end $b$ $$, 'ten profile-proofs objects within the hour are accepted');
select throws_ok($$ select pg_temp.put_profile_object('a0000000-0000-4000-8000-000000000004', gen_random_uuid()) $$,
  '42501', null, 'the 11th profile-proofs object is refused by the restrictive storage policy');
reset role;

-- ——— listing_proofs: 30 per rolling hour, even through delete + re-insert (DriftCoral, listing b…001) ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id) values (
  'listing-proofs', 'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal',
  'a0000000-0000-4000-8000-000000000001');
select lives_ok($$ do $b$ begin
    for i in 1..30 loop
      insert into public.listing_proofs (listing_id, kind, storage_path) values (
        'b0000000-0000-4000-8000-000000000001', 'appraisal',
        'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal');
      delete from public.listing_proofs where listing_id = 'b0000000-0000-4000-8000-000000000001' and kind = 'appraisal';
    end loop;
  end $b$ $$, 'thirty insert + delete cycles on one (listing, kind) are accepted');
select throws_ok($$ insert into public.listing_proofs (listing_id, kind, storage_path) values (
    'b0000000-0000-4000-8000-000000000001', 'appraisal',
    'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal') $$,
  'PT429', 'proof_rate_limited', 'the 31st insert is rate limited: the ledger is not evaded by deleting rows');
reset role;

-- A row that already exists is an idempotent retry: still the 23505 the client handles, never a PT429.
select pg_temp.no_uid();
insert into public.listing_proofs (listing_id, kind, storage_path) values (
  'b0000000-0000-4000-8000-000000000001', 'appraisal',
  'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal');
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.listing_proofs (listing_id, kind, storage_path) values (
    'b0000000-0000-4000-8000-000000000001', 'appraisal',
    'a0000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/appraisal') $$,
  '23505', null, 'a duplicate (listing, kind) is 23505, not PT429, even at the limit');
reset role;

-- ——— listings: 10 per rolling hour (EmberVale) ———
update public.listings set created_at = now() - interval '2 hours' where seller_id = 'a0000000-0000-4000-8000-000000000005';
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');
set local role authenticated;
select lives_ok($$ do $b$ begin
    for i in 1..10 loop
      insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type) values (
        ('b0000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
        'Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)');
    end loop;
  end $b$ $$, 'ten listings within the hour are accepted');
select throws_ok($$ insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type) values (
    'b0000000-0000-4000-8000-000000000199', 'Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)') $$,
  'PT429', 'listing_rate_limited', 'the 11th listing within the hour is rate limited');
select throws_ok($$ insert into public.listings (id, name, pokemon_id, catch_year, hue, loc, trade_type) values (
    'b0000000-0000-4000-8000-000000000101', 'Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)') $$,
  '23505', null, 're-inserting an existing listing id is 23505 (insertListing''s retry path), not PT429');
reset role;

-- ——— no auth.uid(): seed, migrations and the service-role worker are not trainer uploads ———
select pg_temp.no_uid();
select lives_ok($$ insert into public.listings (id, seller_id, name, pokemon_id, catch_year, hue, loc, trade_type) values (
    'b0000000-0000-4000-8000-000000000198', 'a0000000-0000-4000-8000-000000000005',
    'Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)') $$,
  'a listing insert with no auth.uid() is not rate limited, even past the limit');
select lives_ok($$ insert into public.profile_proofs (user_id, storage_path, ocr_status) values (
    'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-0000000000a7', 'failed') $$,
  'a profile_proofs insert with no auth.uid() is not rate limited, even past the limit');

-- ——— bail_and_block: the second bail on a closed chat is chat_not_open and charges nothing ———
-- Lock on c…004 backdated past the 15-minute grace. SolstonKid (buyer, confirmed) reports 'unresponsive'.
update public.trade_locks set locked_at = now() - interval '30 minutes'
 where chat_id = 'c0000000-0000-4000-8000-000000000004';
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000b');
set local role authenticated;
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'the first bail succeeds');
reset role;
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.7/1',
  'the partner is charged once: rep 5.0 - 0.3, one bail');
set local role authenticated;
select throws_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'PT409', 'chat_not_open', 'a second bail on the same, now closed, chat is chat_not_open');
reset role;
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.7/1',
  'and the second call charges the partner nothing more');

select * from finish();
rollback;
