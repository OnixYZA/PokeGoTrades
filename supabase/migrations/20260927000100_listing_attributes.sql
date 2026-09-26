-- Listing attributes: the seller-facing filters the create/edit flow needs next (purified, costume,
-- pokeball caught in, size class, willing to travel, trade timeline) that `listings` has no columns for yet.
--
-- `purified` and `costume` are seller-observed facts about the creature itself, exactly like `lucky` and
-- `shiny` already on this table, so they join `guard_listing_update`'s frozen-once-offers-exist tuple for the
-- same reason those two are in it: changing them after a buyer has already messaged is a bait-and-switch.
-- `pokeball` is the same shape of fact (what the seller caught it in) and joins the guard alongside them.
--
-- `size_class` ('XXS'..'XXL', the in-game size label) is different: nothing about a listing UI lets
-- a seller type it in today, and it is not meant to. It exists so the OCR worker can record the size read off
-- an appraisal screenshot next to the verified catch date `lucky` already comes from
-- (workers/azure-ocr/src/core/process.ts `grantLucky`). Until that pass ships this column stays null. Because
-- only the service role can ever write it, it needs no grant, no guard-tuple entry (a value the seller never
-- set cannot be their bait-and-switch), and no RLS carve-out — the existing `listings_read` / column-grant
-- shape already covers it.
--
-- `will_travel` and `trade_timeline` are pure logistics (would the seller meet you halfway, how soon do they
-- want to trade) that can keep changing right up to the moment a trade locks, so neither belongs in the guard.
--
-- `Level 1` is a new seller-declared GBL listing_tag value. Postgres will not let a
-- freshly added enum value be referenced in the SAME transaction that adds it (`ALTER TYPE ... ADD VALUE`
-- takes effect only at commit), so nothing else in this file names it.

-- ===== New enums =====
create type public.trade_timeline as enum ('asap', 'this_week', 'this_month', 'flexible');
create type public.pokeball       as enum ('poke', 'great', 'ultra', 'premier', 'master', 'beast', 'safari');
create type public.pokemon_size   as enum ('XXS', 'XS', 'XL', 'XXL');

alter type public.listing_tag add value if not exists 'Level 1';

-- ===== New columns =====
alter table public.listings
  add column purified      boolean not null default false,
  add column costume       boolean not null default false,
  add column pokeball      public.pokeball,
  add column size_class    public.pokemon_size,
  add column will_travel   boolean not null default false,
  add column trade_timeline public.trade_timeline not null default 'flexible';

comment on column public.listings.size_class is
  'Service-role only, like lucky (migration ...000200_lock_lucky_to_service_role). Meant to be filled by a '
  'future OCR pass over an appraisal screenshot, never typed in by the seller, so authenticated has no '
  'insert/update grant on it and it is absent from guard_listing_update''s frozen-fields tuple.';

-- Backfill from the existing `form` convention (CreateListingModal.tsx sets form = 'Purified' today). Runs
-- BEFORE the guard is replaced below: the old guard compares only its original columns, none of which change
-- here (`form` is left as-is), so it cannot raise even on listings that already have chats. The other UPDATE
-- triggers are harmless: `listings_updated_at` bumps updated_at, `listings_lock_consistency` re-checks an
-- unchanged status, and `listings_status_broadcast` fires only on `update of status`.
update public.listings set purified = true where form = 'Purified';

-- ===== Column grants (§2.1 pattern): size_class deliberately excluded, see the comment above =====
grant insert (purified, costume, pokeball, will_travel, trade_timeline),
      update (purified, costume, pokeball, will_travel, trade_timeline)
  on public.listings to authenticated;

-- ===== Guard: purified / costume / pokeball freeze once a chat exists, like lucky / shiny already do =====
create or replace function private.guard_listing_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.pokemon_id, new.form, new.catch_year, new.lucky, new.shiny, new.trade_type,
      new.iv_atk, new.iv_def, new.iv_sta, new.bg, new.loc, new.purified, new.costume, new.pokeball)
     is distinct from
     (old.name, old.pokemon_id, old.form, old.catch_year, old.lucky, old.shiny, old.trade_type,
      old.iv_atk, old.iv_def, old.iv_sta, old.bg, old.loc, old.purified, old.costume, old.pokeball)
     and exists (select 1 from public.chats c where c.listing_id = old.id)
  then
    raise sqlstate 'PT409' using message = 'listing_has_offers',
      hint = 'Withdraw and relist to change trade-relevant details.';
  end if;
  return new;
end $$;
