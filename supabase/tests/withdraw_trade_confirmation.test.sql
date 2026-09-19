-- Regression test for supabase/migrations/20260920000100_fix_withdraw_confirmation_guard.sql.
--
-- Before the fix, `if not v_withdrew` compared NULL, so withdrawing with nothing to withdraw raised no
-- error and left a phantom 'confirmation_withdrawn' system message behind.
--
-- Fixture (supabase/seed.sql section 5): chat c4 on listing l3 holds the trade lock, seller NoxTrainer,
-- buyer SolstonKid. Only the buyer has confirmed. The RPCs are SECURITY DEFINER and read auth.uid() from
-- the JWT claims, so they are called as the test's superuser with the claims of the trainer under test.
begin;
select plan(7);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

create function pg_temp.withdrawn_rows() returns bigint language sql as $$
  select count(*) from public.chat_messages
   where chat_id = 'c0000000-0000-4000-8000-000000000004' and system_event = 'confirmation_withdrawn'
$$;

-- The seller never confirmed, so has nothing to withdraw.
select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.withdraw_trade_confirmation('c0000000-0000-4000-8000-000000000004') $$,
  'PT409', 'nothing_to_withdraw',
  'seller with no confirmation gets nothing_to_withdraw');
select is(pg_temp.withdrawn_rows(), 0::bigint, 'and no phantom system message is written');

-- The buyer did confirm: withdrawing works, once.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000b');
select isnt(
  (select buyer_confirmed_at from public.trade_locks where chat_id = 'c0000000-0000-4000-8000-000000000004'),
  null, 'fixture: the buyer has confirmed');
select lives_ok(
  $$ select public.withdraw_trade_confirmation('c0000000-0000-4000-8000-000000000004') $$,
  'buyer with a confirmation can withdraw it');
select is(
  (select buyer_confirmed_at from public.trade_locks where chat_id = 'c0000000-0000-4000-8000-000000000004'),
  null, 'which clears buyer_confirmed_at');
select is(pg_temp.withdrawn_rows(), 1::bigint, 'and writes exactly one system message');

-- Withdrawing again is the same no-op as the seller's case.
select throws_ok(
  $$ select public.withdraw_trade_confirmation('c0000000-0000-4000-8000-000000000004') $$,
  'PT409', 'nothing_to_withdraw',
  'a second withdrawal is refused too');

select * from finish();
rollback;
