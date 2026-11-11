-- Regression test for supabase/migrations/20261103000400_reputation_and_anti_bail.sql and its tightening,
-- 20261103000500_tighten_reputation_loopholes.sql (the latest bail_and_block / unlock_trade).
--
-- What must hold:
--   * profiles.rep is NOT NULL default 5.0, bails_count defaults to 0, last_trade_at starts null;
--   * none of rep / trades_count / streak_days / bails_count / last_trade_at is client-writable (authenticated's
--     column UPDATE grant is (handle, lvl, team, bio));
--   * confirm_trade, on the second confirmation, gives BOTH parties trades_count + 1, rep + 0.1 (capped at 5.0),
--     a UTC-day streak (first trade -> 1, yesterday -> +1, same day -> unchanged, older gap -> back to 1) and
--     last_trade_at;
--   * bail_and_block costs rep only when the lock is strictly older than 15 minutes:
--       'unresponsive' + caller confirmed AND partner not -> the PARTNER loses 0.3 rep (floor 0.0) and gains a bail
--                                           (partner confirmed, or caller never confirmed -> nothing);
--   * unlock_trade (seller only) past the 15-minute grace with the buyer confirmed and the seller not -> the SELLER
--     loses 0.2 rep and gains a bail; inside the grace, or with no buyer confirmation -> nothing;
--       'other' + partner already confirmed -> the CALLER loses 0.2 rep and gains a bail;
--       'spoofer' / 'unreasonable_adds', 'other' with no partner confirmation, or a lock inside the grace -> nothing.
--
-- Fixture (supabase/seed.sql): chat c…004 on listing b…003 is the lock holder, seller NoxTrainer (a…004), buyer
-- SolstonKid (a…00b); the seed lock has buyer_confirmed_at set. Chat c…001 on b…001 is DriftCoral (a…001, 214
-- trades) with MintRunner (a…008), unlocked, so the confirm_trade section drives a REAL lock_trade + two
-- confirm_trade calls on it. The RPCs are SECURITY DEFINER and read auth.uid() from the JWT claims, so they are
-- called as the test's superuser with the claims of the trainer under test.
--
-- STAGING (not a product path): a bail closes the chat and deletes the lock, and a completed trade is final, so
-- pg_temp.restage() puts c…004 / b…003 back into "locked, N minutes old, these confirmations" between scenarios by
-- writing trade_locks / chats / listings / profiles directly as the superuser. It disables no trigger; the
-- deferred lock-consistency triggers are satisfied because the lock row and listing status are written together.
-- A lock row with both confirmations is illegal (trade_locks_not_both_confirmed), so staged locks have at most one.
-- locked_at is set directly because the 15-minute grace is measured from it and the RPCs always stamp now().
begin;
select plan(63);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- 'rep/bails' of a profile, as text so 0 renders as '0.0' and the comparison cannot go through float noise.
create function pg_temp.rb(p_uid uuid) returns text language sql as $$
  select rep::text || '/' || bails_count from public.profiles where id = p_uid
$$;

-- Put c…004 / b…003 back to: open chat, lock held since now() - p_age, with the given confirmations; and set both
-- parties' rep (bails_count 0). Seller = NoxTrainer, buyer = SolstonKid.
create function pg_temp.restage(p_age interval, p_seller_conf boolean, p_buyer_conf boolean,
                                p_seller_rep numeric, p_buyer_rep numeric) returns void language plpgsql as $$
declare
  v_at timestamptz := now() - p_age;
begin
  delete from public.completed_trades where chat_id = 'c0000000-0000-4000-8000-000000000004';
  delete from public.moderation_reports where chat_id = 'c0000000-0000-4000-8000-000000000004';
  delete from public.blocks where source_chat_id = 'c0000000-0000-4000-8000-000000000004';
  delete from public.trade_locks where chat_id = 'c0000000-0000-4000-8000-000000000004';
  update public.chats set status = 'open', closed_at = null, closed_by = null
   where id = 'c0000000-0000-4000-8000-000000000004';
  update public.chat_members set archived_at = null where chat_id = 'c0000000-0000-4000-8000-000000000004';
  insert into public.trade_locks (listing_id, chat_id, seller_id, buyer_id, accepted_offer_message_id,
                                  locked_at, seller_confirmed_at, buyer_confirmed_at)
  values ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004',
          'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000b',
          'd0000000-0000-4000-8000-000000000004', v_at,
          case when p_seller_conf then v_at + interval '1 minute' end,
          case when p_buyer_conf then v_at + interval '1 minute' end);
  update public.listings set status = 'locked', locked_at = v_at, completed_at = null
   where id = 'b0000000-0000-4000-8000-000000000003';
  update public.profiles set rep = p_seller_rep, bails_count = 0, trades_count = 0, streak_days = 0, last_trade_at = null
   where id = 'a0000000-0000-4000-8000-000000000004';
  update public.profiles set rep = p_buyer_rep, bails_count = 0, trades_count = 0, streak_days = 0, last_trade_at = null
   where id = 'a0000000-0000-4000-8000-00000000000b';
