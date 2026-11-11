-- Security hardening. A NEW migration (20261103000500 is the last one before it and MUST be applied first:
-- section D recreates its bail_and_block; `supabase db push` applies in filename order, so that holds).
-- Idempotent: safe to re-run (create ... if not exists, create or replace, drop ... if exists before create,
-- and revoke / grant are naturally idempotent).
--
-- A. Function EXECUTE hygiene. 20260916000100 ran `alter default privileges in schema public revoke execute on
--    functions from public`. That was a NO-OP: a schema-scoped default ACL can only remove privileges that
--    schema-scoped defaults granted, never the built-in global PUBLIC EXECUTE every new function starts with. So
--    on hosted these were executable by PUBLIC (hence anon): public.is_creature_untradable, private.creature_json_is_untradable,
--    the SECURITY DEFINER trigger functions private.guard_listing_tradable / guard_offer_tradable /
--    notify_profile_ocr, private.profile_proof_object_exists, and the four CHECK-constraint validators. Trigger
--    firing does not check EXECUTE, so revoking from the trigger functions is safe. The validators keep
--    authenticated and service_role (CHECK constraints on rows written by trainers and by the OCR worker).
--    (`anon` has no USAGE on schema private, which limited the exposure but is not a reason to leave PUBLIC.)
-- B. public.pokemon_market_demand: SELECT only, for authenticated and service_role (see 20260927000300).
-- C. Rate limits with stable message codes (sqlstate PT429): proof_rate_limited (profile_proofs 5 / hour,
--    listing_proofs 30 / hour), listing_rate_limited (listings 10 / hour), plus a storage-level cap on
--    profile-proofs objects. Nothing limited these before beyond the one-in-flight index, and each proof row
--    queues an OCR job.
-- D. bail_and_block race fix: lock the pair's listings in id order BEFORE reading, then re-check the chat.
-- E. Nothing for the other trade RPCs: lock_trade, unlock_trade, confirm_trade, withdraw_trade_confirmation and
--    withdraw_listing already lock the listing row first (lock order: listings, then chats / trade_locks).
--
-- Deliberately NOT done:
--  * No global `alter default privileges for role postgres revoke execute on functions from public`: it would also
--    strip PUBLIC EXECUTE from the functions of any extension `postgres` installs later, breaking them. The
--    invariant is enforced by a test instead (supabase/tests/security_hardening.test.sql scans the catalog).
--  * supabase_admin's default ACLs in public still grant anon / authenticated everything on new tables, functions
--    and sequences. `postgres` is not a member of supabase_admin on hosted, so a migration cannot change that.
--    Every new object therefore needs an explicit revoke in its own migration; the pgTAP guard fails when one leaks.

-- ===== A. Function EXECUTE hygiene =====
revoke execute on function public.is_creature_untradable(integer, text) from public, anon, authenticated;
revoke execute on function private.creature_json_is_untradable(jsonb) from public, anon, authenticated;
revoke execute on function private.guard_listing_tradable() from public, anon, authenticated;
revoke execute on function private.guard_offer_tradable() from public, anon, authenticated;
revoke execute on function private.notify_profile_ocr() from public, anon, authenticated;

-- RLS on listing_proofs / profile_proofs calls this as `authenticated`; PUBLIC does not need it.
revoke execute on function private.profile_proof_object_exists(text) from public, anon;
grant execute on function private.profile_proof_object_exists(text) to authenticated;

revoke execute on function public.array_is_distinct(anyarray) from public, anon;
revoke execute on function public.creature_ref_array_is_valid(jsonb, integer) from public, anon;
revoke execute on function public.creature_ref_is_valid(jsonb, text[]) from public, anon;
revoke execute on function public.formal_offer_is_valid(jsonb) from public, anon;
grant execute on function public.array_is_distinct(anyarray), public.creature_ref_array_is_valid(jsonb, integer),
  public.creature_ref_is_valid(jsonb, text[]), public.formal_offer_is_valid(jsonb) to authenticated, service_role;

-- ===== B. View grants =====
revoke all on public.pokemon_market_demand from public, anon, authenticated, service_role;
grant select on public.pokemon_market_demand to authenticated, service_role;

-- ===== C. Upload / OCR-job rate limits =====
-- An append-only ledger rather than a count of live rows: listing_proofs rows can be deleted (listing open) and
-- re-inserted on the same (listing, kind), so counting live rows is evadable; each re-insert queues a new OCR job.
-- Not visible to clients (no grants, and `private` is not exposed).
create table if not exists private.proof_upload_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  queue text not null check (queue in ('listing_proofs', 'profile_proofs')),
  created_at timestamptz not null default now()
);
create index if not exists proof_upload_log_user_queue_time_idx
  on private.proof_upload_log (user_id, queue, created_at);
revoke all on table private.proof_upload_log from public, anon, authenticated;

