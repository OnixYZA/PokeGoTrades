-- State-transition RPCs
-- Transcribed verbatim from SUPABASE_PLAN.md §2.4

-- ============ open_offer: buyer opens (or reuses) a chat with an opening offer ============
create or replace function public.open_offer(
  p_listing_id        uuid,
  p_client_message_id uuid,
  p_offer             jsonb default null,
  p_body              text  default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_listing public.listings;
  v_chat_id uuid;
  v_body    text := coalesce(btrim(p_body), '');
begin
  if v_uid is null or (auth.jwt()->>'is_anonymous')::boolean is not false then
    raise sqlstate 'PT403' using message = 'permanent_account_required';
  end if;
  if not private.profile_ready() then raise sqlstate 'PT403' using message = 'profile_incomplete'; end if;
  if p_client_message_id is null then raise sqlstate 'PT400' using message = 'client_id_required'; end if;
  if p_offer is null and v_body = '' then raise sqlstate 'PT400' using message = 'empty_offer'; end if;
  if p_offer is not null and not public.formal_offer_is_valid(p_offer) then
    raise sqlstate 'PT400' using message = 'invalid_offer';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for share;   -- blocks a concurrent lock
  if not found or v_listing.status <> 'open' or v_listing.untradable then
    raise sqlstate 'PT409' using message = 'listing_not_open';
  end if;
  if v_listing.seller_id = v_uid then raise sqlstate 'PT403' using message = 'own_listing'; end if;
  if private.is_blocked_pair(v_uid, v_listing.seller_id) then
    raise sqlstate 'PT403' using message = 'offer_not_allowed';      -- generic: never says who blocked whom
  end if;
  if (select count(*) from public.chats c
      where c.buyer_id = v_uid and c.created_at > now() - interval '1 hour') >= 20 then
    raise sqlstate 'PT429' using message = 'rate_limited';
  end if;

  select c.id into v_chat_id from public.chats c
   where c.listing_id = p_listing_id and c.buyer_id = v_uid and c.status = 'open';
  if v_chat_id is null then
    begin
      insert into public.chats (listing_id, seller_id, buyer_id)
      values (p_listing_id, v_listing.seller_id, v_uid)
      returning id into v_chat_id;
    exception when unique_violation then                            -- concurrent double-tap
      select c.id into v_chat_id from public.chats c
       where c.listing_id = p_listing_id and c.buyer_id = v_uid and c.status = 'open';
    end;
    insert into public.chat_members (chat_id, user_id, role)
    values (v_chat_id, v_listing.seller_id, 'seller'), (v_chat_id, v_uid, 'buyer')
    on conflict do nothing;
  end if;

  insert into public.chat_messages (chat_id, sender_id, client_id, kind, body, offer)
  values (v_chat_id, v_uid, p_client_message_id,
          case when p_offer is null then 'text' else 'offer' end::public.message_kind, v_body, p_offer)
  on conflict (sender_id, client_id) do nothing;                    -- idempotent retry
  return v_chat_id;
end $$;

-- ============ lock_trade: the SELLER accepts one buyer's offer (D1) ============
create or replace function public.lock_trade(p_chat_id uuid, p_offer_message_id uuid default null)
returns public.trade_locks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_listing_id uuid;
  v_listing    public.listings;
  v_chat       public.chats;
  v_offer_id   uuid := p_offer_message_id;
  v_lock       public.trade_locks;
begin
  select c.listing_id into v_listing_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null then raise sqlstate 'PT403' using message = 'not_seller'; end if;

  select * into v_listing from public.listings where id = v_listing_id for update;   -- serializes the race
  select * into v_chat    from public.chats    where id = p_chat_id    for update;

  if v_chat.seller_id <> v_uid then raise sqlstate 'PT403' using message = 'not_seller'; end if;
  if v_listing.status = 'locked' then raise sqlstate 'PT409' using message = 'already_locked'; end if;
  if v_listing.status <> 'open' or v_chat.status <> 'open' then
    raise sqlstate 'PT409' using message = 'not_lockable';
  end if;
  if private.is_blocked_pair(v_chat.seller_id, v_chat.buyer_id) then
    raise sqlstate 'PT409' using message = 'not_lockable';
  end if;

  if v_offer_id is not null then
    perform 1 from public.chat_messages m
     where m.id = v_offer_id and m.chat_id = p_chat_id and m.kind = 'offer' and m.sender_id = v_chat.buyer_id;
    if not found then raise sqlstate 'PT400' using message = 'invalid_offer_message'; end if;
  else
    select m.id into v_offer_id from public.chat_messages m
     where m.chat_id = p_chat_id and m.kind = 'offer' and m.sender_id = v_chat.buyer_id
     order by m.created_at desc, m.id desc limit 1;                 -- may stay null: negotiated in chat
  end if;

  insert into public.trade_locks (listing_id, chat_id, seller_id, buyer_id, accepted_offer_message_id)
  values (v_listing_id, p_chat_id, v_chat.seller_id, v_chat.buyer_id, v_offer_id)
  returning * into v_lock;                                          -- PK is the final backstop

  update public.listings set status = 'locked', locked_at = now() where id = v_listing_id;
  perform private.system_message(p_chat_id, 'locked', 'Seller accepted this offer. Competing offers are frozen.');
  return v_lock;
end $$;

-- ============ unlock_trade: the SELLER re-opens competing offers (D1); clears confirmations (D2) ============
create or replace function public.unlock_trade(p_chat_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_listing_id uuid; v_seller_id uuid;
begin
  select c.listing_id, c.seller_id into v_listing_id, v_seller_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null or v_seller_id <> v_uid then
    raise sqlstate 'PT403' using message = 'not_seller';
  end if;
  perform 1 from public.listings where id = v_listing_id for update;

  delete from public.trade_locks where listing_id = v_listing_id and chat_id = p_chat_id;  -- confirmations go too
  if not found then raise sqlstate 'PT409' using message = 'not_lock_holder'; end if;

  update public.listings set status = 'open', locked_at = null where id = v_listing_id;
  perform private.system_message(p_chat_id, 'unlocked', 'Seller re-opened competing offers.');
end $$;

-- ============ confirm_trade: either party of the lock-holder chat; the 2nd confirmation finalizes (D2) ============
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
                            'shiny', v_listing.shiny, 'lucky', v_listing.lucky),
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

  update public.profiles set trades_count = trades_count + 1 where id in (v_lock.seller_id, v_lock.buyer_id);
  perform private.system_message(p_chat_id, 'completed', 'Trade completed.');
  return jsonb_build_object('state', 'completed', 'trade_id', v_trade_id);
end $$;

-- ============ withdraw_trade_confirmation: allowed until the partner confirms ============
create or replace function public.withdraw_trade_confirmation(p_chat_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_listing_id uuid; v_withdrew boolean;
begin
  select c.listing_id into v_listing_id from public.chats c where c.id = p_chat_id;
  if v_uid is null or v_listing_id is null then raise sqlstate 'PT403' using message = 'not_participant'; end if;
  perform 1 from public.listings where id = v_listing_id for update;

  update public.trade_locks
     set seller_confirmed_at = case when seller_id = v_uid then null else seller_confirmed_at end,
         buyer_confirmed_at  = case when buyer_id  = v_uid then null else buyer_confirmed_at  end
   where listing_id = v_listing_id and chat_id = p_chat_id and v_uid in (seller_id, buyer_id)
     and ((seller_id = v_uid and seller_confirmed_at is not null)
       or (buyer_id  = v_uid and buyer_confirmed_at  is not null))
  returning true into v_withdrew;
  if not v_withdrew then raise sqlstate 'PT409' using message = 'nothing_to_withdraw'; end if;  -- no phantom system row
  perform private.system_message(p_chat_id, 'confirmation_withdrawn', 'A trainer withdrew their confirmation.');
end $$;

-- ============ bail_and_block: either participant; soft-close, release lock, block, report ============
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
begin
  select * into v_chat from public.chats where id = p_chat_id;
  if v_uid is null or not found or v_uid not in (v_chat.seller_id, v_chat.buyer_id) then
    raise sqlstate 'PT403' using message = 'not_participant';
  end if;
  if v_chat.status <> 'open' then raise sqlstate 'PT409' using message = 'chat_not_open'; end if;
  if v_note is not null and char_length(v_note) > 280 then raise sqlstate 'PT400' using message = 'note_too_long'; end if;
  v_other := case when v_uid = v_chat.seller_id then v_chat.buyer_id else v_chat.seller_id end;

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

-- ============ withdraw_listing: seller soft-closes an open (unlocked) listing ============
create or replace function public.withdraw_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_listing public.listings; v_chat uuid;
begin
  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_uid is null or not found or v_listing.seller_id <> v_uid then
    raise sqlstate 'PT403' using message = 'not_seller';
  end if;
  if v_listing.status = 'locked' then raise sqlstate 'PT409' using message = 'unlock_first'; end if;
  if v_listing.status <> 'open' then raise sqlstate 'PT409' using message = 'not_open'; end if;

  update public.listings set status = 'withdrawn', withdrawn_at = now() where id = p_listing_id;
  for v_chat in
    update public.chats set status = 'closed', closed_at = now(), closed_by = v_uid
     where listing_id = p_listing_id and status = 'open' returning id
  loop
    perform private.system_message(v_chat, 'closed_listing_withdrawn', 'The seller withdrew this listing.');
  end loop;
end $$;

-- ============ get_handshake: friend codes + safe zone, only for the lock-holder chat's two parties ============
create or replace function public.get_handshake(p_chat_id uuid)
returns table (
  my_role public.chat_role, my_handle text, my_friend_code text,
  partner_id uuid, partner_handle text, partner_friend_code text, partner_safe_loc text,
  partner_trades_count integer, lock_locked_at timestamptz,
  lock_seller_confirmed_at timestamptz, lock_buyer_confirmed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_lock public.trade_locks; v_partner uuid;
begin
  select * into v_lock from public.trade_locks tl where tl.chat_id = p_chat_id;
  if v_uid is null or not found or v_uid not in (v_lock.seller_id, v_lock.buyer_id) then
    raise sqlstate 'PT403' using message = 'handshake_unavailable';   -- same error for missing and forbidden
  end if;
  v_partner := case when v_uid = v_lock.seller_id then v_lock.buyer_id else v_lock.seller_id end;
  return query
    select case when v_uid = v_lock.seller_id then 'seller' else 'buyer' end::public.chat_role,
           me.handle, mep.friend_code, pa.id, pa.handle, pap.friend_code, pap.safe_loc, pa.trades_count,
           v_lock.locked_at, v_lock.seller_confirmed_at, v_lock.buyer_confirmed_at
      from public.profiles me
      join public.profile_private mep on mep.user_id = me.id
     cross join public.profiles pa
      join public.profile_private pap on pap.user_id = pa.id
     where me.id = v_uid and pa.id = v_partner;
end $$;

-- ============ execute grants ============
revoke execute on function
  public.open_offer(uuid, uuid, jsonb, text), public.lock_trade(uuid, uuid), public.unlock_trade(uuid),
  public.confirm_trade(uuid), public.withdraw_trade_confirmation(uuid),
  public.bail_and_block(uuid, public.bail_reason, text), public.withdraw_listing(uuid), public.get_handshake(uuid)
  from public, anon;
grant execute on function
  public.open_offer(uuid, uuid, jsonb, text), public.lock_trade(uuid, uuid), public.unlock_trade(uuid),
  public.confirm_trade(uuid), public.withdraw_trade_confirmation(uuid),
  public.bail_and_block(uuid, public.bail_reason, text), public.withdraw_listing(uuid), public.get_handshake(uuid)
  to authenticated;
