-- Listings gain a seller-declared Gigantamax (G-Max) flag.
--
-- ===== is_gigantamax =====
-- Whether the creature is a Gigantamax Pokemon, a seller-declared fact like `shiny` / `purified`, shown as a
-- badge on the card and the trade summary and filterable in the feed. `not null default false`, so every
-- existing listing is a normal (non-G-Max) creature and the existing pgTAP inserts need no change.
-- It is a trade-relevant fact, so it joins `guard_listing_update`'s frozen tuple: flipping it after a buyer has
-- messaged is the same bait-and-switch the tuple already blocks for shiny, purified, cp, size_class...
-- Eligibility (which species can be G-Max) is NOT enforced here: it is client-side data generated from the
-- pinned PokeMiners asset listing (constants/pokedex.ts `canGigantamax`).
--
-- ===== guard_listing_update =====
-- Recreated from its latest definition (20261103000200_listings_cp_and_size_grant.sql; no later migration
-- redefines it), with `is_gigantamax` appended to BOTH tuples and nothing else changed.
--
-- Idempotent: `add column if not exists`, `create or replace`, and grant / comment are re-runnable.

-- ===== 1. Column =====
alter table public.listings add column if not exists is_gigantamax boolean not null default false;

comment on column public.listings.is_gigantamax is
  'Seller-declared: the creature is a Gigantamax Pokemon. Defaults to false. Seller-set, so it is in '
  'guard_listing_update''s frozen tuple: it cannot change once a chat exists. Species eligibility is client-side '
  'data (constants/pokedex.ts canGigantamax), not enforced in the database.';

-- ===== 2. Column grants =====
grant insert (is_gigantamax), update (is_gigantamax) on public.listings to authenticated;

-- ===== 3. Guard: is_gigantamax freezes once a chat exists =====
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball,
      new.form_code, new.costume_code, new.cp, new.size_class, new.is_gigantamax)
     is distinct from
     (old.name, old.pokemon_id, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball,
      old.form_code, old.costume_code, old.cp, old.size_class, old.is_gigantamax)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;

-- ===== Applying it =====
--   1. Migration FIRST, client second. The new client writes `is_gigantamax`; against a database without this
--      migration those inserts fail (PGRST204). So: supabase db push (hosted: never `db reset`), then ship the
--      client. The OLD client keeps working after the push (it never writes the column; it stays false).
--   2. supabase gen types typescript --linked > lib/database.types.ts   (gitignored, generated)
--   3. npx tsc --noEmit