-- One trigger function for both proof tables. The ledger insert runs in the same transaction as the row insert, so
-- a raised error or a failed insert (RLS, unique violation, ...) rolls the ledger row back too.
create or replace function private.enforce_proof_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer;
begin
  -- Seed, migrations and the service-role worker are not trainer uploads.
  if v_uid is null then return new; end if;

  -- An idempotent client retry passes through untouched, so it still hits the unique violation the client handles.
  if tg_table_name = 'listing_proofs' then
    if exists (select 1 from public.listing_proofs where listing_id = new.listing_id and kind = new.kind) then
      return new;
    end if;
  elsif tg_table_name = 'profile_proofs' then
    if exists (select 1 from public.profile_proofs where id = new.id) then
      return new;
    end if;
  end if;

  -- Serialise one trainer's concurrent inserts so the count below is exact.
  perform pg_advisory_xact_lock(hashtextextended('proof_upload_log:' || tg_table_name || ':' || v_uid::text, 0));

  delete from private.proof_upload_log
   where user_id = v_uid and queue = tg_table_name and created_at < now() - interval '1 day';

  v_limit := case tg_table_name
    when 'profile_proofs' then 5     -- PROFILE_PROOFS_PER_HOUR
    else 30                          -- LISTING_PROOFS_PER_HOUR: the 10-listing hourly cap x 3 proof kinds
  end;

  if (select count(*) from private.proof_upload_log
       where user_id = v_uid and queue = tg_table_name and created_at > now() - interval '1 hour') >= v_limit then
    raise sqlstate 'PT429' using message = 'proof_rate_limited';
  end if;

  insert into private.proof_upload_log (user_id, queue) values (v_uid, tg_table_name);
  return new;
end $$;

drop trigger if exists listing_proofs_rate_limit on public.listing_proofs;
create trigger listing_proofs_rate_limit before insert on public.listing_proofs
  for each row execute function private.enforce_proof_rate_limit();
drop trigger if exists profile_proofs_rate_limit on public.profile_proofs;
create trigger profile_proofs_rate_limit before insert on public.profile_proofs
  for each row execute function private.enforce_proof_rate_limit();

-- Listings have no client DELETE (soft-withdraw only), so live rows are an exact count.
create or replace function private.enforce_listing_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  -- The client's retry path relies on the 23505 (insertListing in lib/api/listings.ts): never mask it with a 429.
  if exists (select 1 from public.listings where id = new.id) then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('listings:' || v_uid::text, 0));

  if (select count(*) from public.listings
       where seller_id = v_uid and created_at > now() - interval '1 hour') >= 10 then   -- LISTINGS_PER_HOUR
    raise sqlstate 'PT429' using message = 'listing_rate_limited';
  end if;
  return new;
end $$;

drop trigger if exists listings_rate_limit on public.listings;
create trigger listings_rate_limit before insert on public.listings
  for each row execute function private.enforce_listing_rate_limit();

revoke execute on function private.enforce_proof_rate_limit(), private.enforce_listing_rate_limit()
  from public, anon, authenticated;

-- Storage-level cap for profile-proofs. The object is uploaded BEFORE its row and clients can never delete or
-- overwrite one (no UPDATE / DELETE policy), so counting existing objects is exact and cannot be evaded.
create or replace function private.profile_proof_uploads_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 10            -- PROFILE_PROOF_OBJECTS_PER_HOUR: looser than the 5-row limit, so a normal trainer meets the clear PT429 first
    from storage.objects o
   where o.bucket_id = 'profile-proofs'
     and o.name like (select auth.uid()::text) || '/%'
     and o.owner_id = (select auth.uid()::text)
     and o.created_at > now() - interval '1 hour'
$$;
revoke execute on function private.profile_proof_uploads_allowed() from public, anon;
grant execute on function private.profile_proof_uploads_allowed() to authenticated;

-- RESTRICTIVE, because the existing insert policies are permissive and a permissive addition would simply be
-- OR'ed away. The `bucket_id <>` guard keeps it neutral for every other bucket. listing-proofs gets no object cap:
-- its paths are fixed per (listing, kind), so storage cannot grow past 3 objects per listing, and listings
-- themselves are capped above.
drop policy if exists profile_proofs_obj_insert_rate_limit on storage.objects;
create policy profile_proofs_obj_insert_rate_limit on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'profile-proofs' or (select private.profile_proof_uploads_allowed()));

-- ===== D. bail_and_block race fix =====
-- Recreated from 20261103000500; ONLY the marked block near the top is new. Grants are untouched (create or
-- replace). The numbers are pinned to lib/reputation.ts by lib/reputation.test.ts (the trailing comments are parsed).
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

  -- ===== CHANGED vs 20261103000500: serialise on the listing rows before reading anything we act on =====
  -- Every other trade RPC (lock_trade, unlock_trade, confirm_trade, withdraw_trade_confirmation,
  -- withdraw_listing) locks the LISTING row first, then reads chats / trade_locks. This function used to read the
  -- chat and the lock unlocked, apply the rep penalty, and only then lock listings inside the loop, so two
  -- concurrent bails on one pair could both see the lock and both charge the penalty, and a bail racing a
  -- confirm_trade completion could charge the penalty and then `continue` past the already-completed chat.
  -- Locking every listing this pair has an open chat on (plus this chat's own), in id order, makes concurrent
  -- bails queue on the same rows in the same order (no deadlock) and matches the other RPCs' lock order.
  perform 1 from public.listings l
   where l.id = v_chat.listing_id
      or l.id in (select c.listing_id from public.chats c
                   where c.status = 'open'
                     and ((c.seller_id = v_uid and c.buyer_id = v_other) or (c.seller_id = v_other and c.buyer_id = v_uid)))
   order by l.id
   for update;

  -- Re-read: a concurrent bail or a completion that committed while we waited reads as closed, so no penalty.
  select * into v_chat from public.chats where id = p_chat_id;
  if v_chat.status <> 'open' then raise sqlstate 'PT409' using message = 'chat_not_open'; end if;
  -- ===== end of changed block =====

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
