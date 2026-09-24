-- Storage bucket, storage policies, realtime authorization
-- Transcribed verbatim from SUPABASE_PLAN.md §1.7, §2.5, §2.6

-- ===== §1.7 Storage bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-proofs', 'listing-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ===== §2.5 Realtime authorization =====
-- Dashboard: Realtime Settings → disable "Allow public access", so every channel must be private.
create policy realtime_receive_scoped on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.can_receive_topic((select realtime.topic()))
);
-- No INSERT policy: clients cannot publish. Every broadcast originates from a database trigger.

-- ===== §2.6 Storage policies for listing-proofs =====
create policy listing_proofs_obj_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'listing-proofs'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and storage.filename(name) in ('appraisal', 'movesets', 'event_badge')
  and private.can_attach_proof((storage.foldername(name))[2])    -- own, open listing, permanent account
);
create policy listing_proofs_obj_select_owner on storage.objects for select to authenticated using (
  bucket_id = 'listing-proofs' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy listing_proofs_obj_delete_owner on storage.objects for delete to authenticated using (
      bucket_id = 'listing-proofs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.can_attach_proof((storage.foldername(name))[2])
);
-- No UPDATE policy: no upsert. Replacing a proof means delete then re-upload.
-- Buyers cannot download proofs in the MVP (open question §5.2). The OCR worker uses the service role.
