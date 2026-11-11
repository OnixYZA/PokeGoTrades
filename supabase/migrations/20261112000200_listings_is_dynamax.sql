-- Listings gain a seller-declared Dynamax flag.
--
-- ===== is_dynamax =====
-- Whether the creature is a (regular) Dynamax Pokemon, a seller-declared fact like `shiny` / `purified` /
-- `is_gigantamax`, filterable in the feed and shown as a pill on the trade summary. `not null default false`, so
-- every existing listing is a non-Dynamax creature and the existing pgTAP inserts need no change.
-- It is a trade-relevant fact, so it joins `guard_listing_update`'s frozen tuple: flipping it after a buyer has
-- messaged is the same bait-and-switch the tuple already blocks for shiny, purified, cp, size_class...
-- Eligibility (which species can Dynamax) is NOT enforced here: it is client-side data and arrives in Sprint 2.3.
--
-- ===== listings_dynamax_xor_gigantamax =====
-- A specimen is either a regular Dynamax or a Gigantamax, never both. Every existing row is false / false, so
-- the constraint validates against current data.
--
-- ===== guard_listing_update =====
-- Recreated from its latest definition (20261103000300_listings_is_gigantamax.sql; no later migration redefines
-- it), with `is_dynamax` appended to BOTH tuples and nothing else changed.
--
-- Idempotent: `add column if not exists`, `drop constraint if exists`, `create or replace`, and grant / comment
-- are re-runnable.

-- ===== 1. Column =====
alter table public.listings add column if not exists is_dynamax boolean not null default false;

comment on column public.listings.is_dynamax is
  'Seller-declared: the creature is a (regular) Dynamax Pokemon. Defaults to false. Seller-set, so it is in '
  'guard_listing_update''s frozen tuple: it cannot change once a chat exists. Mutually exclusive with '
  'is_gigantamax. Species eligibility is client-side and comes in Sprint 2.3, not enforced in the database.';

-- ===== 2. Mutual exclusion with Gigantamax =====
alter table public.listings drop constraint if exists listings_dynamax_xor_gigantamax;
alter table public.listings add constraint listings_dynamax_xor_gigantamax
  check (not (is_dynamax and is_gigantamax));

-- ===== 3. Column grants =====
grant insert (is_dynamax), update (is_dynamax) on public.listings to authenticated;

-- ===== 4. Guard: is_dynamax freezes once a chat exists =====
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball,
      new.form_code, new.costume_code, new.cp, new.size_class, new.is_gigantamax, new.is_dynamax)
     is distinct from
     (old.name, old.pokemon_id, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball,
      old.form_code, old.costume_code, old.cp, old.size_class, old.is_gigantamax, old.is_dynamax)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;

-- ===== Applying it =====
--   1. Migration FIRST, client second. The new client's `LISTING_COLUMNS` select names `is_dynamax` and its
--      inserts write it; against a database without this migration the feed select fails and inserts fail
--      (PGRST204). So: supabase db push (hosted: never `db reset`), then ship the client. The OLD client keeps
--      working after the push (it never writes the column; it stays false).
--   2. supabase gen types typescript --linked > lib/database.types.ts   (gitignored, generated)
--   3. npx tsc --noEmit
