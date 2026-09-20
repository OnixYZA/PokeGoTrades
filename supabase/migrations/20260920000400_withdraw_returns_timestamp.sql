-- Makes public.withdraw_trade_confirmation return the server's authoritative timestamp instead of void.
--
-- With `returns void`, the client had nothing to stamp `lockEventVersion` with except its own clock
-- (`new Date().toISOString()`). `lockEventVersion` is later compared against other `trade_locks.updated_at`
-- values — a server clock, via the stale-frame guard in store/lock-state.ts (`isStaleLock`) — so a client
-- clock running ahead of the server could make a partner's subsequent, genuinely newer confirmation frame
-- look older and get dropped. Returning the row's own `updated_at` — the same value a realtime `lock`
-- broadcast would carry for this write (migration …000300) — closes that gap: the client now stamps
-- `lockEventVersion` with a server timestamp, like every other write to that map already does.
--
-- Postgres cannot `create or replace` a function with a different return type, so the `returns void`
-- version (redefined by migration …000100) must be dropped first. Unlike `create or replace`, `drop
-- function` also discards its grants, so the `execute` grant from migration …000500 is reissued at the end
-- of this file — a fresh `create function` defaults to PUBLIC execute, so both the revoke and the grant
-- from …000500 must be reissued, or `anon` would silently regain access via PUBLIC.
--
-- Behaviour is otherwise identical to migration …000100: the same PT403 `not_participant` guard, the same
-- PT409 `nothing_to_withdraw` guard (including the `is distinct from true` fix for the NULL-vs-false bug
-- that migration fixed), the same `confirmation_withdrawn` system message, `security definer` and
-- `set search_path = ''`. The only change is capturing `updated_at` from the UPDATE's own `returning`
-- clause — the row is already being written; there is no reason to re-select it.
drop function public.withdraw_trade_confirmation(uuid);

create function public.withdraw_trade_confirmation(p_chat_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_listing_id uuid; v_withdrew boolean; v_updated_at timestamptz;
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
  returning true, updated_at into v_withdrew, v_updated_at;
  if v_withdrew is distinct from true then          -- NULL when no row matched: no phantom system row
    raise sqlstate 'PT409' using message = 'nothing_to_withdraw';
  end if;
  perform private.system_message(p_chat_id, 'confirmation_withdrawn', 'A trainer withdrew their confirmation.');
  return v_updated_at;
end $$;

revoke execute on function public.withdraw_trade_confirmation(uuid) from public, anon;
grant execute on function public.withdraw_trade_confirmation(uuid) to authenticated;
