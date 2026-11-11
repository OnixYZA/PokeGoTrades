-- Regression test for supabase/migrations/20261017000300_drop_listings_form.sql.
--
-- Three things must hold: `listings.form` is gone and `form_code` is where a form lives; the recreated
-- `guard_listing_update` still RUNS (it read `new.form` / `old.form`, and plpgsql does not track that
-- dependency, so a guard left behind would fail every update on `listings` with 42703, not just edits to the
-- form); and it still freezes `form_code` once a chat exists while leaving the column editable before one.
--
-- Fixture (supabase/seed.sql): listing b…001 belongs to DriftCoral (a…001), is the default-form Zacian (form_code
-- null: Crowned Sword Zacian is untradable, so the seed cannot insert one) and already has chat c…001 on it, so
-- it is the guard case. Listing b…002 is Armored Mewtwo (form_code A). Listing b…004 belongs to EmberVale
-- (a…005), is `open` and has zero chats, so nothing can trip the guard on it.
begin;
select plan(7);

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', false)::text, true)
$$;

-- ——— the column ———
select hasnt_column('public', 'listings', 'form', 'listings.form is gone');
select has_column('public', 'listings', 'form_code', 'and form_code is the only column a form lives in');

-- ——— fixture sanity: the seeded forms are stated as codes alone ———
select is(
  (select form_code from public.listings where id = 'b0000000-0000-4000-8000-000000000001'),
  null::text, 'fixture: DriftCoral''s Zacian is the default form (form_code null)');
select is(
  (select form_code from public.listings where id = 'b0000000-0000-4000-8000-000000000002'),
  'A', 'fixture: GraniteFox''s Mewtwo is Armored (code A)');

-- ——— the guard still runs, and still freezes form_code once a chat exists ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000001');   -- DriftCoral, seller of b...001 (chat c...001 exists)
set local role authenticated;
select lives_ok(
  $$ update public.listings set notes = 'pgTAP touched this' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'an update to an unrelated column still works, so the guard no longer reads the dropped column');
select throws_ok(
  $$ update public.listings set form_code = 'ALOLA' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'PT409', 'listing_has_offers',
  'but changing form_code after a chat exists is rejected, like pokemon_id / shiny / lucky');
reset role;

-- ——— and before any chat exists the seller can still set it ———
select pg_temp.act_as('a0000000-0000-4000-8000-000000000005');   -- EmberVale, seller of b...004 (zero chats)
set local role authenticated;
select lives_ok(
  $$ update public.listings set form_code = 'ALOLA' where id = 'b0000000-0000-4000-8000-000000000004' $$,
  'the seller can set form_code on their own open, offer-free listing');
reset role;

select * from finish();
rollback;
