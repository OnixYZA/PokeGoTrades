-- Grants and RLS
-- Transcribed verbatim from SUPABASE_PLAN.md §2.1-§2.3

-- ===== §2.1 Revoke everything, then grant columns explicitly =====
revoke all on all tables in schema public from anon, authenticated;

grant select on public.areas to authenticated;
grant select, update (handle, lvl, team, bio) on public.profiles to authenticated;
grant select, update (friend_code, safe_loc) on public.profile_private to authenticated;
grant select, insert (list, creature, sort_order), update (creature, sort_order), delete
  on public.trainer_creatures to authenticated;

grant select,
  insert (id, name, pokemon_id, form, catch_year, lucky, shiny, hue, accent, bg, loc, trade_type,
          iv_atk, iv_def, iv_sta, looking, tags, notes),
  update (name, pokemon_id, form, catch_year, lucky, shiny, hue, accent, bg, loc, trade_type,
          iv_atk, iv_def, iv_sta, looking, tags, notes)
  on public.listings to authenticated;                 -- never status, seller_id, *_at, pvp/demand, untradable

grant select, insert (listing_id, kind, storage_path), delete on public.listing_proofs to authenticated;
grant select on public.chats to authenticated;                                    -- all writes through RPCs
grant select, update (last_read_at, archived_at) on public.chat_members to authenticated;
grant select, insert (chat_id, client_id, kind, body, offer) on public.chat_messages to authenticated;
grant select on public.trade_locks, public.completed_trades to authenticated;     -- RPC-only writes
grant select, delete on public.blocks to authenticated;                           -- delete = unblock
grant select on public.my_inbox, public.my_trade_history to authenticated;
grant select on public.trade_cost_matrix to authenticated;                        -- only if the mirror exists
-- moderation_reports: no client grants at all.

grant all on all tables in schema public to service_role;

-- ===== §2.2 Enable RLS on every table =====
alter table public.areas              enable row level security;
alter table public.profiles           enable row level security;
alter table public.profile_private    enable row level security;
alter table public.trainer_creatures  enable row level security;
alter table public.listings           enable row level security;
alter table public.listing_proofs     enable row level security;
alter table public.chats              enable row level security;
alter table public.chat_members       enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.trade_locks        enable row level security;
alter table public.completed_trades   enable row level security;
alter table public.blocks             enable row level security;
alter table public.moderation_reports enable row level security;   -- no policies = deny all clients
alter table public.trade_cost_matrix  enable row level security;

-- ===== §2.3 Policies =====
-- reference data
create policy areas_read       on public.areas             for select to authenticated using (true);
create policy cost_matrix_read on public.trade_cost_matrix for select to authenticated using (true);

-- profiles: public columns readable; only self may update (column grants limit which columns)
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- profile_private: owner only. The partner gets the friend code through get_handshake() and nowhere else.
create policy profile_private_read_self on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()));
create policy profile_private_update_self on public.profile_private for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- trainer_creatures: public read (Arsenal / Wishlist grids), owner write
create policy trainer_creatures_read on public.trainer_creatures for select to authenticated using (true);
create policy trainer_creatures_insert_self on public.trainer_creatures for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy trainer_creatures_update_self on public.trainer_creatures for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy trainer_creatures_delete_self on public.trainer_creatures for delete to authenticated
  using (owner_id = (select auth.uid()));

-- listings
create policy listings_read on public.listings for select to authenticated using (
     seller_id = (select auth.uid())
  or (status in ('open', 'locked') and seller_id not in (select private.my_blocker_ids()))
  or id in (select private.my_chat_listing_ids())        -- participants keep seeing completed/withdrawn listings
);
create policy listings_insert_own on public.listings for insert to authenticated
  with check (seller_id = (select auth.uid()) and status = 'open');
create policy listings_insert_permanent_only on public.listings as restrictive for insert to authenticated
  with check ((select auth.jwt()->>'is_anonymous')::boolean is false and (select private.profile_ready()));
-- Owner may edit only while open; status is not grantable; the guard trigger freezes trade fields once offers exist.
create policy listings_update_own_open on public.listings for update to authenticated
  using (seller_id = (select auth.uid()) and status = 'open')
  with check (seller_id = (select auth.uid()) and status = 'open');
-- No DELETE policy or grant: withdraw_listing() soft-closes instead (D6).

-- listing_proofs
create policy listing_proofs_read on public.listing_proofs for select to authenticated
  using (listing_id in (select l.id from public.listings l));       -- inherits listings RLS
create policy listing_proofs_insert_owner on public.listing_proofs for insert to authenticated with check (
  exists (select 1 from public.listings l
          where l.id = listing_id and l.seller_id = (select auth.uid()) and l.status = 'open')
  and storage_path = (select auth.uid())::text || '/' || listing_id::text || '/' || kind::text
  and private.proof_object_exists(storage_path)
);
create policy listing_proofs_delete_owner on public.listing_proofs for delete to authenticated using (
  exists (select 1 from public.listings l
          where l.id = listing_id and l.seller_id = (select auth.uid()) and l.status = 'open')
);

-- chats: buyer or seller only; no client writes at all
create policy chats_read_participants on public.chats for select to authenticated
  using ((select auth.uid()) in (seller_id, buyer_id));

-- chat_members: own row only (read receipts and archive)
create policy chat_members_read_self on public.chat_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy chat_members_update_self on public.chat_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- chat_messages
create policy chat_messages_read_participants on public.chat_messages for select to authenticated
  using (chat_id in (select private.my_chat_ids()));
create policy chat_messages_insert_participant on public.chat_messages for insert to authenticated with check (
      sender_id = (select auth.uid())
  and kind in ('text', 'offer')                  -- 'system' is RPC-only
  and private.can_post_message(chat_id)          -- rejects bailed / closed / completed / frozen / blocked
);
create policy chat_messages_insert_permanent_only on public.chat_messages as restrictive for insert to authenticated
  with check ((select auth.jwt()->>'is_anonymous')::boolean is false);
-- No UPDATE or DELETE policy: messages are immutable.

-- trade_locks / completed_trades: the two parties only; writes only inside RPCs
create policy trade_locks_read_parties on public.trade_locks for select to authenticated
  using ((select auth.uid()) in (seller_id, buyer_id));
create policy completed_trades_read_parties on public.completed_trades for select to authenticated
  using ((select auth.uid()) in (seller_id, buyer_id));

-- blocks: the blocker sees and removes their own; the blocked user never learns the row exists
create policy blocks_read_self on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy blocks_delete_self on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));