end $$;

-- ——— defaults: a profile created by the on_auth_user_created trigger ———
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated',
        'newcomer@pokegotrades.test', '{}'::jsonb, '{}'::jsonb, now(), now());
select is((select rep from public.profiles where id = 'a0000000-0000-4000-8000-0000000000f1'), 5.0::numeric,
  'a new profile starts at rep 5.0');
select is((select bails_count from public.profiles where id = 'a0000000-0000-4000-8000-0000000000f1'), 0,
  'a new profile has bails_count 0');
select is((select last_trade_at from public.profiles where id = 'a0000000-0000-4000-8000-0000000000f1'), null,
  'a new profile has no last_trade_at');
select is((select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'rep'), 'NO',
  'profiles.rep is NOT NULL');

-- ——— privileges: the five reputation columns are server-written ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ update public.profiles set rep = 5.0 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update rep');
select throws_ok($$ update public.profiles set trades_count = 9999 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update trades_count');
select throws_ok($$ update public.profiles set streak_days = 9999 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update streak_days');
select throws_ok($$ update public.profiles set bails_count = 0 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update bails_count');
select throws_ok($$ update public.profiles set last_trade_at = null where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update last_trade_at');
select lives_ok($$ update public.profiles set bio = 'still editable' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'control: authenticated can still update bio');
reset role;

-- ——— bail inside the grace: nothing moves, whatever the reason ———
select pg_temp.restage(interval '14 minutes', false, true, 4.5, 4.5);
select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'seller reports the buyer unresponsive 14 minutes into the lock');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'inside the grace: the partner keeps rep and bails');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'inside the grace: the caller keeps rep and bails');

select pg_temp.restage(interval '14 minutes', false, true, 4.5, 4.5);
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'other', 'changed my mind') $$,
  'seller bails with a reason of other, partner confirmed, still inside the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'inside the grace: bailing "other" after the partner confirmed is free');

-- ——— bail past the grace: unresponsive costs the PARTNER ———
select pg_temp.restage(interval '20 minutes', true, false, 4.5, 4.5);          -- seller (caller) confirmed, buyer did not
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'seller (who confirmed) reports the unconfirmed buyer unresponsive 20 minutes into the lock');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.2/1', 'past the grace: the unresponsive partner loses 0.3 rep and gains a bail');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'and the caller is unchanged');

-- the same, reported by the buyer: the SELLER is the partner
select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);          -- buyer (caller) confirmed, seller did not
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000b');
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'buyer (who confirmed) reports the unconfirmed seller unresponsive 20 minutes into the lock');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.2/1', 'past the grace: the unresponsive seller loses 0.3 rep and gains a bail');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'and the reporting buyer is unchanged');

-- floor at 0.0
select pg_temp.restage(interval '20 minutes', true, false, 4.5, 0.1);
select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'seller reports a buyer who is already at 0.1');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '0.0/1', 'rep floors at 0.0, not -0.2');

-- ——— bail past the grace: spoofer / unreasonable_adds cost the caller nothing ———
select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'spoofer') $$,
  'seller reports a spoofer 20 minutes into the lock');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'spoofer past the grace: the caller is unchanged');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'and so is the partner');

select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unreasonable_adds') $$,
  'seller reports unreasonable adds 20 minutes into the lock');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'unreasonable_adds past the grace: the caller is unchanged');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'and so is the partner');

-- ——— bail past the grace: "other" costs the CALLER only if the partner had confirmed ———
select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);          -- buyer (the partner) confirmed
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'other', 'cannot make it') $$,
  'seller bails with other after the buyer confirmed, past the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.3/1', 'the caller loses 0.2 rep and gains a bail');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'and the partner is unchanged');

select pg_temp.restage(interval '20 minutes', true, false, 4.5, 4.5);          -- seller (the partner) confirmed
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000b');
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'other', 'cannot make it') $$,
  'buyer bails with other after the seller confirmed, past the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.3/1', 'the buyer, as caller, loses 0.2 rep and gains a bail');

select pg_temp.restage(interval '20 minutes', false, false, 4.5, 4.5);         -- nobody confirmed
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'other', 'cannot make it') $$,
  'buyer bails with other when the partner never confirmed, past the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'no partner confirmation: the caller is unchanged');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'and so is the partner');

select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');                 -- seller from here on
-- ——— bail past the grace: unresponsive is FREE unless the caller confirmed and the partner did not ———
select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);          -- the PARTNER (buyer) already confirmed
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'seller reports unresponsive after the buyer already confirmed, past the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'partner confirmed: the partner is not penalised');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'and the caller is unchanged');

select pg_temp.restage(interval '20 minutes', false, false, 4.5, 4.5);         -- nobody confirmed
select lives_ok($$ select public.bail_and_block('c0000000-0000-4000-8000-000000000004', 'unresponsive') $$,
  'seller reports unresponsive without having confirmed, past the grace');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'caller never confirmed: the partner is not penalised');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'and the caller is unchanged');

