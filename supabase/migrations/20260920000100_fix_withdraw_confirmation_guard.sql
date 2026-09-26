-- Fix for public.withdraw_trade_confirmation (originally SUPABASE_PLAN.md §2.4, migration …000500).
--
-- `update … returning true into v_withdrew` leaves v_withdrew NULL, not false, when no row matched. The
-- original guard `if not v_withdrew then raise …` evaluates `not NULL` = NULL, which is not true, so the
-- 'nothing_to_withdraw' error was never raised and the RPC wrote a phantom 'confirmation_withdrawn'
-- system message for a trainer who had nothing to withdraw (found by the store end-to-end test).
--
-- Behaviour is otherwise identical; grants are unchanged by CREATE OR REPLACE.
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
  if v_withdrew is distinct from true then          -- NULL when no row matched: no phantom system row
    raise sqlstate 'PT409' using message = 'nothing_to_withdraw';
  end if;
  perform private.system_message(p_chat_id, 'confirmation_withdrawn', 'A trainer withdrew their confirmation.');
end $$;
