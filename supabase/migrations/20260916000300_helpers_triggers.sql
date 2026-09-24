-- Helpers, guards, invariants, broadcast triggers
-- Transcribed verbatim from SUPABASE_PLAN.md §1.10

-- ---------- generic ----------
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_updated_at        before update on public.profiles        for each row execute function private.set_updated_at();
create trigger profile_private_updated_at before update on public.profile_private for each row execute function private.set_updated_at();
create trigger listings_updated_at        before update on public.listings        for each row execute function private.set_updated_at();
create trigger chats_updated_at           before update on public.chats           for each row execute function private.set_updated_at();

-- ---------- profile bootstrap on auth.users insert (anonymous or permanent) ----------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.profiles (id, handle)
      values (new.id, 'Trainer' || lpad(floor(random() * 100000000)::int::text, 8, '0'));
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then raise; end if;
    end;
  end loop;
  insert into public.profile_private (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.handle is distinct from old.handle then
    if new.handle ~ '^Trainer[0-9]{8}$' then
      raise sqlstate 'PT400' using message = 'handle_reserved';
    end if;
    new.handle_is_placeholder := false;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function private.guard_profile_update();

-- ---------- identity / visibility helpers (used inside RLS; `private` is not exposed to PostgREST) ----------
create function private.my_chat_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.chats c where (select auth.uid()) in (c.seller_id, c.buyer_id)
$$;

create function private.my_chat_listing_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct c.listing_id from public.chats c where (select auth.uid()) in (c.seller_id, c.buyer_id)
$$;

create function private.my_blocker_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select b.blocker_id from public.blocks b where b.blocked_id = (select auth.uid())
$$;

create function private.is_blocked_pair(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks x
                 where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a))
$$;

create function private.profile_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.profile_private pp on pp.user_id = p.id
    where p.id = (select auth.uid()) and not p.handle_is_placeholder
      and p.team is not null and pp.friend_code is not null)
$$;

-- Participant, chat open, listing tradable, not frozen, not blocked.
create function private.can_post_message(p_chat_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.chats c
    join public.listings l on l.id = c.listing_id
    left join public.trade_locks tl on tl.listing_id = c.listing_id
    where c.id = p_chat_id
      and c.status = 'open'
      and (select auth.uid()) in (c.seller_id, c.buyer_id)
      and l.status in ('open', 'locked')
      and (tl.chat_id is null or tl.chat_id = c.id)          -- frozen siblings cannot post
      and not private.is_blocked_pair(c.seller_id, c.buyer_id))
$$;

