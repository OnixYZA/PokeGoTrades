-- Flexible, privacy-fuzzed locations (Sprint 2.1).
--
-- ===== Why =====
-- `listings.loc` was a foreign key to the six-row Chennai preset table, so the app could only ever be used in six
-- neighbourhoods of one city. A location is now a free-text PLACE LABEL ("Adyar", "Indiranagar, Bengaluru",
-- "Phoenix Mall gate"), chosen from suggestions or typed by the trainer.
--
-- ===== Privacy model =====
-- Labels only, never coordinates. The client (constants/locations.ts) canonicalises known places, snaps a GPS fix
-- on-device to the nearest known locality and rejects coordinate-like text. This migration is the backstop: CHECK
-- constraints on `listings.loc` and `profile_private.safe_loc` refuse decimal lat/lng pairs, high-precision
-- decimals, degree notation, plus codes and geo: URIs, so a modified client cannot store a coordinate either.
-- The expressions are written INLINE (no function): the security-hardening pgTAP invariant pins the exact set of
-- public functions `authenticated` may execute, and a CHECK needs no grant.
-- The client mirror of the regexes is `looksLikeCoordinates` in constants/locations.ts, and
-- supabase/tests/flexible_locations.test.sql uses the same bad-input sample list (COORDINATE_LIKE_SAMPLES).
--
-- ===== The preset table =====
-- The preset table that used to back `loc` is intentionally left as an unused legacy table: it is not dropped
-- and not touched, only no longer referenced. constants/locations.ts still exports AREAS pinned to its seed.
--
-- ===== Case-insensitive feed matching =====
-- Free text means "adyar" and "Adyar" must land in the same feed. `loc_key` is a generated `lower(loc)` column
-- and the feed filters on it; the client mirror is `locationKey` in constants/locations.ts.
--
-- ===== Applying it =====
-- 1. `npx supabase db push` FIRST (this file).
-- 2. Then `gen types --linked` so lib/database.types.ts learns `listings.loc_key`.
-- 3. Then ship the client: the new client filters the feed on `loc_key`, which does not exist before step 1.
--
-- Idempotent: `drop ... if exists`, `add column if not exists`, `create index if not exists`, and the data fix
-- only touches rows that still carry the old display suffix.

-- ===== 1. Drop the preset foreign key =====
alter table public.listings drop constraint if exists listings_loc_fkey;

-- ===== 2. Normalise legacy home locations =====
-- Older clients stored the display string ("Adyar · ~500m radius") in safe_loc. Strip ONLY that suffix (a middle
-- dot, an optional "~", a number or range, then m/km), so a trainer's own "Besant Nagar · Elliot's Beach" survives.
-- Mirrors VICINITY_SUFFIX in constants/locations.ts. `\y` is Postgres's word boundary (`\b` means backspace here).
-- Listings need no such fix (their values are clean, and touching listings would run guard_listing_update).
update public.profile_private
   set safe_loc = nullif(btrim(regexp_replace(safe_loc, '\s*·\s*~?\s*\d+(\s*[–-]\s*\d+)?\s*(m|km)\y.*$', '', 'i')), '')
 where safe_loc ~* '·\s*~?\s*\d+(\s*[–-]\s*\d+)?\s*(m|km)\y';

-- Anything left that would fail the new check is cleared rather than blocking the migration: a home location is
-- optional, and the trainer can set it again.
update public.profile_private
   set safe_loc = null
 where safe_loc is not null
   and not (
        safe_loc = btrim(safe_loc)
    and char_length(safe_loc) between 1 and 80
    and safe_loc !~ '-?\d{1,3}\.\d+\s*[,;/ ]\s*-?\d{1,3}\.\d+'
    and safe_loc !~ '\d+\.\d{3,}'
    and safe_loc !~ '[°º]'
    and safe_loc !~* '[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}'
    and safe_loc !~* 'geo:'
    and safe_loc !~ '[[:cntrl:]]'
  );

-- ===== 3. Place-label constraints =====
-- Regexes, in order:
--   1. a decimal lat/lng pair ("13.0012, 80.2565", "-33.8688 151.2093", "12.9716; 77.5946")
--   2. a high-precision decimal fragment (3+ decimals, "13.00123")
--   3. degree notation ("13°00′N")
--   4. an Open Location Code / plus code ("7JFJ+2V"), case-insensitive
--   5. a geo: URI, case-insensitive
--   6. control characters
alter table public.listings drop constraint if exists listings_loc_is_place_label;
alter table public.listings add constraint listings_loc_is_place_label check (
      loc = btrim(loc)
  and char_length(loc) between 1 and 60
  and loc !~ '-?\d{1,3}\.\d+\s*[,;/ ]\s*-?\d{1,3}\.\d+'
  and loc !~ '\d+\.\d{3,}'
  and loc !~ '[°º]'
  and loc !~* '[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}'
  and loc !~* 'geo:'
  and loc !~ '[[:cntrl:]]'
);

-- The old 80-char check (profile_private_safe_loc_check) is kept; it is harmless next to this one.
alter table public.profile_private drop constraint if exists profile_private_safe_loc_is_place_label;
alter table public.profile_private add constraint profile_private_safe_loc_is_place_label check (
  safe_loc is null or (
        safe_loc = btrim(safe_loc)
    and char_length(safe_loc) between 1 and 80
    and safe_loc !~ '-?\d{1,3}\.\d+\s*[,;/ ]\s*-?\d{1,3}\.\d+'
    and safe_loc !~ '\d+\.\d{3,}'
    and safe_loc !~ '[°º]'
    and safe_loc !~* '[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}'
    and safe_loc !~* 'geo:'
    and safe_loc !~ '[[:cntrl:]]'
  )
);

-- ===== 4. Case-insensitive match key and the feed index =====
-- `authenticated` already has table-level SELECT on listings, so no grant is needed for the new column; and a
-- generated column cannot be inserted or updated by clients anyway.
alter table public.listings add column if not exists loc_key text generated always as (lower(loc)) stored;

-- The feed now filters by loc_key, so the index moves to it (same shape and predicate as listings_feed_idx).
create index if not exists listings_feed_key_idx on public.listings (loc_key, created_at desc)
  where status in ('open', 'locked');
drop index if exists public.listings_feed_idx;

-- ===== 5. Documentation =====
comment on column public.listings.loc is
  'Free-text place label (neighbourhood, city or meetup zone), never a coordinate: enforced by '
  'listings_loc_is_place_label. Shown to buyers as a ~1-2 km vicinity.';
comment on column public.listings.loc_key is
  'lower(loc), generated. The feed matches on this so "adyar" and "Adyar" share a feed. Mirrors locationKey() '
  'in constants/locations.ts.';
comment on column public.profile_private.safe_loc is
  'The trainer''s home location: a free-text place label, never a coordinate (profile_private_safe_loc_is_place_label). '
  'Returned to a chat partner by get_handshake() as partner_safe_loc.';
