-- Tables, indexes, views, reference data
-- Transcribed verbatim from SUPABASE_PLAN.md §1.2-§1.6, §1.9

-- ===== §1.2 Identity =====
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  handle                text not null check (handle ~ '^[A-Za-z0-9]{3,15}$'),  -- URL-safe; matches every seed handle
  handle_is_placeholder boolean not null default true,
  lvl                   smallint check (lvl between 1 and 80),
  team                  public.team_name,
  bio                   text not null default '' check (char_length(bio) <= 280),
  trades_count          integer not null default 0 check (trades_count >= 0),   -- Trainer.trades, server-written
  rep                   numeric(2,1) check (rep between 0 and 5),               -- ratings out of MVP scope: null
  streak_days           integer not null default 0 check (streak_days >= 0),    -- out of MVP scope: stays 0
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index profiles_handle_lower_key on public.profiles (lower(handle));

create table public.profile_private (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  friend_code text check (friend_code ~ '^[0-9]{12}$'),   -- raw digits; the UI formats 'dddd · dddd · dddd'
  safe_loc    text check (char_length(safe_loc) <= 80),   -- 'Adyar · ~500m radius'; never coordinates (D3)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profile_private_friend_code_key
  on public.profile_private (friend_code) where friend_code is not null;

-- Trainer.arsenal / Trainer.wishlist
create table public.trainer_creatures (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  list       public.creature_list not null,
  creature   jsonb not null check (public.creature_ref_is_valid(creature)),
  sort_order smallint not null default 0 check (sort_order between 0 and 49),
  created_at timestamptz not null default now(),
  constraint trainer_creatures_slot_key unique (owner_id, list, sort_order)   -- caps each list at 50 slots
);

-- ===== §1.3 Reference data and listings =====
create table public.areas (
  name       text primary key check (char_length(name) between 1 and 60),
  sort_order smallint not null default 0
);
-- Exactly the `locations` array exported from data/listings.ts
insert into public.areas (name, sort_order) values
  ('Adyar', 1), ('East Tambaram', 2), ('Velachery', 3), ('T. Nagar', 4), ('Anna Nagar', 5), ('Besant Nagar', 6);

create table public.listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status       public.listing_status not null default 'open',
  -- creature
  name         text not null check (char_length(name) between 1 and 40),
  pokemon_id   integer not null check (pokemon_id between 1 and 99999),
  form         text not null default 'Standard' check (char_length(form) between 1 and 40),
  catch_year   smallint not null check (catch_year between 2016 and 2100),
  lucky        boolean not null default false,
  shiny        boolean not null default false,
  hue          smallint not null check (hue between 0 and 360),
  accent       text not null default '#fbbf24' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  bg           public.background_hint not null default 'meta'
                 check (bg <> 'shadow'),                  -- Shadow Pokemon cannot be traded
  loc          text not null references public.areas (name) on update cascade,   -- D3: area name only
  pvp_rank     text not null default 'NEW' check (char_length(pvp_rank) <= 8),    -- 'S+', 'A' — server-maintained
  demand_rank  text not null default 'NEW' check (char_length(demand_rank) <= 8), -- '#1' — server-maintained
  trade_type   public.trade_type not null,
  iv_atk       smallint check (iv_atk between 0 and 15),  -- Listing.iv '15/15/14' splits into three columns
  iv_def       smallint check (iv_def between 0 and 15),
  iv_sta       smallint check (iv_sta between 0 and 15),
  looking      jsonb not null default '[]'::jsonb check (public.creature_ref_array_is_valid(looking, 3)),
  tags         public.listing_tag[] not null default '{}'
                 check (cardinality(tags) <= 5 and public.array_is_distinct(tags)),
  notes        text check (notes is null or (char_length(notes) between 1 and 280 and notes = btrim(notes))),
  untradable   boolean not null default false,            -- moderator flag, not seller-settable
  locked_at    timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint listings_id_seller_key unique (id, seller_id),      -- target of the chats composite FK
  constraint listings_iv_all_or_none check ((iv_atk is null) = (iv_def is null) and (iv_def is null) = (iv_sta is null)),
  constraint listings_status_timestamps check (
        (status = 'locked')    = (locked_at is not null)
    and (status = 'completed') = (completed_at is not null)
    and (status = 'withdrawn') = (withdrawn_at is not null))
);
create index listings_feed_idx   on public.listings (loc, created_at desc) where status in ('open', 'locked');
create index listings_seller_idx on public.listings (seller_id, status);