create function private.can_attach_proof(p_listing text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_listing !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else (select auth.jwt()->>'is_anonymous')::boolean is false
     and exists (select 1 from public.listings l
                 where l.id = p_listing::uuid and l.seller_id = (select auth.uid()) and l.status = 'open')
  end
$$;

create function private.proof_object_exists(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o
                 where o.bucket_id = 'listing-proofs' and o.name = p_path
                   and o.owner_id = (select auth.uid()::text))
$$;

create function private.can_receive_topic(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_topic = 'user:' || (select auth.uid())::text then true
    when p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      exists (select 1 from public.chats c
              where c.id = substr(p_topic, 6)::uuid and (select auth.uid()) in (c.seller_id, c.buyer_id))
    when p_topic ~ '^listing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      exists (select 1 from public.listings l
              where l.id = substr(p_topic, 9)::uuid and l.status in ('open', 'locked'))
    else false
  end
$$;

grant execute on function private.my_chat_ids(), private.my_chat_listing_ids(), private.my_blocker_ids(),
  private.is_blocked_pair(uuid, uuid), private.profile_ready(), private.can_post_message(uuid),
  private.can_attach_proof(text), private.proof_object_exists(text), private.can_receive_topic(text)
  to authenticated;

-- ---------- listing edit guard: no bait-and-switch once offers exist ----------
create function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.form, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc)
     is distinct from
     (old.name, old.pokemon_id, old.form, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;
create trigger listings_guard before update on public.listings for each row execute function private.guard_listing_update();

-- ---------- invariant: listings.status = 'locked' <=> a trade_locks row exists (checked at COMMIT) ----------
create function private.assert_lock_consistency(p_listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_status public.listing_status;
begin
  select l.status into v_status from public.listings l where l.id = p_listing_id;
  if not found then return; end if;
  if (v_status = 'locked') <> exists (select 1 from public.trade_locks tl where tl.listing_id = p_listing_id) then
    raise exception 'lock invariant violated for listing %', p_listing_id using errcode = '23514';
  end if;
end $$;

create function private.check_lock_consistency_from_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.assert_lock_consistency(old.listing_id);
  else perform private.assert_lock_consistency(new.listing_id); end if;
  return null;
end $$;

create function private.check_lock_consistency_from_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform private.assert_lock_consistency(new.id); return null; end $$;

create constraint trigger trade_locks_consistency after insert or delete on public.trade_locks
  deferrable initially deferred for each row execute function private.check_lock_consistency_from_lock();
create constraint trigger listings_lock_consistency after update on public.listings
  deferrable initially deferred for each row
  when (old.status is distinct from new.status) execute function private.check_lock_consistency_from_listing();

-- ---------- message rate limit ----------
create function private.enforce_message_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sender_id is not null and (
       select count(*) from public.chat_messages m
       where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 30 then
    raise sqlstate 'PT429' using message = 'rate_limited';
  end if;
  return new;
end $$;
create trigger chat_messages_rate_limit before insert on public.chat_messages
  for each row execute function private.enforce_message_rate_limit();

-- ---------- system messages (only ever called from definer RPCs) ----------
create function private.system_message(p_chat_id uuid, p_event public.system_event, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.chat_messages (chat_id, sender_id, kind, body, system_event)
  values (p_chat_id, null, 'system', p_body, p_event);
$$;

-- ---------- realtime broadcasts (private topics, minimal payloads) ----------
create function private.broadcast(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin perform realtime.send(p_payload, p_event, p_topic, true); end $$;

create function private.on_message_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_chat public.chats;
begin
  update public.chats
     set last_message_at = new.created_at,
         last_message_preview = left(case new.kind
           when 'offer'  then 'Formal offer · ' || (new.offer->>'name')
           when 'system' then initcap(replace(new.system_event::text, '_', ' '))
           else new.body end, 120)
   where id = new.chat_id
  returning * into v_chat;
  perform private.broadcast('chat:' || new.chat_id, 'message', to_jsonb(new));
  perform private.broadcast('user:' || v_chat.seller_id, 'chat_updated',
    jsonb_build_object('chat_id', new.chat_id, 'last_message_at', new.created_at));
  perform private.broadcast('user:' || v_chat.buyer_id, 'chat_updated',
    jsonb_build_object('chat_id', new.chat_id, 'last_message_at', new.created_at));
  return null;
end $$;
create trigger chat_messages_after_insert after insert on public.chat_messages
  for each row execute function private.on_message_inserted();

create function private.on_chat_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb := jsonb_build_object('op', lower(tg_op), 'chat_id', new.id,
                                              'listing_id', new.listing_id, 'status', new.status);
begin
  perform private.broadcast('user:' || new.seller_id, 'chat', v_payload);   -- new parallel offer, or status change
  if tg_op = 'UPDATE' then
    perform private.broadcast('user:' || new.buyer_id, 'chat', v_payload);
  end if;
  return null;
end $$;
create trigger chats_insert_broadcast after insert on public.chats
  for each row execute function private.on_chat_changed();
create trigger chats_status_broadcast after update of status on public.chats
  for each row when (old.status is distinct from new.status) execute function private.on_chat_changed();

create function private.on_trade_lock_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row public.trade_locks; v_payload jsonb;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_payload := jsonb_build_object(
    'op', lower(tg_op), 'released', tg_op = 'DELETE',
    'listing_id', v_row.listing_id, 'chat_id', v_row.chat_id, 'locked_at', v_row.locked_at,
    'seller_confirmed_at', v_row.seller_confirmed_at, 'buyer_confirmed_at', v_row.buyer_confirmed_at);
  perform private.broadcast('user:' || v_row.seller_id, 'lock', v_payload);   -- only the two parties
  perform private.broadcast('user:' || v_row.buyer_id,  'lock', v_payload);
  return null;
end $$;
create trigger trade_locks_broadcast after insert or update or delete on public.trade_locks
  for each row execute function private.on_trade_lock_changed();

-- Sibling buyers must learn that a listing froze, without learning who won it.
create function private.on_listing_status_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_payload jsonb := jsonb_build_object('listing_id', new.id, 'status', new.status);   -- no holder identity
begin
  perform private.broadcast('listing:' || new.id, 'listing_status', v_payload);
  for v_uid in
    select distinct u from public.chats c cross join lateral unnest(array[c.seller_id, c.buyer_id]) as u
    where c.listing_id = new.id and c.status <> 'bailed'
  loop
    perform private.broadcast('user:' || v_uid, 'listing_status', v_payload);
  end loop;
  return null;
end $$;
create trigger listings_status_broadcast after update of status on public.listings
  for each row when (old.status is distinct from new.status) execute function private.on_listing_status_changed();

revoke execute on all functions in schema private from public, anon;
