-- Regression test for supabase/migrations/20260929000100_enforce_untradable_pokemon.sql.
--
-- An untradable creature (a Mythical other than Meltan/Melmetal, Zygarde, or a fused Kyurem/Necrozma form)
-- can be neither listed, nor wanted in a listing's looking[], nor formally offered. The offer check must hold
-- for in-chat inserts (lib/api/chats.ts `sendChatMessage`) as well as for `open_offer`. A value that did not
-- change is never re-checked, so an unrelated update to an older row still goes through.
--
-- Fixture (supabase/seed.sql): listing b…004 belongs to EmberVale (a…005), is `open` and has zero chats. Chat
-- c…001 is MintRunner (a…008) buying on DriftCoral's b…001, open and not frozen. CobaltAsh (a…009) has no chat
-- on b…004 yet.
begin;
select plan(16);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— the rule ———
select ok(public.is_creature_untradable(151), 'Mew is untradable');
select ok(not public.is_creature_untradable(808) and not public.is_creature_untradable(809),
  'Meltan and Melmetal are the tradable Mythicals');
select ok(public.is_creature_untradable(718, 'COMPLETE'), 'Zygarde is untradable in every form');
select is(public.is_creature_untradable(646), false, 'unfused Kyurem is tradable (false, never null)');
select ok(public.is_creature_untradable(646, 'WHITE') and public.is_creature_untradable(800, 'DUSK_MANE'),
  'fused Kyurem / Necrozma are untradable');

-- ——— listings, as EmberVale ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type)
     values ('Mew', 151, 2024, 300, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'a Mythical cannot be listed');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, form_code, catch_year, hue, loc, trade_type)
     values ('White Kyurem', 646, 'WHITE', 2024, 200, 'Adyar', 'Unregistered (Standard)') $$,
  'PT400', 'untradable_pokemon_listed', 'a fused form cannot be listed');
select throws_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type, looking)
     values ('Pikachu', 25, 2024, 48, 'Adyar', 'Unregistered (Standard)', '[{"name":"Mew","pokemonId":151,"hue":300}]') $$,
  'PT400', 'untradable_pokemon_wanted', 'a Mythical cannot be wanted in return on insert');
select throws_ok(
  $$ update public.listings set looking = '[{"name":"Deoxys","pokemonId":386,"formCode":"ATTACK","hue":220}]'
      where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'PT400', 'untradable_pokemon_wanted', 'or added to looking[] later');
select lives_ok(
  $$ insert into public.listings (name, pokemon_id, catch_year, hue, loc, trade_type, looking)
     values ('Meltan', 808, 2024, 220, 'Adyar', 'Unregistered (Standard)',
             '[{"name":"Melmetal","pokemonId":809,"hue":220},{"name":"Kyurem","pokemonId":646,"hue":200}]') $$,
  'Meltan can be listed, wanting Melmetal and unfused Kyurem');
reset role;

-- ——— an older row that predates the rule still takes unrelated updates ———
alter table public.listings disable trigger listings_tradable_guard;
update public.listings set looking = '[{"name":"Mew","pokemonId":151,"hue":300}]'
 where id = 'b0000000-0000-4000-8000-000000000004';
alter table public.listings enable trigger listings_tradable_guard;
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');
set local role authenticated;
select lives_ok(
  $$ update public.listings set notes = 'Still here' where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'a notes edit on an older listing that still wants a Mythical is not re-checked');
reset role;

-- ——— formal offers: in-chat inserts, as MintRunner in c…001 ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000008');
set local role authenticated;
select throws_ok(
  $$ insert into public.chat_messages (chat_id, client_id, kind, offer)
     values ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'offer', '{"name":"Mew","pokemonId":151,"hue":300}') $$,
  'PT400', 'untradable_pokemon_offered', 'a Mythical cannot be offered in chat');
select throws_ok(
  $$ insert into public.chat_messages (chat_id, client_id, kind, offer)
     values ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'offer',
             '{"name":"Necrozma","pokemonId":800,"formCode":"DAWN_WINGS","hue":40}') $$,
  'PT400', 'untradable_pokemon_offered', 'nor a fused form');
select lives_ok(
  $$ insert into public.chat_messages (chat_id, client_id, kind, offer)
     values ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'offer', '{"name":"Meltan","pokemonId":808,"hue":220}') $$,
  'Meltan can be offered');
reset role;

-- ——— formal offers: open_offer, as CobaltAsh on b…004 ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$ select public.open_offer('b0000000-0000-4000-8000-000000000004', gen_random_uuid(),
                              '{"name":"Mew","pokemonId":151,"hue":300}'::jsonb, null) $$,
  'PT400', 'untradable_pokemon_offered', 'open_offer refuses a Mythical');
select is(
  (select count(*) from public.chats
    where listing_id = 'b0000000-0000-4000-8000-000000000004' and buyer_id = 'a0000000-0000-4000-8000-000000000009'),
  0::bigint, 'and leaves no half-opened chat behind');
reset role;

select * from finish();
rollback;
