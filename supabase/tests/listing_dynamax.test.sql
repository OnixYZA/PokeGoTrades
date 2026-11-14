-- Regression test for supabase/migrations/20261112000200_listings_is_dynamax.sql, plus the first pgTAP
-- coverage of `public.withdraw_listing` (supabase/migrations/20260916000500_rpcs.sql).
--
-- What must hold for is_dynamax: `not null default false`; an ordinary seller-writable column on an open,
-- offer-free listing; mutually exclusive with is_gigantamax (check listings_dynamax_xor_gigantamax, 23514); and
-- frozen by `guard_listing_update` once a chat exists (PT409 listing_has_offers).
--
-- What must hold for withdraw_listing: only the seller may call it (PT403 not_seller); a locked listing refuses
-- (PT409 unlock_first); a withdrawn listing is `withdrawn`, its open chats are `closed` and each gets a
-- `closed_listing_withdrawn` system message; withdrawing again refuses (PT409 not_open).
--
-- Fixtures (supabase/seed.sql), chosen so no test needs a fresh INSERT (inserts with an authenticated auth.uid()
-- count toward the listing / proof rate limits of the security-hardening migration):
--   b…005  IronGlass (a…006), open, zero chats: the offer-free listing for the is_dynamax writes (the same one
--          listing_attributes.test.sql uses).
--   b…001  DriftCoral (a…001), has chat c…001: the guard case. AzureRift (a…002) is in no chat there and is not
--          its seller, so it is the non-seller for withdraw_listing.
--   b…003  NoxTrainer (a…004), locked by chat c…004 (seed section 5): the unlock_first case.
--   b…002  GraniteFox (a…003), open, exactly one open chat c…005 (buyer DriftCoral): the real withdrawal. Nothing
--          else in the test suite depends on it, and the transaction rolls back.
-- withdraw_listing is SECURITY DEFINER and reads auth.uid() from the JWT claims, so, like
-- withdraw_trade_confirmation.test.sql, it is called as the test's superuser with the claims under test.
begin;
select plan(15);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— is_dynamax defaults and shape ———
select is(
  (select is_dynamax from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  false, 'a listing inserted without is_dynamax (the seed) has it false by default');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'listings' and column_name = 'is_dynamax'),
  'false', 'the column default is false');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'listings' and column_name = 'is_dynamax'),
  'NO', 'the column is not null');

-- ——— the seller CAN set is_dynamax while no offers exist; both flags together are refused ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000006');   -- IronGlass, seller of b...005
set local role authenticated;
select lives_ok(
  $$ update public.listings set is_dynamax = true where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can set is_dynamax on their own open, offer-free listing');
select is(
  (select is_dynamax from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  true, 'and it lands');
select throws_ok(
  $$ update public.listings set is_dynamax = true, is_gigantamax = true
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  '23514', 'new row for relation "listings" violates check constraint "listings_dynamax_xor_gigantamax"',
  'is_dynamax and is_gigantamax cannot both be true');
reset role;

-- ——— guard: is_dynamax changing after a chat exists is rejected ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');   -- DriftCoral, seller of b...001 (chat c...001 exists)
set local role authenticated;
select isnt(
  (select count(*) from public.chats where listing_id = 'b0000000-0000-4000-8000-000000000001'), 0::bigint,
  'fixture: b...001 already has at least one chat');
select throws_ok(
  $$ update public.listings set is_dynamax = true where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'the guard rejects is_dynamax changing once a chat exists');
reset role;

-- ——— withdraw_listing ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000002');   -- AzureRift: not the seller of b...001
select throws_ok(
  $$ select public.withdraw_listing('b0000000-0000-4000-8000-000000000001') $$,
  'PT403', 'not_seller', 'a non-seller cannot withdraw someone else''s listing');

select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');   -- NoxTrainer, seller of the locked b...003
select throws_ok(
  $$ select public.withdraw_listing('b0000000-0000-4000-8000-000000000003') $$,
  'PT409', 'unlock_first', 'a locked listing must be unlocked before it can be withdrawn');

select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');   -- GraniteFox, seller of b...002 (chat c...005)
select lives_ok(
  $$ select public.withdraw_listing('b0000000-0000-4000-8000-000000000002') $$,
  'the seller can withdraw an open listing that has an open chat');
select is(
  (select status::text from public.listings where id = 'b0000000-0000-4000-8000-000000000002'),
  'withdrawn', 'the listing is withdrawn');
select is(
  (select status::text from public.chats where id = 'c0000000-0000-4000-8000-000000000005'),
  'closed', 'its open chat is closed');
select is(
  (select count(*) from public.chat_messages
    where chat_id = 'c0000000-0000-4000-8000-000000000005' and system_event = 'closed_listing_withdrawn'),
  1::bigint, 'and a closed_listing_withdrawn system message was posted to it');
select throws_ok(
  $$ select public.withdraw_listing('b0000000-0000-4000-8000-000000000002') $$,
  'PT409', 'not_open', 'withdrawing again is refused');

select * from finish();
rollback;
