-- Market demand view: per (pokemon_id, shiny), how many distinct trainers want one vs. have one to give up.
-- Feeds a future "hot / cold" demand badge on the listing feed; tiering that number into a label is TS-side
-- logic (project rule: no tier thresholds duplicated into SQL), so this view returns raw counts only.
--
-- "Wants one" (demand) is the union of two places a trainer expresses that: a `trainer_creatures` wishlist
-- entry, and a `listings.looking[]` entry on a listing they are currently running (the seller is, in effect,
-- wishlisting whatever they put in `looking`). "Has one to give up" (supply) mirrors that shape: an arsenal
-- entry, or the listing itself. Both sides read `looking[]` / `listings` only for `status = 'open'` —
-- `locked`, `completed` and `withdrawn` listings are not a standing offer to trade, so they count as neither
-- supply nor demand; matches `listings_feed_idx`'s own `where status in ('open', 'locked')`, minus `locked`
-- because a locked listing already has its one buyer and is not soliciting more.
--
-- Both sides count DISTINCT users, not rows: a trainer with both a wishlist entry and a `looking[]` entry for
-- the same (pokemon_id, shiny) counts once on the demand side, not twice. A `looking[]` / `CreatureRef` entry
-- with no `shiny` key means non-shiny (`creature_ref_is_valid` never requires the key), so it is coalesced to
-- false rather than left null and silently dropped from every group.
--
-- `security_invoker = true` means this view carries no more visibility than the caller already has: it can
-- only ever surface counts derived from rows `trainer_creatures_read` (public) and `listings_read` (open
-- listings, minus blocked sellers) already let that specific caller see. No row's user id is ever selected,
-- so no query against this view can name who is on either side of a count.

-- Shape: ONE `group by pokemon_id, shiny` over a UNION ALL of every signal, with each side counted by
-- `count(distinct user_id) filter (...)`. Deliberately not two grouped CTEs joined by a full outer join: the
-- join's `coalesce(d.pokemon_id, s.pokemon_id)` output column blocks predicate pushdown, so the feed's
-- `where pokemon_id in (...)` would aggregate every wishlist and listing in the database on every load. Here
-- pokemon_id is a plain grouping column, so that predicate is pushed below the aggregate and into each branch,
-- where the index below (and the listings pk/feed indexes) can serve it.
--
-- `pokemonId` / `shiny` casts are safe: `creature_ref_is_valid` (...000100) only admits an integer-shaped
-- `pokemonId` number and a boolean `shiny`, for both trainer_creatures and every `looking[]` entry.
create index trainer_creatures_pokemon_idx
  on public.trainer_creatures (((creature->>'pokemonId')::int), list);

create view public.pokemon_market_demand with (security_invoker = true) as
select
  pokemon_id,
  shiny,
  (count(distinct user_id) filter (where side = 'want'))::int as wanted_count,
  (count(distinct user_id) filter (where side = 'have'))::int as offered_count,
  round(
    (count(distinct user_id) filter (where side = 'want'))::numeric
      / greatest(count(distinct user_id) filter (where side = 'have'), 1),
    2
  )::numeric(8, 2) as demand_ratio
from (
  -- want: a wishlist entry
  select (t.creature->>'pokemonId')::int as pokemon_id,
         coalesce((t.creature->>'shiny')::boolean, false) as shiny,
         t.owner_id as user_id,
         'want'::text as side
  from public.trainer_creatures t
  where t.list = 'wishlist'
  union all
  -- want: a `looking[]` entry on a listing the seller is running
  select (entry->>'pokemonId')::int, coalesce((entry->>'shiny')::boolean, false), l.seller_id, 'want'
  from public.listings l
  cross join lateral jsonb_array_elements(l.looking) as entry
  where l.status = 'open'
  union all
  -- have: an arsenal entry
  select (t.creature->>'pokemonId')::int, coalesce((t.creature->>'shiny')::boolean, false), t.owner_id, 'have'
  from public.trainer_creatures t
  where t.list = 'arsenal'
  union all
  -- have: the open listing itself
  select l.pokemon_id, l.shiny, l.seller_id, 'have'
  from public.listings l
  where l.status = 'open'
) as signal
group by pokemon_id, shiny;

comment on view public.pokemon_market_demand is
  'Computed live from trainer_creatures + listings. Interface (columns, grain: one row per pokemon_id+shiny, '
  'counts only) is stable enough that a pg_cron job could later refresh this into a plain table on a schedule '
  'instead, with callers needing no change.';

-- Default privileges are revoked (...000100), so both roles need an explicit grant; anon gets nothing.
grant select on public.pokemon_market_demand to authenticated, service_role;
