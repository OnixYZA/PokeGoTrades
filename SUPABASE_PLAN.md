# SUPABASE_PLAN.md

Migration plan: local Zustand mock store → production Supabase backend.

**Status:** planning document. No application code changes yet.
**Contract being mapped:** `store/trade-store.tsx` (state + actions) and `data/types.ts` (`Listing`, `Chat`, `ChatMessage`, `Trainer`).

---

## 0. Context, goals and key decisions

### 0.1 Where we are

The frontend is complete and runs entirely on a local Zustand store seeded at module load from `data/listings.ts`, `data/chats.ts` and `data/trainer.ts`. The store holds four normalized slices — `listings`, `chats`, `messages`, `lockByListing` — plus two device preferences (`filterLocation`, `friendship`). `selectChatPhase()` derives `open | locked | frozen | closed` from `lockByListing` and `chat.active`, and the "at most one lock holder per listing" invariant comes for free from a JS map key.

Everything needed to make this work for **two real trainers on two devices** is missing: identity, durable chats, server-side lock arbitration, and live updates.

### 0.2 Goals

1. One Postgres schema that represents `Listing`, `Chat`, `ChatMessage` and `Trainer` without losing a field.
2. RLS strict enough that a hostile client holding the publishable key cannot read another trainer's chat, spoof a message, freeze a listing it does not own, or complete a trade alone.
3. A client setup that follows current (2026) Expo SDK 57 + Supabase guidance.
4. A store refactor that keeps component selector shapes stable, so screens keep working, while adding optimistic sends and Realtime.

### 0.3 Key architectural decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Only the seller locks and unlocks** a trade on their own listing | Confirmed by the product owner. "Accept Trade (Lock)" is the seller accepting one buyer's offer; a buyer freezing someone else's listing is an abuse vector |
| D2 | **Completion requires both parties to confirm** | Confirmed by the product owner. Each side's confirmation is its own timestamp; the second one finalizes the trade in the same transaction |
| D3 | **No coordinates in the MVP** | Confirmed by the product owner. `loc` stays an area name, `dist` is not persisted. PostGIS proximity is a future phase (§5.3) |
| D4 | The trade lock is its own table with `listing_id` as **primary key** | Makes a second lock holder unstorable — the structural equivalent of the `lockByListing` map |
| D5 | Every state transition (open offer, lock, unlock, confirm, withdraw, bail) is a **SECURITY DEFINER RPC**; clients hold no write grants on those columns | These transitions touch several rows and tables at once and cannot be expressed safely as client UPDATEs |
| D6 | Nothing is hard-deleted; listings and chats reach terminal **statuses** | `removeListing` / `removeChat` in the mock destroy history that trade records, blocks and moderation need |
| D7 | Realtime uses **Broadcast from database triggers on private channels**, not `postgres_changes` | Current Supabase recommendation for chat-shaped apps. `postgres_changes` does not apply RLS to DELETE events and re-authorizes once per subscriber per change |
| D8 | `sender_id` replaces `role: 'me' \| 'them'`; `created_at` replaces the `time` display string | `'me'` is meaningless on the other trainer's device |
| D9 | Reads work for anonymous sessions; **writes require a permanent (email-upgraded) account** | Blocks and rate limits are keyed to a uid, so otherwise a blocked user reinstalls and returns |
| D10 | Stardust stays **client-side**, computed from `TRADE_COST_MATRIX` | Project rule: costs are never invented. The optional SQL mirror (§1.9) copies the matrix verbatim and is covered by a parity test |

### 0.4 Migration file layout

```
supabase/
  config.toml
  migrations/
    20260916000100_extensions_enums_validators.sql   -- private schema, enums, jsonb validators
    20260916000200_tables.sql                        -- tables, indexes, views, reference data
    20260916000300_helpers_triggers.sql              -- helpers, guards, invariants, broadcast triggers
    20260916000400_grants_rls.sql                    -- revokes, column grants, RLS policies
    20260916000500_rpcs.sql                          -- state-transition RPCs
    20260916000600_storage_realtime.sql              -- bucket, storage policies, realtime.messages policy
  seed.sql                                           -- local-only mock data (§4.7)
  tests/                                             -- pgTAP (§5.4)
```

---

## 1. SQL schema and database design

### 1.1 Schemas, enums, validators (`…000100`)

```sql
-- Since 2026-05-30 new projects no longer auto-grant privileges on public tables: grant explicitly everywhere.
alter default privileges in schema public revoke execute on functions from public;

create schema if not exists private;                 -- never added to the exposed schema list
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

create type public.team_name       as enum ('Mystic', 'Valor', 'Instinct');
create type public.listing_status  as enum ('open', 'locked', 'completed', 'withdrawn');
create type public.background_hint as enum ('meta', 'legacy', 'shiny', 'shadow');   -- mirrors BackgroundHint
create type public.trade_type      as enum (                                        -- mirrors TradeType verbatim
  'Standard / Registered',
  'Special (Shiny/Legendary) Registered',
  'Unregistered (Standard)',
  'Unregistered (Shiny/Legendary)'
);
create type public.friendship_label as enum ('Good', 'Great', 'Ultra', 'Best');
create type public.listing_tag      as enum ('Legacy Move', 'Community Day', 'PvP Ready', 'Raid Exclusive', 'Hundo IV');
create type public.proof_kind       as enum ('appraisal', 'movesets', 'event_badge');
create type public.ocr_status       as enum ('pending', 'processing', 'verified', 'failed', 'rejected');
create type public.chat_status      as enum ('open', 'bailed', 'completed', 'closed');
create type public.chat_role        as enum ('seller', 'buyer');
create type public.message_kind     as enum ('text', 'offer', 'system');
create type public.system_event     as enum (
  'locked', 'unlocked', 'seller_confirmed', 'buyer_confirmed', 'confirmation_withdrawn',
  'completed', 'closed_listing_completed', 'closed_listing_withdrawn', 'bailed'
);
create type public.bail_reason      as enum ('unresponsive', 'unreasonable_adds', 'spoofer', 'other');
create type public.report_status    as enum ('open', 'reviewed', 'actioned', 'dismissed');
create type public.creature_list    as enum ('arsenal', 'wishlist');

-- CreatureRef { name, hue, pokemonId, shiny?, lucky? } as strict jsonb. Immutable, so usable inside CHECKs.
create function public.creature_ref_is_valid(
  p jsonb,
  p_allowed_keys text[] default array['name', 'pokemonId', 'hue', 'shiny', 'lucky']
) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when jsonb_typeof(p->'name')      is distinct from 'string' then false
    when jsonb_typeof(p->'pokemonId') is distinct from 'number' then false
    when jsonb_typeof(p->'hue')       is distinct from 'number' then false
    else char_length(p->>'name') between 1 and 40
      and (p->>'pokemonId') ~ '^[1-9][0-9]{0,4}$'      -- dex no. or PokeAPI form id (e.g. 10188 zacian-crowned)
      and (p->>'hue')::numeric between 0 and 360
      and coalesce(jsonb_typeof(p->'shiny'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p->'lucky'), 'boolean') = 'boolean'
      and (select bool_and(k = any (p_allowed_keys)) from jsonb_object_keys(p) as k)
  end
$$;

-- FormalOffer { name, pokemonId, hue, iv?, move? } (+ shiny/lucky so the offer card stops losing them)
create function public.formal_offer_is_valid(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select public.creature_ref_is_valid(p, array['name', 'pokemonId', 'hue', 'shiny', 'lucky', 'iv', 'move'])
    and coalesce(jsonb_typeof(p->'iv'),   'string') = 'string' and coalesce(char_length(p->>'iv'),   0) <= 40
    and coalesce(jsonb_typeof(p->'move'), 'string') = 'string' and coalesce(char_length(p->>'move'), 0) <= 40
$$;

create function public.creature_ref_array_is_valid(p jsonb, p_max integer) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) > p_max then false
    else coalesce((select bool_and(public.creature_ref_is_valid(e)) from jsonb_array_elements(p) as e), true)
  end
$$;

create function public.array_is_distinct(p anyarray) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select cardinality(p) = (select count(distinct e) from unnest(p) as e)
$$;

-- CHECK constraints execute as the inserting role, so that role must be able to execute these.
grant execute on function public.creature_ref_is_valid(jsonb, text[]),
                          public.formal_offer_is_valid(jsonb),
                          public.creature_ref_array_is_valid(jsonb, integer),
                          public.array_is_distinct(anyarray)
  to authenticated, service_role;
```