-- Listing.screenshots: one proof per kind, so at most 3 per listing
create table public.listing_proofs (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  kind          public.proof_kind not null,
  storage_path  text not null unique,                    -- '<seller_uid>/<listing_id>/<kind>'
  ocr_status    public.ocr_status not null default 'pending',
  ocr_extracted jsonb,
  created_at    timestamptz not null default now(),
  constraint listing_proofs_one_per_kind unique (listing_id, kind)
);
create index listing_proofs_ocr_queue_idx
  on public.listing_proofs (created_at) where ocr_status in ('pending', 'processing');

-- ===== §1.4 Chats, membership, messages =====
create table public.chats (
  id                   uuid primary key default gen_random_uuid(),
  listing_id           uuid not null,
  seller_id            uuid not null references public.profiles (id) on delete cascade,
  buyer_id             uuid not null references public.profiles (id) on delete cascade,
  status               public.chat_status not null default 'open',
  last_message_at      timestamptz,
  last_message_preview text check (char_length(last_message_preview) <= 120),   -- Chat.preview
  closed_at            timestamptz,
  closed_by            uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chats_listing_seller_fk foreign key (listing_id, seller_id)
    references public.listings (id, seller_id) on delete cascade,    -- seller_id must BE the listing's seller
  constraint chats_buyer_not_seller check (buyer_id <> seller_id),   -- no offers on your own listing
  constraint chats_closed_consistency check ((status = 'open') = (closed_at is null)),
  constraint chats_id_listing_parties_key unique (id, listing_id, seller_id, buyer_id)
);
create unique index chats_one_open_per_buyer on public.chats (listing_id, buyer_id) where status = 'open';
create index chats_seller_idx  on public.chats (seller_id, last_message_at desc);
create index chats_buyer_idx   on public.chats (buyer_id, last_message_at desc);
create index chats_listing_idx on public.chats (listing_id, status);

-- Per-participant state: replaces Chat.unread and Chat.archived, which are per-viewer, not per-chat
create table public.chat_members (
  chat_id      uuid not null references public.chats (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.chat_role not null,
  last_read_at timestamptz not null default '-infinity',
  archived_at  timestamptz,
  primary key (chat_id, user_id),
  constraint chat_members_one_per_role unique (chat_id, role)
);
create index chat_members_user_idx on public.chat_members (user_id, chat_id);

create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats (id) on delete cascade,
  sender_id    uuid default auth.uid() references public.profiles (id) on delete set null,  -- null for system rows
  client_id    uuid,                                              -- idempotency key generated on the device
  kind         public.message_kind not null default 'text',
  body         text not null default '' check (char_length(body) <= 1000),
  offer        jsonb,
  system_event public.system_event,
  created_at   timestamptz not null default now(),                -- replaces ChatMessage.time
  constraint chat_messages_offer_shape  check ((kind = 'offer') = (offer is not null)
                                               and (offer is null or public.formal_offer_is_valid(offer))),
  constraint chat_messages_system_shape check ((kind = 'system') = (system_event is not null)),
  constraint chat_messages_text_nonempty check (kind <> 'text' or char_length(btrim(body)) > 0),
  constraint chat_messages_client_id_key unique (sender_id, client_id)  -- NULLs are distinct, so system rows never collide
);
create index chat_messages_chat_created_idx   on public.chat_messages (chat_id, created_at, id);
create index chat_messages_sender_created_idx on public.chat_messages (sender_id, created_at desc);

-- ===== §1.5 Trade lock and completed trades =====
-- Mirrors lockByListing: listing_id as PRIMARY KEY makes a second holder impossible to store.
create table public.trade_locks (
  listing_id                uuid primary key references public.listings (id) on delete cascade,
  chat_id                   uuid not null unique,
  seller_id                 uuid not null,
  buyer_id                  uuid not null,
  accepted_offer_message_id uuid references public.chat_messages (id) on delete set null,
  locked_at                 timestamptz not null default now(),
  seller_confirmed_at       timestamptz,   -- D2
  buyer_confirmed_at        timestamptz,   -- D2
  constraint trade_locks_chat_fk foreign key (chat_id, listing_id, seller_id, buyer_id)
    references public.chats (id, listing_id, seller_id, buyer_id) on delete cascade,
  -- Both confirmations never coexist on this row: the second one finalizes and deletes it.
  constraint trade_locks_not_both_confirmed check (seller_confirmed_at is null or buyer_confirmed_at is null)
);

create table public.completed_trades (
  id                  uuid primary key default gen_random_uuid(),
  listing_id          uuid unique references public.listings (id) on delete set null,
  chat_id             uuid unique references public.chats (id) on delete set null,
  seller_id           uuid references public.profiles (id) on delete set null,
  buyer_id            uuid references public.profiles (id) on delete set null,
  seller_handle       text not null,                                    -- snapshot: survives account deletion
  buyer_handle        text not null,
  seller_gave         jsonb not null check (public.creature_ref_is_valid(seller_gave)),
  buyer_gave          jsonb check (buyer_gave is null or public.formal_offer_is_valid(buyer_gave)),
  trade_type          public.trade_type not null,
  locked_at           timestamptz not null,
  seller_confirmed_at timestamptz not null,
  buyer_confirmed_at  timestamptz not null,
  completed_at        timestamptz not null default now()
);
create index completed_trades_seller_idx on public.completed_trades (seller_id, completed_at desc);
create index completed_trades_buyer_idx  on public.completed_trades (buyer_id, completed_at desc);