-- ——— unlock_trade (seller only) ———
select pg_temp.restage(interval '20 minutes', false, true, 4.5, 4.5);          -- buyer confirmed, seller did not
select lives_ok($$ select public.unlock_trade('c0000000-0000-4000-8000-000000000004') $$,
  'seller unlocks 20 minutes in after the buyer confirmed');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.3/1', 'late unlock: the seller loses 0.2 rep and gains a bail');
select is(pg_temp.rb('a0000000-0000-4000-8000-00000000000b'), '4.5/0', 'and the buyer is unchanged');
select is((select count(*)::int from public.trade_locks where chat_id = 'c0000000-0000-4000-8000-000000000004'), 0,
  'and the lock is released');

select pg_temp.restage(interval '14 minutes', false, true, 4.5, 4.5);
select lives_ok($$ select public.unlock_trade('c0000000-0000-4000-8000-000000000004') $$,
  'seller unlocks 14 minutes in after the buyer confirmed');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'inside the grace: unlocking is free');

select pg_temp.restage(interval '20 minutes', false, false, 4.5, 4.5);         -- nobody confirmed
select lives_ok($$ select public.unlock_trade('c0000000-0000-4000-8000-000000000004') $$,
  'seller unlocks 20 minutes in with no buyer confirmation');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '4.5/0', 'no buyer confirmation: unlocking is free');

select pg_temp.restage(interval '20 minutes', false, true, 0.1, 4.5);
select lives_ok($$ select public.unlock_trade('c0000000-0000-4000-8000-000000000004') $$,
  'a seller already at 0.1 unlocks late after the buyer confirmed');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004'), '0.0/1', 'the late-unlock penalty floors rep at 0.0');

-- ——— confirm_trade, driven end to end on c…001 (DriftCoral seller, MintRunner buyer) ———
-- Rep is capped at 5.0 (both start there); DriftCoral has 214 trades and no last_trade_at, so a first trade for the
-- streak. MintRunner is given a streak from three days ago to show a gap resets it to 1.
update public.profiles set streak_days = 9, last_trade_at = now() - interval '3 days'
 where id = 'a0000000-0000-4000-8000-000000000008';
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.lock_trade('c0000000-0000-4000-8000-000000000001') $$, 'seller locks the trade through lock_trade');
select lives_ok($$ select public.confirm_trade('c0000000-0000-4000-8000-000000000001') $$, 'seller confirms');
select pg_temp.act_as('a0000000-0000-4000-8000-000000000008');
select is((public.confirm_trade('c0000000-0000-4000-8000-000000000001'))->>'state', 'completed', 'buyer confirms and the trade completes');
select is((select array[trades_count, streak_days] from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'),
  array[215, 1], 'seller: trades_count 214 -> 215 and a first trade starts the streak at 1');
select is((select array[trades_count, streak_days] from public.profiles where id = 'a0000000-0000-4000-8000-000000000008'),
  array[1, 1], 'buyer: trades_count 0 -> 1 and a three-day gap resets the streak to 1');
select ok((select bool_and(last_trade_at is not null and last_trade_at > now() - interval '1 minute') from public.profiles
            where id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008')),
  'last_trade_at is stamped for both parties');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000001') || ' ' || pg_temp.rb('a0000000-0000-4000-8000-000000000008'),
  '5.0/0 5.0/0', 'rep caps at 5.0 for both parties (no 5.1)');

-- ——— confirm_trade on c…004: 4.8 -> 4.9, yesterday's streak continues, same-day streak holds ———
select pg_temp.restage(interval '5 minutes', false, false, 4.8, 4.8);
update public.profiles set streak_days = 3, trades_count = 10,
       last_trade_at = ((now() at time zone 'UTC')::date - 1)::timestamp at time zone 'UTC' + interval '12 hours'
 where id = 'a0000000-0000-4000-8000-000000000004';                                 -- traded yesterday (UTC)
update public.profiles set streak_days = 2, last_trade_at = now()
 where id = 'a0000000-0000-4000-8000-00000000000b';                                 -- already traded today (UTC)
select pg_temp.act_as('a0000000-0000-4000-8000-000000000004');
select public.confirm_trade('c0000000-0000-4000-8000-000000000004');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000b');
select public.confirm_trade('c0000000-0000-4000-8000-000000000004');
select is(pg_temp.rb('a0000000-0000-4000-8000-000000000004') || ' ' || pg_temp.rb('a0000000-0000-4000-8000-00000000000b'),
  '4.9/0 4.9/0', 'rep 4.8 becomes 4.9 for both parties');
select is((select array[trades_count, streak_days] from public.profiles where id = 'a0000000-0000-4000-8000-000000000004'),
  array[11, 4], 'a trade the previous UTC day continues the streak: 3 -> 4');
select is((select array[trades_count, streak_days] from public.profiles where id = 'a0000000-0000-4000-8000-00000000000b'),
  array[1, 2], 'a second trade on the same UTC day leaves the streak at 2');

select * from finish();
rollback;