### 1.2 Identity: `profiles`, `profile_private`, `trainer_creatures` (`…000200`)

`Trainer` splits in two: public columns anyone may read, and private columns (friend code, safe meet zone) only the owner sees — revealed to the trade partner through `get_handshake()` once a trade is locked.

```sql
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
```

### 1.3 Reference data and listings

```sql
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
```

Limits verified against `components/modals/CreateListingModal.tsx`:

| Limit | UI source | DB enforcement |
|---|---|---|
| Tags: fixed list of 5, multi-select | `TAG_OPTIONS` (L78) | `listing_tag[]` enum array, `cardinality <= 5`, distinct |
| Notes: 280 max, trimmed, empty → `undefined` | `NOTES_MAX_LENGTH = 280` (L80), `notes.trim() \|\| undefined` (L137) | `char_length between 1 and 280 and notes = btrim(notes)` |
| Wanted in return: max 3 | `wanted.length >= 3` (L142) | `creature_ref_array_is_valid(looking, 3)` |
| Proofs: max 3, one per kind | `uploads.length >= 3` (L152), per-kind `find` (L153) | `unique (listing_id, kind)` over a 3-value enum |

> Today the modal fakes uploads from `PROOF_POOL` and puts filenames in `screenshots`. Phase 2 (§4.6) replaces that with a real picker; the schema stores Storage paths, never filenames.

### 1.4 Chats, membership, messages

```sql
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
```

### 1.5 Trade lock (D4) and completed trades

```sql
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
```

### 1.6 Blocks and moderation

```sql
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
```

