-- Gives `public.trade_locks` a version token, so the client can tell a stale lock frame from a fresh one.
--
-- The row carried only `locked_at` / `seller_confirmed_at` / `buyer_confirmed_at`, and the broadcast in
-- `private.on_trade_lock_changed` sent them with no sequence of any kind. A client had no way to order two
-- observations of the same lock, so whichever arrived last won. That is the stale-frame race: a `hydrate()`
-- issued before a confirmation resolves after it, and its older snapshot silently un-confirms a trade that
-- the server still holds as confirmed.
--
-- `updated_at` is the ordering token. It is `now()` — the transaction timestamp — so two writes in the same
-- transaction share a value; every lock change here is its own RPC call, so each gets a distinct one.
--
-- Table-level select is already granted on trade_locks (migration …000400), so the new column needs no
-- grant of its own, and `select *` in fetchMyLocks picks it up.
alter table public.trade_locks add column updated_at timestamptz not null default now();

create trigger trade_locks_updated_at before update on public.trade_locks
  for each row execute function private.set_updated_at();

-- Same function as migration …000300, with `updated_at` added to the payload. Everything else is unchanged.
create or replace function private.on_trade_lock_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row public.trade_locks; v_payload jsonb;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_payload := jsonb_build_object(
    'op', lower(tg_op), 'released', tg_op = 'DELETE',
    'listing_id', v_row.listing_id, 'chat_id', v_row.chat_id, 'locked_at', v_row.locked_at,
    'seller_confirmed_at', v_row.seller_confirmed_at, 'buyer_confirmed_at', v_row.buyer_confirmed_at,
    -- The ordering token. On DELETE this is the value the row had when it was removed, which is older than
    -- the delete itself; the client treats a release as terminal and applies it regardless of version.
    'updated_at', v_row.updated_at);
  perform private.broadcast('user:' || v_row.seller_id, 'lock', v_payload);   -- only the two parties
  perform private.broadcast('user:' || v_row.buyer_id,  'lock', v_payload);
  return null;
end $$;
