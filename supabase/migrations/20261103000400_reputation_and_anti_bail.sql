-- Trader reputation and anti-bail penalties.
--
-- profiles: rep becomes NOT NULL default 5.0 (new trainers start trusted; null used to mean "unrated"),
-- plus bails_count and last_trade_at (streak bookkeeping). All server-written: authenticated's column UPDATE
-- grant is (handle, lvl, team, bio) and it has no INSERT grant, so none of rep / trades_count / streak_days /
-- bails_count / last_trade_at is client-writable; confirm_trade / bail_and_block (security definer) write them.
-- Columns added after the revoke inherit no column privileges beyond the table-level SELECT, so nothing to grant.
--
-- There is NO public_profiles view in any migration, so no view is recreated; clients read these columns from
-- public.profiles (select is granted table-wide, policy profiles_read).
--
-- confirm_trade and bail_and_block are recreated from their latest definitions (…20260927000500 and
-- …20260916000500); the only changes are the marked reputation blocks. Grants are untouched (create or replace).
-- The numbers here are pinned to lib/reputation.ts by lib/reputation.test.ts (the trailing comments are parsed).

update public.profiles set rep = 5.0 where rep is null;
alter table public.profiles
  alter column rep set default 5.0,
  alter column rep set not null;

alter table public.profiles
  add column bails_count integer not null default 0 check (bails_count >= 0),
  add column last_trade_at timestamptz;

-- ===== confirm_trade =====
create or replace function public.confirm_trade(p_chat_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  v_listing_id uuid;
  v_listing    public.listings;
  v_lock       public.trade_locks;
  v_is_seller  boolean;
  v_trade_id   uuid;
  v_sibling    uuid;
begin
  select c.listing_id into v_listing_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null then raise sqlstate 'PT403' using message = 'not_participant'; end if;

  select * into v_listing from public.listings where id = v_listing_id for update;
  select * into v_lock from public.trade_locks
   where listing_id = v_listing_id and chat_id = p_chat_id for update;
  if not found then raise sqlstate 'PT409' using message = 'no_active_lock'; end if;    -- not the lock holder
  if v_uid not in (v_lock.seller_id, v_lock.buyer_id) then
    raise sqlstate 'PT403' using message = 'not_participant';
  end if;
  v_is_seller := (v_uid = v_lock.seller_id);

  -- idempotent retry: I already confirmed
  if (v_is_seller and v_lock.seller_confirmed_at is not null)
     or (not v_is_seller and v_lock.buyer_confirmed_at is not null) then
    return jsonb_build_object('state', 'awaiting_partner');
  end if;

  -- first confirmation of the pair
  if (v_is_seller and v_lock.buyer_confirmed_at is null)
     or (not v_is_seller and v_lock.seller_confirmed_at is null) then
    update public.trade_locks
       set seller_confirmed_at = case when v_is_seller then v_now else seller_confirmed_at end,
           buyer_confirmed_at  = case when v_is_seller then buyer_confirmed_at else v_now end
     where listing_id = v_listing_id;
    perform private.system_message(p_chat_id,
      case when v_is_seller then 'seller_confirmed' else 'buyer_confirmed' end::public.system_event,
      'One trainer confirmed the trade. Waiting for the other.');
    return jsonb_build_object('state', 'awaiting_partner');
  end if;

  -- second confirmation: finalize atomically
  insert into public.completed_trades (
    listing_id, chat_id, seller_id, buyer_id, seller_handle, buyer_handle, seller_gave, buyer_gave,
    trade_type, locked_at, seller_confirmed_at, buyer_confirmed_at, completed_at)
  select v_listing.id, p_chat_id, v_lock.seller_id, v_lock.buyer_id, ps.handle, pb.handle,
         jsonb_build_object('name', v_listing.name, 'pokemonId', v_listing.pokemon_id, 'hue', v_listing.hue,
                            'shiny', v_listing.shiny, 'lucky', v_listing.lucky)
           || jsonb_strip_nulls(jsonb_build_object('formCode', v_listing.form_code, 'costumeCode', v_listing.costume_code)),
         (select m.offer from public.chat_messages m where m.id = v_lock.accepted_offer_message_id),
         v_listing.trade_type, v_lock.locked_at,
         coalesce(v_lock.seller_confirmed_at, v_now), coalesce(v_lock.buyer_confirmed_at, v_now), v_now
    from public.profiles ps, public.profiles pb
   where ps.id = v_lock.seller_id and pb.id = v_lock.buyer_id
  returning id into v_trade_id;

  delete from public.trade_locks where listing_id = v_listing_id;
  update public.listings set status = 'completed', locked_at = null, completed_at = v_now where id = v_listing_id;
  update public.chats set status = 'completed', closed_at = v_now where id = p_chat_id;
  update public.chat_members set archived_at = v_now where chat_id = p_chat_id;      -- archived for both (archiveChat)

  for v_sibling in
    update public.chats set status = 'closed', closed_at = v_now
     where listing_id = v_listing_id and id <> p_chat_id and status = 'open'
    returning id
  loop
    perform private.system_message(v_sibling, 'closed_listing_completed', 'This listing was traded to another trainer.');
  end loop;

  -- Reputation: +REP per completed trade for both parties, UTC-day streak, last_trade_at. Mirrors lib/reputation.ts.
  update public.profiles set
    trades_count  = trades_count + 1,
    rep           = least(5.0, round((coalesce(rep, 5.0) + 0.1)::numeric, 1)),   -- REP_GAIN_PER_COMPLETED_TRADE / MAX_REP
    streak_days   = case
                      when last_trade_at is not null
                           and (last_trade_at at time zone 'UTC')::date = (v_now at time zone 'UTC')::date
                        then greatest(1, streak_days)
                      when last_trade_at is not null
                           and (last_trade_at at time zone 'UTC')::date = (v_now at time zone 'UTC')::date - 1
                        then streak_days + 1
                      else 1
                    end,
    last_trade_at = v_now
   where id in (v_lock.seller_id, v_lock.buyer_id);
  perform private.system_message(p_chat_id, 'completed', 'Trade completed.');
  return jsonb_build_object('state', 'completed', 'trade_id', v_trade_id);
end $$;

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
    if p_reason = 'unresponsive' then
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
