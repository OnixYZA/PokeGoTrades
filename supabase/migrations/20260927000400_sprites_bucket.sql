-- Sprites bucket: a public, read-only mirror of upstream sprite art (PokeMiners/pogo_assets),
-- served straight from Storage's public URL rather than proxied through the API. See
-- lib/sprite-url.ts for the object-key scheme (spriteObjectKey / backgroundObjectKey) and
-- scripts/mirror-assets.ts for what actually populates it.
--
-- No storage.objects policies, on purpose: a PUBLIC bucket's objects are already readable by anyone
-- via the public URL, bypassing RLS entirely — there is no SELECT policy to write for that. Every
-- write (insert/update/delete) requires the service role, which also bypasses RLS. That leaves
-- `anon` / `authenticated` with nothing to grant: zero policies here means neither role can list,
-- insert, update or delete a single object, which is exactly the intent — only `scripts/mirror-assets.ts`
-- (service role key) ever writes to this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sprites', 'sprites', true, 1048576, array['image/png'])
on conflict (id) do nothing;
