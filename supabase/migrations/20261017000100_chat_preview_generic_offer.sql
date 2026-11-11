-- The inbox preview of a formal offer no longer quotes the offer's `name`.
--
-- `private.on_message_inserted` built `chats.last_message_preview` for an offer message as
-- `'Formal offer · ' || (new.offer->>'name')`. That `name` is free text the client put in the jsonb: the
-- check on `chat_messages.offer` (`formal_offer_is_valid`) only bounds its length, so the server never knew it
-- was the species' name. Hosted rows prove it was not: "Sh. Mewtwo", "Legacy Dnite", "Purified Apex Ho-Oh".
-- `ChatRow` shows `last_message_preview` as it is stored, so every one of those spellings reached the inbox
-- verbatim, and a client that writes its own display text can put anything it likes into another trainer's
-- chat list.
--
-- The client no longer trusts that string either: it derives a creature's name from `pokemonId` and the
-- Pokédex (`lib/format.ts` `creatureDisplayName`), and writes the dex name back into the jsonb
-- (`lib/api/creature-ref.ts` `creatureRefToJson`). The SERVER has no Pokédex, so it cannot say the species at
-- all, and the honest preview is the generic one. Nothing the client sent is quoted, so there is nothing left
-- to pollute or spoof. The offer card in the thread, which the client does render from the dex, carries the
-- detail.
--
-- ("Formal offer · Shiny" was considered, from the boolean `offer->'shiny'`. Without a species it reads as
-- a fragment, so it is left out; the unread badge and the card already tell the trainer to look.)
--
-- Only the `'offer'` arm of the CASE changes. This is `private.on_message_inserted` exactly as migration
-- 20260916000300 defines it, which is its latest definition (no later migration redefines it; checked by
-- grep over every migration). `create or replace` keeps the `chat_messages_after_insert` trigger bound to it.
--
-- Rows already stored keep the wording they were written with. The next migration
-- (20261017000200_wipe_legacy_chat_data.sql) deletes every existing chat, so there is nothing to backfill.
--
-- Mirrored by the mock path in `store/trade-store.tsx` (`FORMAL_OFFER_PREVIEW`), so the two cannot drift:
-- change the wording in both.
create or replace function private.on_message_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_chat public.chats;
begin
  update public.chats
     set last_message_at = new.created_at,
         last_message_preview = left(case new.kind
           when 'offer'  then 'Formal offer'
           when 'system' then initcap(replace(new.system_event::text, '_', ' '))
           else new.body end, 120)
   where id = new.chat_id
  returning * into v_chat;
  perform private.broadcast('chat:' || new.chat_id, 'message', to_jsonb(new));
  perform private.broadcast('user:' || v_chat.seller_id, 'chat_updated',
    jsonb_build_object('chat_id', new.chat_id, 'last_message_at', new.created_at));
  perform private.broadcast('user:' || v_chat.buyer_id, 'chat_updated',
    jsonb_build_object('chat_id', new.chat_id, 'last_message_at', new.created_at));
  return null;
end $$;
