-- Regression test for supabase/migrations/20261112000400_allow_crowned_zacian_zamazenta.sql.
--
-- That migration is the owner's decision (2026-11-12) to list Crowned Sword Zacian (888, `CROWNED_SWORD`) and
-- Crowned Shield Zamazenta (889, `CROWNED_SHIELD`), although the game master marks those templates untradable.
-- It removes exactly those two pairs from `public.is_creature_untradable` and recomputes the server-owned
-- `listings.untradable` flag on listings of the two species. This file checks:
--   * the rule: the two Crowned forms are tradable, while Ultra Necrozma, the fused Kyurem / Necrozma forms,
--     Eternatus and Pecharunt still are not;
--   * the guards pick the change up without being redefined: a seller can switch a listing to a Crowned form
--     and can name one in `looking[]`; `private.creature_json_is_untradable` agrees;
--   * the function's ACL is untouched: `create or replace` kept 20261112000100's revokes, so anon and
--     authenticated still cannot execute it;
--   * section 2 of the migration (repeated below) clears a stale flag on a Crowned listing, keeps one on a
--     listing that is still untradable, and a second run changes nothing.
--
-- Fixtures (supabase/seed.sql). Listing b…005 is IronGlass's (a…006), `open`, with zero chats (the same listing
-- listing_attributes.test.sql edits), so nothing can trip `guard_listing_update`. It is used for the guard cases.
-- Listing b…004 is EmberVale's (a…005), also open with zero chats; it is staged as a flagged Crowned Sword listing
-- and as a flagged Ultra Necrozma one for the data fix. Updates are used in place of inserts because the security
-- hardening's rate limits count inserts.
begin;
select plan(14);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- Section 2 of the migration, verbatim, returning how many rows it touched. A data-modifying CTE cannot sit
-- inside the `select is(...)` below, and a function lets the same text run twice.
create function pg_temp.fix_flag() returns bigint language plpgsql as $$
declare n bigint;
begin
  update public.listings
     set untradable = public.is_creature_untradable(pokemon_id, form_code)
   where untradable
     and pokemon_id in (888, 889);
  get diagnostics n = row_count;
  return n;
end $$;

-- ——— the rule ———
select is(
  array[public.is_creature_untradable(888, 'CROWNED_SWORD'), public.is_creature_untradable(889, 'CROWNED_SHIELD')],
  array[false, false],
  'Crowned Sword Zacian and Crowned Shield Zamazenta are tradable (false, never null)');
select ok(
  public.is_creature_untradable(800, 'ULTRA') and public.is_creature_untradable(646, 'WHITE')
  and public.is_creature_untradable(646, 'BLACK') and public.is_creature_untradable(800, 'DUSK_MANE')
  and public.is_creature_untradable(800, 'DAWN_WINGS'),
  'Ultra Necrozma and the fused Kyurem / Necrozma forms are still untradable');
select ok(
  public.is_creature_untradable(890) and public.is_creature_untradable(890, 'ETERNAMAX')
  and public.is_creature_untradable(1025),
  'Eternatus (every form) and Pecharunt are still untradable');

-- ——— the creature jsonb wrapper reads the new rule ———
select is(
  array[private.creature_json_is_untradable('{"name":"Zacian","pokemonId":888,"formCode":"CROWNED_SWORD"}'),
        private.creature_json_is_untradable('{"name":"Zamazenta","pokemonId":889,"formCode":"CROWNED_SHIELD","hue":340}'),
        private.creature_json_is_untradable('{"name":"Necrozma","pokemonId":800,"formCode":"ULTRA"}')],
  array[false, false, true],
  'the creature jsonb check passes a Crowned creature and still refuses Ultra Necrozma');

-- ——— the guards, as IronGlass on b…005 ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000006');
set local role authenticated;
select lives_ok(
  $$ update public.listings set pokemon_id = 888, form_code = 'CROWNED_SWORD'
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'the seller can switch an open, chat-free listing to Crowned Sword Zacian (listings_tradable_guard passes)');
select lives_ok(
  $$ update public.listings set pokemon_id = 889, form_code = 'CROWNED_SHIELD'
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'and to Crowned Shield Zamazenta');
select lives_ok(
  $$ update public.listings
        set looking = '[{"name":"Zamazenta","pokemonId":889,"formCode":"CROWNED_SHIELD","hue":340}]'
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'a Crowned form can be wanted in return');
select throws_ok(
  $$ update public.listings set pokemon_id = 800, form_code = 'ULTRA'
      where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'PT400', 'untradable_pokemon_listed', 'while Ultra Necrozma is still refused by the same guard');
reset role;

-- ——— the function's ACL is unchanged: still not executable by the API roles ———
select is(
  array[has_function_privilege('anon', 'public.is_creature_untradable(integer, text)', 'execute'),
        has_function_privilege('authenticated', 'public.is_creature_untradable(integer, text)', 'execute')],
  array[false, false],
  'anon and authenticated still cannot execute public.is_creature_untradable (20261112000100 revokes survive create or replace)');

-- ——— the data fix: section 2 of the migration, run as the migration runs (superuser, every trigger on) ———
-- Stage the flag the October migration would have set. `untradable` is outside `guard_listing_update`'s frozen
-- tuple and outside `listings_tradable_guard`'s `update of` columns, so setting it fires neither.
update public.listings set untradable = true where id = 'b0000000-0000-4000-8000-000000000005';   -- Crowned Shield, flagged
select is(
  (select untradable from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  true, 'staged: the Crowned Shield listing carries the flag the old rule set');

-- A listing of another species that is flagged must be left alone, and so must one that is still untradable.
alter table public.listings disable trigger listings_guard;
alter table public.listings disable trigger listings_tradable_guard;
update public.listings set pokemon_id = 800, form_code = 'ULTRA', untradable = true
 where id = 'b0000000-0000-4000-8000-000000000004';   -- still untradable, but not of the two species
alter table public.listings enable trigger listings_guard;
alter table public.listings enable trigger listings_tradable_guard;

select is(pg_temp.fix_flag(), 1::bigint, 'section 2 touches exactly the one flagged Crowned listing');
select is(
  (select array_agg(untradable order by id) from public.listings
    where id in ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005')),
  array[true, false],
  'the Ultra Necrozma listing keeps its flag; the Crowned Shield listing is cleared');
select is(
  (select pokemon_id::text || ':' || form_code from public.listings where id = 'b0000000-0000-4000-8000-000000000005'),
  '889:CROWNED_SHIELD', 'and the cleared listing keeps its creature');
select is(pg_temp.fix_flag(), 0::bigint, 'a second run touches no row');

select * from finish();
rollback;
