-- Regression test for supabase/migrations/20261017000100_chat_preview_generic_offer.sql.
--
-- `chats.last_message_preview` is what the inbox shows. For an offer it used to quote `offer->>'name'`, a
-- string the client chose (hosted rows held "Sh. Mewtwo"), so a client could put its own text into the other
-- trainer's chat list. The server has no Pokédex and cannot know the species, so the preview is now the generic
-- "Formal offer" and quotes nothing the client sent. If it starts quoting the offer again, these fail.
--
-- Fixture (supabase/seed.sql section 3): chat c1, seller DriftCoral (a…01), buyer MintRunner (a…08). Rows are
-- inserted as the test's superuser, so RLS does not apply; the triggers do.
begin;
select plan(5);

select unalike(
  pg_get_functiondef('private.on_message_inserted'::regproc),
  '%offer->>''name''%',
  'on_message_inserted no longer reads the client-supplied offer name');

-- A deliberately polluted name, as hosted held: it must not reach the preview.
insert into public.chat_messages (chat_id, sender_id, kind, offer)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', 'offer',
        '{"name":"Sh. Mewtwo","pokemonId":150,"hue":220,"shiny":true}'::jsonb);

select is(
  (select last_message_preview from public.chats where id = 'c0000000-0000-4000-8000-000000000001'),
  'Formal offer',
  'an offer previews as the generic "Formal offer"');

select unalike(
  (select last_message_preview from public.chats where id = 'c0000000-0000-4000-8000-000000000001'),
  '%Mewtwo%',
  'and never quotes the name the client sent');

-- The other arms are unchanged.
insert into public.chat_messages (chat_id, sender_id, kind, body)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', 'text', 'see you at 5');

select is(
  (select last_message_preview from public.chats where id = 'c0000000-0000-4000-8000-000000000001'),
  'see you at 5',
  'a text message still previews as its body');

insert into public.chat_messages (chat_id, sender_id, kind, body, system_event)
values ('c0000000-0000-4000-8000-000000000001', null, 'system', 'This chat was closed.', 'bailed');

select is(
  (select last_message_preview from public.chats where id = 'c0000000-0000-4000-8000-000000000001'),
  'Bailed',
  'and a system message still previews as its title-cased event');

select * from finish();
rollback;