-- TradeHistoryEntry { id, gave, got, partner, date } from the caller's point of view
create view public.my_trade_history with (security_invoker = true) as
select t.id,
       case when t.seller_id = (select auth.uid()) then t.seller_gave  else t.buyer_gave   end as gave,
       case when t.seller_id = (select auth.uid()) then t.buyer_gave   else t.seller_gave  end as got,
       case when t.seller_id = (select auth.uid()) then t.buyer_id     else t.seller_id    end as partner_id,
       case when t.seller_id = (select auth.uid()) then t.buyer_handle else t.seller_handle end as partner_handle,
       t.completed_at
from public.completed_trades t
where (select auth.uid()) in (t.seller_id, t.buyer_id);

-- Inbox rows with server-computed preview and unread count (Chat.preview / Chat.unread / Chat.partner)
create view public.my_inbox with (security_invoker = true) as
select c.id, c.listing_id, c.seller_id, c.buyer_id, c.status, c.last_message_at, c.last_message_preview,
       c.created_at, c.closed_by, m.role as my_role, m.last_read_at, m.archived_at,
       p.id as partner_id, p.handle as partner_handle,
       (select count(*)::int from public.chat_messages cm
         where cm.chat_id = c.id
           and cm.created_at > m.last_read_at
           and cm.kind <> 'system'                       -- system rows must not inflate the tab badge
           and cm.sender_id is distinct from m.user_id) as unread
from public.chats c
join public.chat_members m on m.chat_id = c.id and m.user_id = (select auth.uid())
join public.profiles p on p.id = case when m.role = 'seller' then c.buyer_id else c.seller_id end;

-- ===== §1.6 Blocks and moderation =====
create table public.blocks (
  blocker_id     uuid not null references public.profiles (id) on delete cascade,
  blocked_id     uuid not null references public.profiles (id) on delete cascade,
  reason         public.bail_reason not null,
  note           text,
  source_chat_id uuid references public.chats (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id),
  constraint blocks_note_only_for_other check (
    note is null or (reason = 'other' and char_length(note) between 1 and 280 and note = btrim(note)))
);
create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- 'Suspicious / Spoofer vibes' is labelled FLAGS ACCOUNT in BailBlockModal, so it needs somewhere to land.
create table public.moderation_reports (
  id                    uuid primary key default gen_random_uuid(),
  reporter_id           uuid references public.profiles (id) on delete set null,
  reported_id           uuid references public.profiles (id) on delete set null,
  chat_id               uuid references public.chats (id) on delete set null,
  reason                public.bail_reason not null,
  note                  text,
  conversation_snapshot jsonb not null default '[]'::jsonb,   -- survives chat deletion
  status                public.report_status not null default 'open',
  created_at            timestamptz not null default now()
);

-- ===== §1.9 Stardust cost mirror (values verbatim from TRADE_COST_MATRIX) =====
create table public.trade_cost_matrix (
  trade_type       public.trade_type not null,
  friendship_level public.friendship_label not null,
  stardust         integer not null check (stardust > 0),
  primary key (trade_type, friendship_level)
);
insert into public.trade_cost_matrix (trade_type, friendship_level, stardust) values
  ('Standard / Registered', 'Good', 100), ('Standard / Registered', 'Great', 100),
  ('Standard / Registered', 'Ultra', 100), ('Standard / Registered', 'Best', 100),
  ('Special (Shiny/Legendary) Registered', 'Good', 20000), ('Special (Shiny/Legendary) Registered', 'Great', 16000),
  ('Special (Shiny/Legendary) Registered', 'Ultra', 1600),  ('Special (Shiny/Legendary) Registered', 'Best', 800),
  ('Unregistered (Standard)', 'Good', 20000), ('Unregistered (Standard)', 'Great', 16000),
  ('Unregistered (Standard)', 'Ultra', 1600),  ('Unregistered (Standard)', 'Best', 800),
  ('Unregistered (Shiny/Legendary)', 'Good', 1000000), ('Unregistered (Shiny/Legendary)', 'Great', 800000),
  ('Unregistered (Shiny/Legendary)', 'Ultra', 80000),  ('Unregistered (Shiny/Legendary)', 'Best', 40000);
-- Any future snapshot column must FK into this table. Never a formula, never a multiplier.
