-- Regression test for supabase/migrations/20261018000100_untradable_crowned_ultra_eternatus.sql.
--
-- That migration widens `public.is_creature_untradable` (the rule 20260929000100 put behind the listing and offer
-- triggers) with Zacian `CROWNED_SWORD`, Zamazenta `CROWNED_SHIELD`, Necrozma `ULTRA` and Eternatus (890) as a
-- whole species. Pecharunt (1025) is untradable too: it was already on the Mythical list, and the product
-- deliberately overrides the game master, which marks it tradable. This file checks four things:
--   * the rule: the new entries are untradable, the default forms and the neighbouring species are not, and the
--     entries that were already there still are;
--   * the guards pick the rule up without being redefined: a new listing, or a looking[] entry, naming one of
--     them raises PT400, while its tradable twin goes through;
--   * a row that predates the rule keeps taking unrelated edits (a value that did not change is never
--     re-checked) but cannot be pointed at another untradable entry;
--   * the one-time data fix (sections 2 and 3 of the migration, repeated below) strips the new entries from
--     looking[] in order, flags the listings OF these creatures, and runs through every trigger on `listings`
--     even for a listing with chats and a locked one. It leaves chat offers and Arsenal / Wishlist entries
--     alone, and a second run changes nothing.
--
-- Fixture (supabase/seed.sql): listing b…001 is DriftCoral's (a…001) default-form Zacian with chats c…001-003,
-- b…003 is NoxTrainer's (a…004) Rayquaza, locked by chat c…004, and b…004 is EmberVale's (a…005), open, with zero
-- chats. MintRunner (a…008) is the buyer in c…001. Rows that "predate the rule" are staged by switching the guard
-- triggers off for a moment, the same way untradable_pokemon.test.sql does.
begin;
select plan(31);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- Sections 2 and 3 of the migration, verbatim, each returning how many rows it touched. A data-modifying CTE
-- cannot sit inside the `select is(...)` below, and a function lets the same text run twice.
create function pg_temp.fix_looking() returns bigint language plpgsql as $$
declare n bigint;
begin
  update public.listings l
     set looking = coalesce((
           select jsonb_agg(t.e order by t.ord)
             from jsonb_array_elements(l.looking) with ordinality as t(e, ord)
            where not private.creature_json_is_untradable(t.e)), '[]'::jsonb)
   where exists (select 1 from jsonb_array_elements(l.looking) e where private.creature_json_is_untradable(e));
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.fix_flag() returns bigint language plpgsql as $$
declare n bigint;
begin
  update public.listings set untradable = true
   where public.is_creature_untradable(pokemon_id, form_code) and not untradable;
  get diagnostics n = row_count;
  return n;
end $$;

-- ——— the rule: what is now untradable ———
select ok(public.is_creature_untradable(888, 'CROWNED_SWORD'), 'Crowned Sword Zacian is untradable');
select ok(public.is_creature_untradable(889, 'CROWNED_SHIELD'), 'Crowned Shield Zamazenta is untradable');
select ok(public.is_creature_untradable(800, 'ULTRA'), 'Ultra Necrozma is untradable');
select is(
  array[public.is_creature_untradable(890), public.is_creature_untradable(890, 'ETERNAMAX'),
        public.is_creature_untradable(890, 'A_FORM_NOBODY_HAS_LISTED_YET')],
  array[true, true, true],
  'Eternatus is untradable as a species: with no form, as Eternamax, and in any form code');
select ok(public.is_creature_untradable(1025),
  'Pecharunt stays untradable (a listed Mythical, kept by the owner despite the game master)');

-- ——— the rule: what stays tradable ———
-- `false`, never null: the form-code comparison is null for a null form and `coalesce` turns it into false.
select is(
  array[public.is_creature_untradable(888), public.is_creature_untradable(888, 'HERO'),
        public.is_creature_untradable(889), public.is_creature_untradable(889, 'HERO'),
        public.is_creature_untradable(800), public.is_creature_untradable(800, 'NORMAL')],
  array[false, false, false, false, false, false],
  'default-form Zacian, Zamazenta and Necrozma are tradable (false, never null)');
select is(
  array[public.is_creature_untradable(889, 'CROWNED_SWORD'), public.is_creature_untradable(888, 'CROWNED_SHIELD'),
        public.is_creature_untradable(888, 'ULTRA'), public.is_creature_untradable(800, 'CROWNED_SWORD')],
  array[false, false, false, false],
  'a form code only counts together with its own species');
