-- Chat proof / screenshot image attachments (`chat-images` private bucket + `chat_messages.image_path`).
-- Idempotent: safe to re-run.
--
-- Postgres 55P04 safety: `ALTER TYPE public.message_kind ADD VALUE IF NOT EXISTS 'image'` cannot be cast/compared
-- as `public.message_kind` in the same transaction before commit, so constraints, policies and triggers compare
-- `kind::text` instead of `'image'::public.message_kind`.

-- ===== 1. Enum, column, constraint, column grant =====
alter type public.message_kind add value if not exists 'image';

alter table public.chat_messages add column if not exists image_path text;

alter table public.chat_messages drop constraint if exists chat_messages_image_shape;
alter table public.chat_messages add constraint chat_messages_image_shape check (
  (kind::text = 'image') = (image_path is not null)
  and (
    image_path is null
    or (
      sender_id is not null
      and client_id is not null
      and image_path = chat_id::text || '/' || sender_id::text || '/' || client_id::text
    )
  )
);

grant insert (image_path) on public.chat_messages to authenticated;

-- ===== 2. Private storage bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ===== 3. Private helper functions (security definer, pinned search_path, explicit execute grants) =====
create or replace function private.can_upload_chat_image(p_chat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_chat is not null and p_chat ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select auth.jwt()->>'is_anonymous')::boolean is false
       and private.can_post_message(p_chat::uuid)
    else false
  end
$$;

create or replace function private.can_read_chat_image(p_chat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_chat is not null and p_chat ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_chat::uuid in (select private.my_chat_ids())
    else false
  end
$$;

create or replace function private.chat_image_object_exists(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_path is not null
     and exists (
       select 1 from storage.objects o
        where o.bucket_id = 'chat-images'
          and o.name = p_path
          and o.owner_id = (select auth.uid()::text)
     )
$$;

create or replace function private.chat_image_uploads_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 30
    from storage.objects o
   where o.bucket_id = 'chat-images'
     and o.owner_id = (select auth.uid()::text)
     and o.created_at > now() - interval '1 hour'
$$;

revoke execute on function
  private.can_upload_chat_image(text),
  private.can_read_chat_image(text),
  private.chat_image_object_exists(text),
  private.chat_image_uploads_allowed()
from public, anon;

grant execute on function
  private.can_upload_chat_image(text),
  private.can_read_chat_image(text),
  private.chat_image_object_exists(text),
  private.chat_image_uploads_allowed()
to authenticated;

-- ===== 4. Storage policies on storage.objects =====
drop policy if exists chat_images_obj_insert on storage.objects;
create policy chat_images_obj_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'chat-images'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = (select auth.uid()::text)
  and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.can_upload_chat_image((storage.foldername(name))[1])
);

drop policy if exists chat_images_obj_insert_rate_limit on storage.objects;
create policy chat_images_obj_insert_rate_limit on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'chat-images' or (select private.chat_image_uploads_allowed()));

drop policy if exists chat_images_obj_select_participants on storage.objects;
create policy chat_images_obj_select_participants on storage.objects for select to authenticated using (
  bucket_id = 'chat-images' and private.can_read_chat_image((storage.foldername(name))[1])
);

-- ===== 5. Chat messages insert policy =====
drop policy if exists chat_messages_insert_participant on public.chat_messages;
create policy chat_messages_insert_participant on public.chat_messages for insert to authenticated with check (
      sender_id = (select auth.uid())
  and kind::text in ('text', 'offer', 'image')
  and private.can_post_message(chat_id)
  and (kind::text <> 'image' or private.chat_image_object_exists(image_path))
);

-- ===== 6. Inbox preview + broadcast trigger =====
create or replace function private.on_message_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_chat public.chats;
begin
  update public.chats
     set last_message_at = new.created_at,
         last_message_preview = left(case new.kind::text
           when 'offer'  then 'Formal offer'
           when 'image'  then case when char_length(btrim(new.body)) > 0 then '📷 ' || btrim(new.body) else '📷 Photo' end
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

revoke execute on function private.on_message_inserted() from public, anon, authenticated;
