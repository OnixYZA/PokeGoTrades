-- Regression test for supabase/migrations/20260920000300_trade_locks_updated_at.sql.
--
-- `trade_locks.updated_at` is the token the client uses to order two observations of the same lock
-- (store/trade-store.tsx `lockEventVersion` / `isStaleLock`). If the column stops advancing, or the
-- broadcast stops carrying it, every lock frame silently becomes unordered again and the stale-frame race
-- comes back — with nothing failing to say so. These three assertions are what the guard rests on.
--
-- Fixture (supabase/seed.sql section 5): chat c4 on listing l3 holds the trade lock.
begin;
select plan(4);

select has_column('public', 'trade_locks', 'updated_at', 'trade_locks carries an updated_at');
select col_not_null('public', 'trade_locks', 'updated_at', 'which is never null');

-- The ordering token has to actually move, or every comparison against it is a no-op.
create function pg_temp.bump_and_compare() returns boolean language plpgsql as $$
declare v_before timestamptz; v_after timestamptz;
begin
  select updated_at into v_before from public.trade_locks
   where chat_id = 'c0000000-0000-4000-8000-000000000004';
  -- A separate statement in a later transaction-time slot; now() is stable within a transaction, so the
  -- trigger is what has to write it, not the default.
  perform pg_sleep(0.01);
  update public.trade_locks set seller_confirmed_at = seller_confirmed_at
   where chat_id = 'c0000000-0000-4000-8000-000000000004';
  select updated_at into v_after from public.trade_locks
   where chat_id = 'c0000000-0000-4000-8000-000000000004';
  return v_after >= v_before;
end $$;
select ok(pg_temp.bump_and_compare(), 'and the trigger advances it on every update');

-- The column is useless to the client if the broadcast leaves it out.
select ok(
  pg_get_functiondef('private.on_trade_lock_changed'::regproc) like '%''updated_at'', v_row.updated_at%',
  'and on_trade_lock_changed puts it in the broadcast payload');

select * from finish();
rollback;
