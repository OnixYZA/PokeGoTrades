-- Tighten two reputation loopholes. This is a NEW migration because 20261103000400_reputation_and_anti_bail.sql
-- is already applied on hosted Supabase; editing it would never reach hosted.
--
-- 1. bail_and_block: reporting 'unresponsive' past the 15-minute grace now penalises the partner (-0.3 rep,
--    bails_count + 1) ONLY IF the caller has confirmed AND the partner has not. Before, anyone could tank a
--    partner's rep with a bare 'unresponsive' report. Mirrors evaluateBailOutcome in lib/reputation.ts.
-- 2. unlock_trade: a SELLER who unlocks past the grace (strictly > 15 minutes) while the buyer has confirmed and
--    the seller has not was dodging the 'other' bail penalty. They now take -0.2 rep (floor 0) and bails_count + 1,
--    applied BEFORE the lock row (and its confirmations) is deleted. Mirrors evaluateUnlockOutcome.
--
-- Both are recreated from their latest definitions (bail_and_block: 20261103000400; unlock_trade: 20260916000500);
-- the only changes are the marked blocks. Grants are untouched (create or replace). The numbers are pinned to
-- lib/reputation.ts by lib/reputation.test.ts (the trailing comments are parsed).

-- ===== bail_and_block =====
create or replace function public.bail_and_block(
  p_chat_id uuid, p_reason public.bail_reason, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_chat  public.chats;
  v_other uuid;
  v_note  text := case when p_reason = 'other' then nullif(btrim(p_note), '') end;
  v_row   record;
  v_lock  public.trade_locks;
begin
  select * into v_chat from public.chats where id = p_chat_id;
  if v_uid is null or not found or v_uid not in (v_chat.seller_id, v_chat.buyer_id) then
    raise sqlstate 'PT403' using message = 'not_participant';
  end if;
  if v_chat.status <> 'open' then raise sqlstate 'PT409' using message = 'chat_not_open'; end if;
  if v_note is not null and char_length(v_note) > 280 then raise sqlstate 'PT400' using message = 'note_too_long'; end if;
  v_other := case when v_uid = v_chat.seller_id then v_chat.buyer_id else v_chat.seller_id end;

  -- Anti-bail: a lock held past the grace period costs someone rep. Read BEFORE the loop deletes it.
  -- Mirrors evaluateBailOutcome in lib/reputation.ts.
  select * into v_lock from public.trade_locks where chat_id = p_chat_id;
  if found and v_lock.locked_at < now() - interval '15 minutes' then   -- LOCK_GRACE_PERIOD_MINUTES (strictly past 15:00)
    if p_reason = 'unresponsive'
       -- Only a caller who confirmed can blame a partner who did not (tightened from 000400).
       and (case when v_uid = v_lock.seller_id then v_lock.seller_confirmed_at else v_lock.buyer_confirmed_at end) is not null
       and (case when v_uid = v_lock.seller_id then v_lock.buyer_confirmed_at else v_lock.seller_confirmed_at end) is null then
      update public.profiles
         set rep = greatest(0.0, round((coalesce(rep, 5.0) - 0.3)::numeric, 1)),   -- REP_PENALTY_UNRESPONSIVE_NO_SHOW / MIN_REP
             bails_count = bails_count + 1
       where id = v_other;
    elsif p_reason = 'other'
          and (case when v_uid = v_lock.seller_id then v_lock.buyer_confirmed_at else v_lock.seller_confirmed_at end) is not null then
      update public.profiles
         set rep = greatest(0.0, round((coalesce(rep, 5.0) - 0.2)::numeric, 1)),   -- REP_PENALTY_POST_GRACE_BAIL / MIN_REP
             bails_count = bails_count + 1
       where id = v_uid;
    end if;
  end if;

  -- Close every open chat between this pair, releasing any locks. Listings are locked in id order (deadlock safety).
  for v_row in
    select c.id as chat_id, c.listing_id from public.chats c
     where c.status = 'open'
       and ((c.seller_id = v_uid and c.buyer_id = v_other) or (c.seller_id = v_other and c.buyer_id = v_uid))
     order by c.listing_id, c.id
  loop
    perform 1 from public.listings l where l.id = v_row.listing_id for update;
    update public.chats set status = 'bailed', closed_at = now(), closed_by = v_uid
     where id = v_row.chat_id and status = 'open';
    if not found then continue; end if;                        -- lost a race with completion
    delete from public.trade_locks where chat_id = v_row.chat_id;
    if found then                                              -- BailBlockModal: "LISTING RELISTED"
      update public.listings set status = 'open', locked_at = null where id = v_row.listing_id;
    end if;
    update public.chat_members set archived_at = now() where chat_id = v_row.chat_id and user_id = v_uid;
    perform private.system_message(v_row.chat_id, 'bailed', 'This chat was closed.');   -- reason never shown
  end loop;

  insert into public.blocks (blocker_id, blocked_id, reason, note, source_chat_id)
  values (v_uid, v_other, p_reason, v_note, p_chat_id)
  on conflict (blocker_id, blocked_id) do update
    set reason = excluded.reason, note = excluded.note, source_chat_id = excluded.source_chat_id, created_at = now();

  if p_reason = 'spoofer' or v_note is not null then           -- 'FLAGS ACCOUNT' in BailBlockModal
    insert into public.moderation_reports (reporter_id, reported_id, chat_id, reason, note, conversation_snapshot)
    select v_uid, v_other, p_chat_id, p_reason, v_note,
           coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'kind', m.kind,
                    'body', m.body, 'offer', m.offer, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
      from (select * from public.chat_messages where chat_id = p_chat_id order by created_at desc limit 200) m;
  end if;
end $$;

-- ===== unlock_trade =====
create or replace function public.unlock_trade(p_chat_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_listing_id uuid; v_seller_id uuid; v_lock public.trade_locks;
begin
  select c.listing_id, c.seller_id into v_listing_id, v_seller_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null or v_seller_id <> v_uid then
    raise sqlstate 'PT403' using message = 'not_seller';
  end if;
  perform 1 from public.listings where id = v_listing_id for update;

  -- Anti-bail: unlocking late on a buyer who already confirmed is a bail in disguise. Read BEFORE the delete.
  -- Mirrors evaluateUnlockOutcome in lib/reputation.ts.
  select * into v_lock from public.trade_locks where listing_id = v_listing_id and chat_id = p_chat_id;
  if found
     and v_lock.locked_at < now() - interval '15 minutes'   -- LOCK_GRACE_PERIOD_MINUTES (strictly past 15:00)
     and v_lock.buyer_confirmed_at is not null and v_lock.seller_confirmed_at is null then
    update public.profiles
       set rep = greatest(0.0, round((coalesce(rep, 5.0) - 0.2)::numeric, 1)),   -- REP_PENALTY_POST_GRACE_BAIL / MIN_REP
           bails_count = bails_count + 1
     where id = v_uid;
  end if;

  delete from public.trade_locks where listing_id = v_listing_id and chat_id = p_chat_id;  -- confirmations go too
  if not found then raise sqlstate 'PT409' using message = 'not_lock_holder'; end if;

  update public.listings set status = 'open', locked_at = null where id = v_listing_id;
  perform private.system_message(p_chat_id, 'unlocked', 'Seller re-opened competing offers.');
end $$;