### 1.7 Storage bucket for proof screenshots

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-proofs', 'listing-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
```

Object name format: `<auth.uid()>/<listing_id>/<appraisal|movesets|event_badge>`. No file extension — `contentType` carries the MIME type. Names are unique per bucket and only 3 kinds exist, so a listing can structurally hold at most 3 objects. Policies are in §2.6.

### 1.8 TypeScript field → SQL column mapping

| TS field | SQL source | Notes |
|---|---|---|
| `Listing.id` | `listings.id` uuid | The client may pass a pre-generated uuid so proof uploads and retries are idempotent |
| `Listing.name`, `pokemonId`, `hue`, `form`, `shiny`, `lucky`, `accent`, `bg`, `tradeType` | same names, snake_case | `bg = 'shadow'` rejected |
| `Listing.year` | `catch_year` | |
| `Listing.seller` | `seller_id` → join `profiles.handle` | Client keeps `seller: string` for display and adds `sellerId` |
| `Listing.dist` | **client-only / hidden** | D3: not persisted. Render `—` or hide the badge until §5.3 |
| `Listing.loc` | `loc` → `areas.name` | Feed: `.eq('loc', filterLocation).in('status', ['open','locked'])` |
| `Listing.pvp`, `demand` | `pvp_rank`, `demand_rank` | Read-only to clients |
| `Listing.iv` | `iv_atk` / `iv_def` / `iv_sta` | Client formats `'15/15/14'`, or `'Unrated'` when null |
| `Listing.looking` | `looking` jsonb | ≤ 3 `CreatureRef` |
| `Listing.untradable` | `untradable` | Moderator flag |
| `Listing.screenshots` | `listing_proofs.storage_path[]` | Owner reads them through `createSignedUrl` |
| `Listing.tags`, `notes` | `tags`, `notes` | |
| *(new)* `Listing.status` | `status` | Feed hides `completed` / `withdrawn` |
| `Chat.id`, `listingId` | `chats.id`, `listing_id` | Server-generated; `open_offer()` returns the id |
| `Chat.partner` | **derived**: `my_inbox.partner_handle` | Plus `partnerId`, `sellerId`, `buyerId`, `myRole` |
| `Chat.preview` | `chats.last_message_preview` | Maintained by trigger |
| `Chat.unread` | **derived**: `my_inbox.unread` | Reset by updating `chat_members.last_read_at` |
| `Chat.active` | **derived**: `status === 'open'` | |
| `Chat.archived` | `chat_members.archived_at is not null` | Per participant, not per chat |
| `lockByListing` | `trade_locks` + `listings.status = 'locked'` | See §4.2 |
| `ChatMessage.role` | **derived**: `sender_id === me ? 'me' : sender_id ? 'them' : 'system'` | D8 |
| `ChatMessage.time` | **derived** from `created_at` | `toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`, as `[chatId].tsx` does today |
| `ChatMessage.text`, `offer` | `body`, `offer` jsonb | Adds `id`, `clientId`, `kind`, `systemEvent`, `createdAt` |
| `Trainer.handle`, `lvl`, `team`, `bio` | `profiles.*` | Public |
| `Trainer.code`, `safeLoc` | `profile_private.friend_code`, `safe_loc` | **Private**; the partner sees them only via `get_handshake()` |
| `Trainer.trades`, `rep`, `streak` | `trades_count`, `rep`, `streak_days` | Server-written; `rep`/`streak` stay empty in the MVP |
| `Trainer.arsenal`, `wishlist` | `trainer_creatures.list` | |
| `Trainer.tradeHistory` | `my_trade_history` view | Own profile only in the MVP |
| `filterLocation`, `friendship` | **client-only** (zustand, optionally persisted) | Friendship is a per-pair game concept; see §5.2 |

### 1.9 Stardust cost (project rule)

- `TRADE_COST_MATRIX` in `data/types.ts` is the **only** source of costs. `StardustCard` keeps computing `TRADE_COST_MATRIX[tradeType][friendship]` on the client.
- The MVP has **no stardust column** anywhere. Friendship belongs to a pair of trainers and is still an open question (§5.2), so any stored snapshot would be a guess.
- Optional mirror, only if the server ever needs costs. Values copied verbatim; a parity test (R20) fails if they drift:

```sql
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
```

### 1.10 Helpers, guards, invariants, broadcasts (`…000300`)

```sql
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
```

---

## 2. Row Level Security

### 2.1 Revoke everything, then grant columns explicitly (`…000400`)

Column grants do the work RLS policies cannot: a policy cannot say *which columns* may be written.

```sql
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
```

### 2.2 Enable RLS on every table

```sql
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
```

### 2.3 Policies

```sql
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
```

**Guarantee → where it is enforced**

| Guarantee | Enforced by |
|---|---|
| Users can only insert/update/delete their own listings | `listings_insert_own`, `listings_update_own_open`; `seller_id` defaults to `auth.uid()` and is not grantable; no DELETE grant |
| No edits to trade-relevant fields once offers exist, and none at all once locked | `guard_listing_update` trigger + `status = 'open'` in the UPDATE policy |
| Listings publicly readable while open or locked | `listings_read` (blocked viewers excluded) |
| Chats and messages readable only by that chat's buyer or seller | `chats_read_participants`, `chat_messages_read_participants` |
| `sender_id` cannot be spoofed; no posting into bailed/closed/frozen chats | `sender_id` not grantable (defaults to `auth.uid()`) + `can_post_message()` |
| **Only the seller can lock or unlock (D1)** | `lock_trade` / `unlock_trade` check `seller_id = auth.uid()`; no client write grant on `trade_locks` or `listings.status` |
| **Only the lock-holder chat's participants can confirm, and both must (D2)** | `confirm_trade` holder check, `trade_locks_not_both_confirmed`, finalization in the same transaction |
| At most one lock holder per listing (D4) | `trade_locks.listing_id` PRIMARY KEY + composite FK to `chats` |
| Blocked users cannot open a chat with the blocker | `open_offer` → `is_blocked_pair` in both directions; `can_post_message` |
| Screenshots stay in the owner's folder, max 3 | Storage policies (§2.6) + `listing_proofs_one_per_kind` |
| Friend codes never leak | `profile_private` is owner-only; `get_handshake()` is the single reveal path, gated on an active lock |

### 2.4 State-transition RPCs (`…000500`)

Conventions for every RPC:

- `security definer`, `set search_path = ''`, every object schema-qualified.
- Errors raise `sqlstate 'PTxxx'` (PostgREST maps it to HTTP status `xxx`); the message carries a stable code the client switches on.
- **Lock order is always `listings` (FOR UPDATE) → `chats` → `trade_locks`.** That serializes lock, unlock, confirm, withdraw and bail on the same listing and avoids deadlocks.

```sql
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
```

Error code → UI mapping (`lib/rpc-errors.ts`):

| Code | What the UI does |
|---|---|
| `already_locked` | The seller locked another chat on a second device. Refetch locks, toast |
| `not_lock_holder` / `no_active_lock` | Someone unlocked or bailed. Refetch and close the Handshake |
| `nothing_to_withdraw` | Stale button state. Refetch the lock row |
| `chat_not_open` | The chat was bailed or closed meanwhile. Refetch, disable the Composer |
| `listing_not_open` / `offer_not_allowed` | Make Offer disabled: "This listing is no longer accepting offers" |
| `permanent_account_required` / `profile_incomplete` | Route to the email upgrade or onboarding |
| `rate_limited` | Toast, no state change |

### 2.5 Realtime authorization (`…000600`)

```sql
-- Dashboard: Realtime Settings → disable "Allow public access", so every channel must be private.
create policy realtime_receive_scoped on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.can_receive_topic((select realtime.topic()))
);
-- No INSERT policy: clients cannot publish. Every broadcast originates from a database trigger.
```

### 2.6 Storage policies for `listing-proofs`

```sql
create policy listing_proofs_obj_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'listing-proofs'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and storage.filename(name) in ('appraisal', 'movesets', 'event_badge')
  and private.can_attach_proof((storage.foldername(name))[2])    -- own, open listing, permanent account
);
create policy listing_proofs_obj_select_owner on storage.objects for select to authenticated using (
  bucket_id = 'listing-proofs' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy listing_proofs_obj_delete_owner on storage.objects for delete to authenticated using (
      bucket_id = 'listing-proofs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.can_attach_proof((storage.foldername(name))[2])
);
-- No UPDATE policy: no upsert. Replacing a proof means delete then re-upload.
-- Buyers cannot download proofs in the MVP (open question §5.2). The OCR worker uses the service role.
```

---

## 3. Client setup and auth

### 3.1 Dependencies

The three packages named in the brief map to this classic Supabase React Native command:

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
```

**What the current docs say (checked 2026-09):**

- **`react-native-url-polyfill` is not needed on SDK 57.** The Expo Supabase guide states: *"Supabase's own quickstart also imports react-native-url-polyfill/auto, which Expo projects don't need, because Expo installs a URL global already."* The SDK 57 `expo` reference adds: *"On native platforms, built-in URL and URLSearchParams implementations replace the shims in react-native."* Supabase's own quickstart still lists it; the Expo-specific guide overrides that.
  Sources: <https://docs.expo.dev/guides/using-supabase/>, <https://docs.expo.dev/versions/v57.0.0/sdk/expo/>
- **AsyncStorage works but is no longer the documented default.** Both the Expo guide and the Supabase Expo quickstart now use `expo-sqlite/localStorage/install`. If you still prefer AsyncStorage, `npx expo install` pins `2.2.0` for SDK 57 (via `node_modules/expo/bundledNativeModules.json`), not npm's latest 3.x.

**Recommended instead:**

```bash
# Phase 1: client, session storage, uuids for client_id, friend-code copy
npx expo install @supabase/supabase-js expo-sqlite expo-crypto expo-clipboard
# Phase 2: real proof uploads
npx expo install expo-image-picker expo-file-system
# Dev tooling (Docker Desktop required for `supabase start`)
npm install supabase --save-dev
```

- `app.json`: add `"expo-sqlite"` to `plugins`.
- `tsconfig.json`: add `"exclude": ["supabase/functions", "workers"]` so Deno/OCR code is not type-checked with the app (the OCR pipeline must stay out of the Expo directories).
- `package.json` scripts: `"db:start": "supabase start"`, `"db:reset": "supabase db reset"`, `"db:test": "supabase test db"`, `"db:types": "supabase gen types typescript --local > lib/database.types.ts"`. Run `db:types` from Git Bash — PowerShell 5.1 `>` writes UTF-16.

### 3.2 Environment

`.env.local` (already covered by `.env*.local` in `.gitignore`):

```
EXPO_PUBLIC_SUPABASE_URL=http://192.168.x.x:54321        # LAN IP for a physical device; hosted URL in prod
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- Publishable keys (`sb_publishable_…`) replace the legacy anon JWT, which Supabase deprecates by the end of 2026. Never ship `sb_secret_…`, the service role key, or the database password.
- Read env vars with dot access only (`process.env.EXPO_PUBLIC_X`); Expo inlines them at build time and destructuring breaks that.

### 3.3 `lib/supabase.ts` (sketch)

```ts
import 'expo-sqlite/localStorage/install'; // no-op on web; provides localStorage on native
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

// app.json sets web.output: 'static', so this module is also evaluated in Node during export,
// where there is no window and no localStorage.
const isStaticRender = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: isStaticRender ? undefined : localStorage,
    autoRefreshToken: !isStaticRender,
    persistSession: !isStaticRender,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  // Register once: refresh tokens only while the app is foregrounded.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
```

- Session storage is unencrypted SQLite. Acceptable for the MVP: it holds a refresh token, and friend codes are never cached. If encryption at rest becomes a requirement, switch to Supabase's documented `LargeSecureStore` pattern (AES key in `expo-secure-store`).
- Generated types mark every column insertable even though column grants reject most of them. Wrap writes in typed helpers (`lib/api/*.ts`) whose input types list only granted columns.

### 3.4 Auth strategy for the MVP

**Recommendation: anonymous sign-in on first launch, upgraded in place to email OTP before the first write.**

- **Why anonymous first.** Nothing is granted to `anon`, so even the feed needs an `authenticated` session; private Realtime needs a user JWT (publishable-key connections are capped at 24h). A profile row exists immediately, and upgrading keeps the same `auth.uid()`, so no data migration is needed.
- **Why writes need a permanent account (D9).** Listings, offers, messages and locks all require `is_anonymous = false` plus `private.profile_ready()`. Blocks and rate limits are keyed to a uid; if anonymous accounts could write, a blocked spoofer would reinstall and be back instantly. Browsing stays frictionless.
- **Flow:**
  1. `app/_layout.tsx` gains a `SessionProvider` inside `SafeAreaProvider`, wrapping the `Stack`. The splash screen stays up until fonts **and** `getSession()` resolve.
  2. No session → `supabase.auth.signInAnonymously()`.
  3. First write attempt routes to `app/onboarding.tsx` (wrapped in `PhoneFrame`): `supabase.auth.updateUser({ email })` → `supabase.auth.verifyOtp({ email, token, type: 'email_change' })` (the email template must include `{{ .Token }}`), then handle, team, level and friend code via direct column updates. Gate the route with expo-router's protected-route API — verify `Stack.Protected` against the v57 docs before implementing.
  4. Returning user on a new device: `signInWithOtp({ email, options: { shouldCreateUser: false } })` → `verifyOtp({ type: 'email' })`.
- **Profile bootstrap:** the `on_auth_user_created` trigger (§1.10) writes a `profiles` row with a placeholder `TrainerNNNNNNNN` handle plus an empty `profile_private` row.
- **Handle uniqueness:** unique index on `lower(handle)`, regex `^[A-Za-z0-9]{3,15}$`, reserved placeholder pattern. A `23505` surfaces as "Handle taken". `/profile/[userId]` switches from handles to profile uuids.
- **Abuse mitigations:** CAPTCHA (hCaptcha or Turnstile — React Native needs a WebView widget, which is not documented); `auth.rate_limit.anonymous_users = 30`/hour/IP; RPC limits (20 new chats/hour, 30 messages/minute); unique friend codes; a scheduled cleanup of anonymous users older than 30 days; spoofer reports carry a conversation snapshot.

```toml
# supabase/config.toml
[auth]
enable_anonymous_sign_ins = true
enable_manual_linking = true      # future: linkIdentity for Google/Apple

[auth.rate_limit]
anonymous_users = 30

[storage.buckets.listing-proofs]
public = false
file_size_limit = "5MB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp"]
```

---

## 4. State management migration (Zustand → Supabase + Realtime)

### 4.1 Principles

- **Keep the normalized slices and their names:** `listings`, `chats`, `messages`, `lockByListing`, `filterLocation`, `friendship`. Components keep their selectors.
- **The store becomes a cache of server state.** Actions turn `async`, call `lib/api/*` (RPC or insert), then apply the confirmed result. Realtime events feed the same reducers.
- **Add:** `me`, `lockConfirmations`, `handshakeRequest` (UI signal), `hydrate()`, `resync()`, `reset()`, `applyEvent()`.
- **Remove module-load seeding.** `seededListings` and `splitChatSeeds` go away; the mock data moves to `supabase/seed.sql` (§4.7).

```ts
// data/types.ts — existing fields kept, new ones added
export type ListingStatus = 'open' | 'locked' | 'completed' | 'withdrawn';
export type ChatStatus = 'open' | 'bailed' | 'completed' | 'closed';
export type ChatRole = 'seller' | 'buyer';

export interface Listing extends CreatureRef { /* existing fields… */ sellerId: string; status: ListingStatus }
export interface Chat {
  id: string; listingId: string; partner: string; preview: string; unread: number; active: boolean; archived?: boolean;
  partnerId: string; sellerId: string; buyerId: string; myRole: ChatRole; status: ChatStatus;
  closedBy: string | null; lastMessageAt: string | null;
}
export interface ChatMessage {
  id: string; clientId?: string; senderId: string | null;
  role: 'them' | 'me' | 'system';          // derived at mapping time from senderId
  kind: 'text' | 'offer' | 'system'; text: string;
  time: string;                            // derived from createdAt
  createdAt: string; offer?: FormalOffer; systemEvent?: string;
  delivery?: 'pending' | 'failed';
}
export const LOCK_HELD_ELSEWHERE = '__elsewhere__' as const;  // lockByListing value when I cannot see the holder
```

### 4.2 Phase and view model: role-aware (D1) with pending confirmation (D2)

```ts
export type ChatPhase = 'open' | 'locked' | 'frozen' | 'closed' | 'bailed' | 'completed';