select is(
  array[public.is_creature_untradable(887), public.is_creature_untradable(891), public.is_creature_untradable(892)],
  array[false, false, false],
  'the species either side of Eternatus (Dragapult, Kubfu, Urshifu) are tradable');

-- ——— the rule: what was already untradable still is ———
select ok(
  public.is_creature_untradable(151) and public.is_creature_untradable(718, 'COMPLETE')
  and public.is_creature_untradable(646, 'WHITE') and public.is_creature_untradable(800, 'DUSK_MANE')
  and public.is_creature_untradable(800, 'DAWN_WINGS'),
  'Mew, Zygarde and the fused Kyurem / Necrozma forms are still untradable');
select ok(
  not public.is_creature_untradable(808) and not public.is_creature_untradable(809)
  and not public.is_creature_untradable(646),
  'Meltan, Melmetal and unfused Kyurem are still tradable');

-- ——— the creature jsonb wrapper and the guards read the new rule without being redefined ———
select is(
  array[private.creature_json_is_untradable('{"name":"Zacian","pokemonId":888,"formCode":"CROWNED_SWORD"}'),
        private.creature_json_is_untradable('{"name":"Eternatus","pokemonId":890,"formCode":"ETERNAMAX"}'),
        private.creature_json_is_untradable('{"name":"Zacian","pokemonId":888}')],
  array[true, true, false],
  'the creature jsonb check sees the widened rule');

-- ——— listings, as EmberVale ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, form_code, catch_year, hue, loc, trade_type)
     values ('Zacian', 888, 'CROWNED_SWORD', 2024, 260, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'Crowned Sword Zacian cannot be listed');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, form_code, catch_year, hue, loc, trade_type)
     values ('Zamazenta', 889, 'CROWNED_SHIELD', 2024, 340, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'nor can Crowned Shield Zamazenta');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, form_code, catch_year, hue, loc, trade_type)
     values ('Necrozma', 800, 'ULTRA', 2024, 40, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'nor Ultra Necrozma');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, form_code, catch_year, hue, loc, trade_type)
     values ('Eternatus', 890, 'ETERNAMAX', 2024, 280, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'nor Eternamax Eternatus');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type)
     values ('Eternatus', 890, 2024, 280, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'nor Eternatus in its default form');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type, looking)
     values ('Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)',
             '[{"name":"Zacian","pokemonId":888,"formCode":"CROWNED_SWORD","hue":260}]') $$,
  'PT400', 'untradable_pokemon_wanted', 'Crowned Sword Zacian cannot be wanted in return either');
select throws_ok(
  $$ update public.listings set pokemon_id = 888, form_code = 'CROWNED_SWORD'
      where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'PT400', 'untradable_pokemon_listed', 'and an existing listing cannot be switched to one later');
select lives_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type, looking)
     values ('Zacian', 888, 2024, 260, 'Adyar', 'Unregistered (Standard)',
             '[{"name":"Zamazenta","pokemonId":889,"hue":340},{"name":"Necrozma","pokemonId":800,"hue":40}]') $$,
  'default-form Zacian can be listed, wanting default-form Zamazenta and Necrozma');
reset role;

-- ——— stage rows that predate the rule ———
-- The guards are switched off just long enough to write them, then back on, so everything below runs through
-- the real triggers. b…001 (three chats) becomes Crowned Sword Zacian, which guard_listing_update would freeze,
-- so that trigger is off for it too. Each looking[] holds at most 3 entries (creature_ref_array_is_valid).
alter table public.listings disable trigger listings_guard;
alter table public.listings disable trigger listings_tradable_guard;
update public.listings
   set pokemon_id = 888, form_code = 'CROWNED_SWORD',
       looking = '[{"name":"Lugia","pokemonId":249,"hue":25},
                   {"name":"Zamazenta","pokemonId":889,"formCode":"CROWNED_SHIELD","hue":340},
                   {"name":"Mewtwo","pokemonId":150,"hue":220,"lucky":true}]'
 where id = 'b0000000-0000-4000-8000-000000000001';
update public.listings
   set pokemon_id = 890, form_code = 'ETERNAMAX',
       looking = '[{"name":"Necrozma","pokemonId":800,"formCode":"ULTRA","hue":40},
                   {"name":"Entei","pokemonId":244,"hue":25},
                   {"name":"Eternatus","pokemonId":890,"hue":280}]'
 where id = 'b0000000-0000-4000-8000-000000000004';
