-- Listings gain a seller-declared CP, and sellers may now declare `size_class` themselves.
--
-- ===== REVERSES AN EARLIER DECISION (size_class) =====
-- Migration 20260927000100_listing_attributes (header, and the comment it put on `listings.size_class`) made
-- `size_class` deliberately service-role-only, "like lucky ... never typed in by the seller": only the OCR
-- worker (workers/azure-ocr `applySizeClass`) was to record it, read off an appraisal screenshot. Because no
-- seller could write it, it had no `authenticated` grant and was left out of `guard_listing_update`'s frozen
-- tuple. The product decision is now the opposite: a seller declares the size when creating the listing
-- (CreateListingModal), the same way they declare IVs and the Poke Ball. That undoes both consequences:
--   * `authenticated` gets insert/update on (cp, size_class) below.
--   * `size_class` joins the frozen tuple, because it is now a seller-set trade-relevant fact: changing it after
--     a buyer has messaged is the same bait-and-switch the tuple already blocks for iv_*, pokeball, purified...
-- The OCR worker is unaffected in the common case: it writes `size_class` only `where size_class is null`, so a
-- seller's declared value is never overwritten. (It does now hit the guard once a chat exists; the worker maps
-- that PT409 'listing_has_offers' to its existing `blocked` outcome, exactly as it does for `lucky`.)
-- `lucky` stays service-role-only: that part of 20260920000200 is untouched.
--
-- ===== cp =====
-- Combat Power is a seller-declared fact about the creature, shown on the card and the trade summary. It is
-- mandatory in the client flow (CreateListingModal refuses to publish without it) but NULLABLE here: hosted
-- listings that predate it have no CP to backfill (inventing one would be hallucinated game data), and the
-- existing pgTAP inserts do not set it. `cp` also joins the frozen tuple for the same bait-and-switch reason.
-- 10 is the lowest CP the game shows; 10000 is a generous ceiling no GO creature approaches.
--
-- ===== guard_listing_update =====
-- Recreated from its latest definition (20261017000300_drop_listings_form.sql; no later migration redefines
-- it), with `cp` and `size_class` appended to BOTH tuples and nothing else changed.
--
-- Idempotent: `add column if not exists`, `create or replace`, and grant / comment are re-runnable.

-- ===== 1. Column + named check =====
alter table public.listings add column if not exists cp integer;

alter table public.listings drop constraint if exists listings_cp_range;
alter table public.listings add constraint listings_cp_range check (cp between 10 and 10000);

comment on column public.listings.cp is
  'Combat Power the seller declares for the creature (10..10000, listings_cp_range). Seller-set, so it is in '
  'guard_listing_update''s frozen tuple: it cannot change once a chat exists. Nullable only because listings '
  'that predate this column have none; the client requires it on every new listing.';

comment on column public.listings.size_class is
  'In-game size label (XXS, XS, XL, XXL), null = a standard-sized or undeclared creature. Seller-declared at '
  'listing time (migration 20261103000200 reverses 20260927000100, which had made it service-role-only); the OCR '
  'worker may still fill it from an appraisal screenshot, but only while it is null, so it never overwrites the '
  'seller''s value. Frozen once a chat exists (guard_listing_update).';

-- ===== 2. Column grants =====
grant insert (cp, size_class), update (cp, size_class) on public.listings to authenticated;

-- ===== 3. Guard: cp and size_class freeze once a chat exists =====
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball,
      new.form_code, new.costume_code, new.cp, new.size_class)
     is distinct from
     (old.name, old.pokemon_id, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball,
      old.form_code, old.costume_code, old.cp, old.size_class)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;

-- ===== Applying it =====
--   1. Migration FIRST, client second (the reverse of a column drop). The new client writes `cp` and
--      `size_class`; against a database without this migration those inserts fail (PGRST204 for `cp`, 42501 for
--      `size_class`). So: supabase db push (hosted: never `db reset`), then ship the client. The OLD client
--      keeps working after the push (it writes neither column; cp stays null).
--   2. supabase gen types typescript --linked > lib/database.types.ts   (gitignored, generated)
--   3. npx tsc --noEmit