export function selectChatPhase(state: Pick<TradeState, 'chats' | 'lockByListing'>, chatId: string): ChatPhase {
  const chat = state.chats[chatId];
  if (!chat) return 'closed';
  if (chat.status === 'bailed') return 'bailed';         // terminal states first
  if (chat.status === 'completed') return 'completed';   // fixes today's "closed chat renders as locked"
  if (chat.status === 'closed') return 'closed';
  const holder = state.lockByListing[chat.listingId];
  if (holder === chatId) return 'locked';
  if (holder) return 'frozen';                           // includes LOCK_HELD_ELSEWHERE
  return 'open';
}

export type Confirmation = 'none' | 'awaiting_partner' | 'awaiting_me';

export interface TradeView {
  phase: ChatPhase; role: ChatRole; confirmation: Confirmation;
  canLock: boolean; canUnlock: boolean; canConfirm: boolean; canWithdrawConfirmation: boolean;
  canCompose: boolean; canBail: boolean; canOpenHandshake: boolean;
}

export function selectTradeView(state: TradeState, chatId: string): TradeView {
  const chat = state.chats[chatId];
  const phase = selectChatPhase(state, chatId);
  const role = chat?.myRole ?? 'buyer';
  const c = state.lockConfirmations[chatId];
  const mine   = role === 'seller' ? c?.sellerConfirmedAt : c?.buyerConfirmedAt;
  const theirs = role === 'seller' ? c?.buyerConfirmedAt  : c?.sellerConfirmedAt;
  const confirmation: Confirmation =
    phase !== 'locked' ? 'none' : mine ? 'awaiting_partner' : theirs ? 'awaiting_me' : 'none';
  return {
    phase, role, confirmation,
    canLock:   role === 'seller' && phase === 'open',      // D1
    canUnlock: role === 'seller' && phase === 'locked',    // D1
    canConfirm: phase === 'locked' && !mine,               // D2
    canWithdrawConfirmation: phase === 'locked' && !!mine && !theirs,
    canCompose: phase === 'open' || phase === 'locked',
    canBail: phase === 'open' || phase === 'locked' || phase === 'frozen',
    canOpenHandshake: phase === 'locked',
  };
}
```

**Filling `lockByListing` from the server:**

1. Load `listings` for the feed plus every listing referenced by my chats.
2. Load `trade_locks` (RLS returns only locks I am party to).
3. For each listing with `status === 'locked'`: set `lockByListing[id]` to the visible lock's `chat_id`, else to `LOCK_HELD_ELSEWHERE`. A seller always sees every lock on their own listings, so the seller's view of frozen siblings is exact; a losing buyer knows only "frozen", which is all the UI needs.
4. `lockConfirmations[chatId]` comes from the same rows.

### 4.3 Which actions are optimistic

| Action (current name kept where possible) | Server call | Optimistic? | Why |
|---|---|---|---|
| `sendMessage(chatId, { text \| offer })` | `insert chat_messages` with `client_id` | **Yes** | The row is immutable, so a failure affects only that bubble |
| `markRead(chatId)` / `archiveChat(chatId)` | update own `chat_members` row | Yes | Affects only the caller |
| `setFilterLocation`, `setFriendship` | none (device preference) | n/a | |
| `addListing(input)` | `insert listings` (client-generated uuid) + proof uploads | No (spinner) | Proof paths need the committed id; guard errors must surface |
| `openOffer(listingId, offer)` (replaces `addChat`) | `rpc('open_offer')` | **No** | The server may reject (locked, blocked, rate limit) and returns the real chat id to navigate to |
| `lockChat(chatId)` | `rpc('lock_trade')` | **No** | `already_locked` races; frozen siblings must never flicker back |
| `unlockChat(chatId)` | `rpc('unlock_trade')` | **No** | Clears the partner's confirmation |
| `confirmTrade` / `withdrawConfirmation` | `rpc('confirm_trade')` / `rpc('withdraw_trade_confirmation')` | **No** | Finalization is irreversible |
| `bailChat` (replaces `removeChat`) | `rpc('bail_and_block')` | **No** | Blocks, reports, and closes several chats |
| `removeListing(listingId)` | none — **local** removal from the feed once `completed`/`withdrawn` arrives | n/a | D6: the server keeps the row |

**Optimistic send and reconciliation**

1. `clientId = Crypto.randomUUID()` (expo-crypto). Append `{ id: clientId, clientId, senderId: me.id, role: 'me', delivery: 'pending', createdAt: new Date().toISOString() }`.
2. `insert(...).select().single()`. On success, replace the entry matched by `clientId` with the server row (server `id` and `created_at`), then re-sort by `(createdAt, id)`.
3. If the Realtime echo arrives first, the reducer matches on `senderId === me.id && clientId`; rows whose `id` already exists are ignored. Every `ingest*` reducer is idempotent, so RPC response and echo may arrive in either order.
4. On error: `23505` (duplicate `client_id`) means it already landed — fetch by `(sender_id, client_id)` and reconcile. `42501` means RLS refused (frozen, closed or bailed) — mark `failed`, refetch the chat and locks, and the Composer disables itself. A network error marks `failed` with a Retry that reuses the same `clientId`.

### 4.4 Realtime topology and lifecycle

| Topic | Subscribed | Events | Reducer effect |
|---|---|---|---|
| `user:<uid>` | once per session, after auth | `chat` (insert = new parallel offer on my listing; update = status), `chat_updated`, `lock`, `listing_status` | Upsert the chat (fetch its `my_inbox` row), debounced inbox refetch for preview/unread, set or clear `lockByListing` + `lockConfirmations`, freeze/thaw siblings, and set `handshakeRequest` when **I am the buyer** and a lock `insert` arrives (D1: the buyer's Handshake opens by itself) |
| `chat:<chatId>` | while `app/(tabs)/chats/[chatId].tsx` is focused (`useFocusEffect`) | `message` (full row) | Append or reconcile; `markRead` while focused |
| `listing:<listingId>` | while `app/listing/[id].tsx` is focused | `listing_status` | Disable Make Offer live when the listing locks, completes or is withdrawn |

- Before subscribing: `await supabase.realtime.setAuth()`, then `supabase.channel(topic, { config: { private: true } })`.
- Clean up with `supabase.removeChannel(ch)` on unfocus. `onAuthStateChange('SIGNED_OUT')` → `supabase.removeAllChannels()` + `useTradeStore.getState().reset()`. After an email upgrade the uid is unchanged, so keep the channels and just re-run `setAuth()`.
- **Gap filling.** Every `subscribe()` callback reporting `SUBSCRIBED` — including re-subscribes after a reconnect — triggers a refetch: `user:` refetches `my_inbox`, `trade_locks` and the relevant listings; `chat:` refetches `chat_messages where chat_id = $1 and created_at >= $lastCreatedAt` ordered by `(created_at, id)`, de-duplicated by `id`. Use `>=`, not `>`, so rows sharing a timestamp are not skipped. Run the same refetch on `AppState → active`: mobile sockets drop silently in the background.
- **Rows that vanish.** A refetch returning nothing (RLS) removes the entity locally. An RPC `PT403`/`PT409` triggers a refetch. A bailed chat stays readable to both parties as `status: 'bailed'` with a neutral system message — the reason is never sent to the other side.
- **Budget.** One `user:` channel plus at most one `chat:` and one `listing:` channel, far below the 100 channels-per-connection limit. Free tier allows 200 concurrent connections and 100 messages/second.

### 4.5 Required UI updates (project rule: store changes land with `components/chats/`)

| File | Change |
|---|---|
| `components/chats/ChatActionRow.tsx` | Takes `view: TradeView`, `busy`, `partnerHandle`. **Seller:** open → "Accept Trade (Lock)"; locked → "Trade Locked" (unlock confirm) + Handshake; frozen → disabled "Another offer locked". **Buyer:** open → disabled "Awaiting seller"; locked → "Locked by seller" + Handshake; frozen → disabled "Frozen". Bail & Block only when `canBail`; hide the row entirely for closed/bailed/completed. Open the Handshake **only after** `lock_trade` succeeds (today it fires `onLock()` and `onOpenHandshake()` together). Replace `Alert.alert` — a no-op on react-native-web — with a cross-platform confirm modal |
| `components/chats/LockedBanner.tsx` | Role-aware copy plus a confirmation line: "Waiting for {partner} to confirm" / "{partner} confirmed — tap to confirm" |
| `components/chats/FrozenBanner.tsx` | Buyer: "The seller locked in a different offer." Seller viewing a sibling: "You locked another offer. Unlock to resume this chat." |
| `components/chats/Composer.tsx` | `disabled = !view.canCompose`; placeholder per phase (frozen, chat closed, trade completed, "Coordinate meetup…"); retry hook for failed bubbles |
| `components/chats/ChatRow.tsx` | States for frozen, bailed, closed and completed; a confirmation-pending badge; unread from the server; pulse dot only while `status === 'open'` |
| `components/chats/ChatGroupHeader.tsx` | Group by `myRole` ("Offers on your listing" vs "Your offers"); LOCKED pill from `listing.status` (drop the `!c.active` hack in `chats/index.tsx`) |
| `components/chats/MessageBubble.tsx` | Render `role === 'system'` as a centered muted line; pending/failed indicators; key by `message.id`, not array index |
| `components/chats/FormalOfferCard.tsx`, `ArsenalOfferSheet.tsx` | Arsenal comes from `trainer_creatures`; stop hardcoding `lucky`; remove the placeholder `<FormalOfferCard />` in `[chatId].tsx` |
| `components/modals/HandshakeModal.tsx` | Data from `rpc('get_handshake')` — real handles, formatted friend codes, partner trade count (remove RaticateBoss99 / KantoKing / "(128)"). Button states: `none` → "Mark Trade Completed"; `awaiting_partner` → disabled "Waiting for {partner} to confirm" + "Withdraw confirmation"; `awaiting_me` → "{partner} confirmed — tap to confirm". Close on the `completed` event; close with a notice when the lock is released. COPY uses `expo-clipboard` with raw digits |
| `components/modals/BailBlockModal.tsx` | `partnerHandle` prop (remove "GhostTraderXX"), `submitting` state, "un-freeze your listing" copy only for the seller |
| `app/(tabs)/chats/[chatId].tsx` | Use `selectTradeView`; async actions with `Result.code` toasts; load-by-id for deep links with loading and not-found states; wire `handshakeRequest` |
| `app/listing/[id].tsx`, `BuyerOfferModal.tsx` | Hide Make Offer on your own listing; disable unless `status === 'open'`; `openOffer` → `router.dismissTo('/chats/' + returnedId)` |
| `app/(tabs)/index.tsx`, `CreateListingModal.tsx` | Feed queries `status in ('open','locked')`; the create flow stops sending `seller: 'You'`, `dist` and a fake `id`, and stops hardcoding `lucky: true` |
| `app/(tabs)/_layout.tsx` | Tab badge from the store's unread sum, replacing the static `totalUnread` in `data/chats.ts` |
| `components/profile/ProfileHero.tsx`, `app/profile/[userId].tsx` | Friend code and safe zone only on your own profile; route param becomes a profile uuid; `rep`/`streak` render as "—" |

### 4.6 Phased rollout

**Phase 0 — database only, no app changes**
- [ ] `npx supabase init`; configure `config.toml` (§3.4).
- [ ] Write migrations `…000100`–`…000600`; `npx supabase db reset` passes.
- [ ] pgTAP suite green (§5.4); `npx supabase db lint` clean; Security Advisor shows no warnings.
- [ ] Disable Realtime public access.

**Phase 1 — client and identity**
- [ ] Dependencies (§3.1), `lib/supabase.ts`, generated `lib/database.types.ts`, `SessionProvider`, anonymous bootstrap.
- [ ] Onboarding + email OTP upgrade; profile screens read `profiles`, `profile_private`, `trainer_creatures`, `my_trade_history`.
- [ ] Temporary `EXPO_PUBLIC_DATA_SOURCE=mock|supabase` flag switching `lib/api/*`, so screens migrate one at a time.

**Phase 2 — listings**
- [ ] Feed reads from the DB; `addListing` inserts; image picker + proof uploads (ArrayBuffer from expo-file-system `File.arrayBuffer()` with an explicit `contentType` — Blob/File/FormData do not work on React Native); `withdraw_listing`.

**Phase 3 — chats and messages**
- [ ] `my_inbox`, message pagination, `open_offer`, optimistic `sendMessage`, `user:` + `chat:` channels, gap filling, read receipts.

**Phase 4 — trade state (D1, D2)**
- [ ] `lock_trade`, `unlock_trade`, `confirm_trade`, `withdraw_trade_confirmation`, `bail_and_block`, `get_handshake`.
- [ ] Every §4.5 component change ships **in the same PR** as the store change.
- [ ] Two-device manual script (§5.4).

**Phase 5 — cleanup**
- [ ] Delete module-load seeding and the data-source flag; keep `data/*.ts` only as seed sources and fixtures; delete or dev-gate `app/test-bail.tsx`.
- [ ] Update `CLAUDE.md`: it describes `store/trade-store.tsx` as local mock state and points at `constants/pokedex.ts` for Shadow-trade rules; the `bg <> 'shadow'` CHECK is now the enforcement.

### 4.7 Seed data (`supabase/seed.sql`, local only — never `db push --include-seed`)

1. **Users.** Fixed-uuid `auth.users` + `auth.identities` rows (provider `email`, `extensions.crypt('password123', extensions.gen_salt('bf'))`, `email_confirmed_at = now()`, `is_anonymous = false`). The bootstrap trigger creates the profiles; then update handle, team, level and `profile_private.friend_code`. Verify the required auth columns against the local GoTrue version.
   Trainers: DriftCoral, AzureRift, GraniteFox, NoxTrainer, EmberVale, IronGlass, VoidQuill, MintRunner, CobaltAsh, PixelKite, SolstonKid.
2. **Listings l1–l6** from `data/listings.ts` with fixed uuids: `seller` → `seller_id`, `year` → `catch_year`, `iv '15/15/14'` → three smallints, `looking` copied as jsonb, `pvp`/`demand` into the rank columns for visual parity, `dist` dropped (D3).
3. **Resolve the mock's point-of-view contradiction.** `data/listings.ts` says l1 belongs to AzureRift, but `data/chats.ts` treats the local user as l1's seller. Seed **DriftCoral as the seller of l1**, making c1–c3 (MintRunner, CobaltAsh, PixelKite) three parallel buyer chats that exercise the frozen state.
4. **Buyer-view fixture:** one DriftCoral buyer chat on l2 (GraniteFox), so the buyer-side UI has a fixture.
5. **Chat c4** (SolstonKid on l3, `active: false`): seed as a **lock holder** — a `trade_locks` row plus `listings.status = 'locked'` — with a variant carrying `buyer_confirmed_at`, so the pending-confirmation UI has something to render.
6. **Messages:** `offers` (or `fallbackOffers`) become `chat_messages`; `role: 'me'` → the chat's seller, `'them'` → the buyer; `time` strings become today's `created_at` values.
7. **Profile:** DriftCoral's arsenal and wishlist (`data/trainer.ts`) → `trainer_creatures`; `tradeHistory` → `completed_trades` rows with null listing ids.
8. Stardust values are never seeded. `data/listings.ts` keeps exporting `locations` as the dropdown source, matching `public.areas`.

---

## 5. Risks, open questions, future phases, verification

### 5.1 Risks

| Risk | Mitigation |
|---|---|
| A SECURITY DEFINER RPC missing a check bypasses RLS entirely | Every RPC checks `auth.uid()` first; negative pgTAP tests per RPC and role; no definer helper granted beyond what policies need |
| Deadlocks between concurrent RPCs | One fixed lock order (listing → chat → lock); `bail_and_block` locks listings in id order; concurrency tests |
| Invariant drift (`status='locked'` with no lock row) | Deferred constraint triggers abort the whole transaction |
| `realtime.send` failure rolls back the business transaction | Accepted for the MVP (atomic beats silently lost); later, move sends to an outbox drained after commit |
| Realtime policies are cached per connection | Payloads carry no secrets; keep JWT expiry short so re-checks happen often |
| Error messages allow enumeration | Generic `offer_not_allowed` / `handshake_unavailable`; the same code for "missing" and "forbidden" |
| `web.output: 'static'` crashes on `localStorage` | `isStaticRender` guard; test `npx expo export -p web` in CI |
| Anonymous account churn | Writes need a permanent account; CAPTCHA; 30-day cleanup job |
| New projects have no default grants (changelog #45329) | Every grant written explicitly; pgTAP runs as both `anon` and `authenticated` |
| Client clock skew misorders optimistic bubbles | Re-sort by server `created_at` on reconcile |
| Generated types expose non-granted columns | Typed write helpers plus runtime `42501` mapping |

### 5.2 Open questions

1. **Lock expiry.** Should "Meet within 24h" auto-release a lock with no confirmations (pg_cron)? The MVP has no expiry.
2. **Handshake after completion.** Should `get_handshake` keep returning codes for N hours after the trade completes? The MVP says no.
3. **Friendship.** A per-pair `friendships` table, or keep the current what-if picker in `StardustCard`? Either way costs come only from `TRADE_COST_MATRIX`.
4. **Anonymous offers.** Allow anonymous users to send offers under stricter limits, or keep writes permanent-only (the recommendation)?
5. **Blocks.** Should a block hide the blocker's listings from the blocked user (current policy does)? Should unblock be exposed in the UI?
6. **Proof visibility.** Should the lock-holder buyer get signed URLs for the seller's proof screenshots?
7. **Public trade history.** Show it on public profiles, with or without partner handles?
8. **Game rules.** Reject Mythicals, temporary Mega/Primal forms, or already-Lucky Pokémon? That needs a hand-curated species table — no scraping of db.pokemongohub.net. Note the seed already contains Mega Rayquaza (10079) and Primal Groudon (10078) as wanted creatures.
9. **Guaranteed Lucky cutoff.** The modal claims "Caught before 07/2019 · auto-applied". Make the cutoff a config value once OCR fills in a real catch date.
10. **Rating and rep.** Out of MVP scope; `rep` and `streak_days` stay empty until a `trade_ratings` table exists.

### 5.3 Future phases (explicitly outside the MVP)

**PostGIS proximity (D3).** No MVP DDL.
- `create extension postgis with schema extensions;`
- `listings.meet_point extensions.geography(Point, 4326)`, snapped server-side to a ~500 m grid before storage, GIST-indexed, never granted to clients for select.
- `public.nearby_listings(p_lat, p_lng, p_radius_km, p_cursor)` (security definer): takes a coarse viewer position that is never stored, returns `dist_km` rounded to 0.5 km with a 0.5 km floor, and never returns coordinates. Per-listing constant jitter plus rate limiting defeats trilateration.
- `Listing.dist` comes back only through this RPC.

**OCR verification pipeline.** An isolated workspace (separate repo, or a top-level `workers/ocr/` with its own manifest, excluded from tsconfig, Metro and EAS) — no code under `app/`, `components/`, `store/` or `lib/`. The worker claims `listing_proofs` rows with `for update skip locked`, downloads with the service role, writes `ocr_extracted` and a terminal `ocr_status`. Input is only uploaded screenshots; it never calls Niantic servers or db.pokemongohub.net.

**Also later:** push notifications for lock/confirm/bail via Expo Push and an Edge Function; Broadcast replay for short reconnect gaps; a message outbox; a moderator dashboard; per-pair friendship.

### 5.4 Verification and testing

**pgTAP** (`supabase/tests/*.sql`, `npx supabase test db`). Impersonate a user with:

```sql
select set_config('request.jwt.claims',
  '{"sub":"<uuid>","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
```

| # | Test | Expected |
|---|---|---|
| R1 | Buyer calls `lock_trade` on their own chat | `PT403 not_seller` (D1) |
| R2 | Seller locks chat A, then sibling B | second call `already_locked`; `count(trade_locks) = 1` for that listing |
| R3 | Seller calls `unlock_trade` on B while A holds the lock | `not_lock_holder` |
| R4 | Frozen sibling buyer inserts a message | RLS violation `42501` |
| R5 | Message into a bailed/completed chat; spoofed `sender_id`; `kind='system'` | all rejected |
| R6 | Non-participant selects `chats` / `chat_messages` / `trade_locks` | 0 rows |
| R7 | Client updates `listings.status` or `trade_locks` directly | permission denied (column/table grant) |
| R8 | Owner edits `pokemon_id` once a chat exists; edits `notes` | `listing_has_offers`; notes succeed |
| R9 | Owner updates a listing while locked | 0 rows affected |
| R10 | Seller confirms twice | both `awaiting_partner`; exactly one system message |
| R11 | Seller confirms, then buyer confirms | `completed`; listing `completed`; lock row gone; one `completed_trades` row; `trades_count` +1 each; siblings `closed`; both `chat_members.archived_at` set (D2) |
| R12 | Seller confirms, then unlocks | lock gone; a re-lock starts with no confirmations |
| R13 | Buyer confirms, withdraws, seller confirms | `awaiting_partner`, **not** completed |
| R14 | Third party calls `confirm_trade` or `get_handshake` | `PT403` |
| R15 | Buyer bails a locked chat as `spoofer` | listing back to `open`; chat `bailed`; `blocks` row; `moderation_reports` row with snapshot; the blocked buyer's `open_offer` on any of the blocker's listings → `offer_not_allowed` |
| R16 | Anonymous JWT inserts a listing or message, or calls `open_offer` | rejected (D9) |
| R17 | Non-owner selects `profile_private` | 0 rows; `profiles` has no `friend_code` column at all |
| R18 | Storage: another uid's folder, a 4th object, a name outside the 3 kinds, a locked listing's folder | all rejected |
| R19 | `private.can_receive_topic('chat:<other>')`, `'user:<other uid>'` | false |
| R20 | `trade_cost_matrix` vs `TRADE_COST_MATRIX` | 16 exact matches, including Unregistered (Shiny/Legendary) / Good = 1000000 |
| R21 | Offer on your own listing; a second open chat by the same buyer; an offer on a locked listing | `own_listing`; same chat id reused; `listing_not_open` |

**Race tests.** pgTAP is single-session, so use `dblink` or a small Node script in an isolated `tools/db-race-tests/` workspace:

- **Double lock:** `Promise.all([lock_trade(A), lock_trade(B)])` × 200 — exactly one success each time; the deferred invariant never fires.
- **Dual confirmation:** `Promise.all([confirm(seller), confirm(buyer)])` × 200 — always exactly one `completed_trades` row and one increment per profile; responses are `{awaiting_partner, completed}` in either order.
- **Confirm vs unlock, confirm vs bail, bail from both sides:** the end state is completed or released, never a mix; no `40P01` deadlock in 500 iterations.
- **`open_offer` double-tap:** one chat row, one message (same `client_id`).

**Two-device manual script (Phase 4 exit).** Seller on device 1, buyers A and B on devices 2 and 3:

1. A and B make offers → the seller's inbox shows two parallel offers live.
2. Seller locks A → B's chat freezes live; A's Handshake opens by itself (D1).
3. A confirms → the seller sees "{A} confirmed — tap to confirm" (D2).
4. Seller unlocks → A's confirmation clears, B thaws.
5. Re-lock A, both confirm → trade history appears for both; B sees "traded to another trainer".
6. Repeat with A bailing as `spoofer` → the listing is relisted, A cannot re-offer, a report row exists.
7. Kill the network mid-chat, send three messages, restore → gap fill shows no duplicates and no missing rows.

---

### Critical files when implementation starts

- `store/trade-store.tsx` — slices, actions, `selectChatPhase`
- `data/types.ts` — `Listing`, `Chat`, `ChatMessage`, `Trainer`, `TRADE_COST_MATRIX`
- `app/(tabs)/chats/[chatId].tsx` — the screen that drives lock, bail and completion
- `components/chats/ChatActionRow.tsx` — where D1 becomes role-aware UI
- `components/modals/HandshakeModal.tsx` — where D2 becomes the pending-confirmation UI
- `components/modals/CreateListingModal.tsx` — the listing field contract