update public.listings
   set looking = '[{"name":"Eternatus","pokemonId":890,"formCode":"ETERNAMAX","hue":280}]'
 where id = 'b0000000-0000-4000-8000-000000000003';
alter table public.listings enable trigger listings_guard;
alter table public.listings enable trigger listings_tradable_guard;

-- An old offer of Crowned Sword Zacian in chat c…001 and an Eternatus on DriftCoral's Wishlist.
alter table public.chat_messages disable trigger chat_messages_tradable_offer;
insert into public.chat_messages (chat_id, sender_id, client_id, kind, offer)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', gen_random_uuid(), 'offer',
        '{"name":"Zacian","pokemonId":888,"formCode":"CROWNED_SWORD","hue":260}');
alter table public.chat_messages enable trigger chat_messages_tradable_offer;
insert into public.trainer_creatures (owner_id, list, creature, sort_order)
values ('a0000000-0000-4000-8000-000000000001', 'wishlist', '{"name":"Eternatus","pokemonId":890,"hue":280}', 9);

-- ——— an older row that now breaks the rule still takes unrelated edits ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');   -- EmberVale, seller of b…004 (Eternamax Eternatus)
set local role authenticated;
select lives_ok(
  $$ update public.listings set notes = 'Still here' where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'a notes edit on an existing Eternatus listing, whose looking[] still holds untradable entries, is not re-checked');
select throws_ok(
  $$ update public.listings set looking = '[{"name":"Eternatus","pokemonId":890,"hue":280}]'
      where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'PT400', 'untradable_pokemon_wanted', 'but looking[] cannot be changed to hold an untradable entry');
reset role;
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');   -- DriftCoral, seller of b…001 (Crowned Sword, 3 chats)
set local role authenticated;
select lives_ok(
  $$ update public.listings set notes = 'Still here' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'and so is a notes edit on an existing Crowned Sword listing that already has chats');
reset role;

-- ——— the one-time data fix: sections 2 and 3 of the migration, run as the migration runs (superuser, every trigger on) ———
select is(pg_temp.fix_looking(), 3::bigint,
  'section 2 rewrites looking[] on the three listings that held a newly untradable entry, chats and lock included');
select is(pg_temp.fix_flag(), 2::bigint, 'section 3 flags the two listings OF a newly untradable creature');

select is(
  (select array_agg(jsonb_path_query_array(looking, '$[*].name') order by id) from public.listings
    where id in ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003',
                 'b0000000-0000-4000-8000-000000000004')),
  array['["Lugia","Mewtwo"]'::jsonb, '[]'::jsonb, '["Entei"]'::jsonb],
  'what is left of each looking[] keeps its order (b…001: Lugia then Mewtwo; b…003: empty; b…004: Entei)');
select is(
  (select array_agg(untradable order by id) from public.listings
    where id in ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
                 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004')),
  array[true, false, false, true], 'b…001 and b…004 are flagged; Mewtwo and Rayquaza are not');
select is(
  (select pokemon_id::text || ':' || form_code || ':' || (select count(*) from public.chats c where c.listing_id = l.id)::text
     from public.listings l where l.id = 'b0000000-0000-4000-8000-000000000001'),
  '888:CROWNED_SWORD:3', 'the flagged listing keeps its creature and its three chats (it is frozen, only closed to offers)');
select is(
  (select l.status::text || ':' || (select count(*) from public.trade_locks t where t.listing_id = l.id)::text
     from public.listings l where l.id = 'b0000000-0000-4000-8000-000000000003'),
  'locked:1', 'the locked listing is still locked, with its trade lock');
select is(
  (select count(*) from public.chat_messages where chat_id = 'c0000000-0000-4000-8000-000000000001' and kind = 'offer')
  + (select count(*) from public.trainer_creatures where owner_id = 'a0000000-0000-4000-8000-000000000001'
        and list = 'wishlist' and creature->>'name' = 'Eternatus'),
  2::bigint, 'the old chat offer and the Wishlist entry are left alone');

-- ——— a second run has nothing left to do ———
select is(pg_temp.fix_looking(), 0::bigint, 'running section 2 again touches no row');
select is(pg_temp.fix_flag(), 0::bigint, 'and neither does section 3');

select * from finish();
rollback;
