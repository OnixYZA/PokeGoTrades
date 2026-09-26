-- Profile proofs: a second OCR queue, fed from the "My Trainer Code" screen (trainer name + a 12-digit friend
-- code, usually beside a QR block), that lets a trainer prove their handle and friend code by screenshot instead
-- of typing them in and hoping they matched what the game actually shows. Mirrors `listing_proofs` (migrations
-- …000200 / …000300 / …000400 / …000600) closely on purpose: same enum, same claim/settle machinery in
-- `workers/azure-ocr/src/core/process.ts`, same one-object-per-row storage layout — but two things differ, and
-- both differ for the same reason: this queue writes to `profiles` / `profile_private`, columns a trainer's own
-- session can already write directly.
--
--   1. A verified read does not just record `ocr_extracted` and stop, the way a listing proof does. It has to
--      land in `profiles.handle` and `profile_private.friend_code`, and it has to survive a trainer's OWN handle
--      already being taken by someone else, or having just changed while the proof was mid-flight. That decision
--      needs the two tables' own uniqueness and check constraints as the referee, which only a database
--      transaction (not the worker, and not two separate PostgREST calls) can enforce atomically — hence
--      `apply_profile_proof` below, a service-role-only RPC that claims the proof, writes both columns, and
--      settles the row's terminal status all inside one transaction.
--   2. This queue cannot simply wait for the once-a-minute sweep the way an appraisal or moveset proof does.
--      Onboarding is a one-shot, blocking wait for the trainer (they uploaded a screenshot and the app is
--      showing a spinner), where a listing proof's badge can appear a minute late with nobody watching. So this
--      insert also fires a trigger (`private.notify_profile_ocr`) that nudges the deployed Azure Function over
--      HTTP the moment a row lands, via `pg_net` — async and best-effort, never a reason the insert itself could
--      fail, with the once-a-minute timer sweep (`src/functions/ocrSweep.ts`) as the backstop if the nudge is
--      lost, arrives before the row is committed, or `azure_ocr_url` is not configured at all (local dev: the
--      hosted database's `pg_net` cannot reach `http://localhost:7071`, so local testing relies entirely on that
--      timer sweep — see `workers/azure-ocr/README.md`).
--
-- `pg_net` needs enabling once per project; nothing before this migration used it.
create extension if not exists pg_net with schema extensions;

-- ===== Storage bucket, sized and typed exactly like listing-proofs (migration …000600) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-proofs', 'profile-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ===== Table =====
-- Object path is `<uid>/<proof id>`, one level shallower than `listing_proofs`' `<uid>/<listing_id>/<kind>`:
-- there is no listing to namespace under and no fixed set of "kinds", just whichever proof a trainer most
-- recently uploaded. The client generates `id`, uploads the object to that path FIRST, then inserts
-- `{ id, storage_path }` — the same upload-before-insert order `listing_proofs` uses, and for the same reason:
-- `profile_proof_object_exists` below can only check an object that already exists.
create table public.profile_proofs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path  text not null unique,
  ocr_status    public.ocr_status not null default 'pending',   -- reuses the enum: pending|processing|verified|failed|rejected
  ocr_extracted jsonb,
  created_at    timestamptz not null default now()
);

-- One in-flight proof per trainer at a time. Without this, a trainer who double-taps "upload" (or retries after
-- a slow network) could queue two proofs that both end up `processing` together, and whichever one's
-- `apply_profile_proof` call commits second would find the OTHER settled it already — a confusing `lost_claim`
-- for what looks, from the app, like the trainer's only upload. The partial index turns that race into a plain
-- 23505 the client sees synchronously, at insert time, before either proof is ever claimed.
create unique index profile_proofs_one_inflight_idx
  on public.profile_proofs (user_id) where ocr_status in ('pending', 'processing');

-- The queue order `processQueue` reads (oldest `pending`/`processing` first), exactly mirroring
-- `listing_proofs_ocr_queue_idx`.
create index profile_proofs_ocr_queue_idx
  on public.profile_proofs (created_at) where ocr_status in ('pending', 'processing');

-- ===== Grants =====
-- `grant all on all tables in schema public to service_role` (migration …000400) only covers tables that existed
-- when it ran, and the project revokes default privileges (migration …000100), so both roles need an explicit
-- grant here, or `authenticated` gets nothing and `service_role` (the worker) gets nothing either.
grant select, insert (id, storage_path) on public.profile_proofs to authenticated;
grant all on public.profile_proofs to service_role;

-- Mirrors `private.proof_object_exists` (migration …000300), which hardcodes bucket 'listing-proofs'; that
-- function cannot simply take a bucket parameter and serve both, because a CHECK-context boolean function used
-- inside RLS must stay `stable` with no dynamic bucket lookup, and hardcoding keeps the two independently
-- auditable. Confirms the client actually uploaded the object at this path, owned by this trainer, before the
-- row pointing at it is allowed to exist. It has to be created before the insert policy below: `create policy`
-- resolves the functions its expression calls at creation time.
create function private.profile_proof_object_exists(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o
                 where o.bucket_id = 'profile-proofs' and o.name = p_path
                   and o.owner_id = (select auth.uid()::text))
$$;
grant execute on function private.profile_proof_object_exists(text) to authenticated;

alter table public.profile_proofs enable row level security;

create policy profile_proofs_read_self on public.profile_proofs for select to authenticated
  using (user_id = (select auth.uid()));

create policy profile_proofs_insert_self on public.profile_proofs for insert to authenticated with check (
      user_id = (select auth.uid())
  and (select auth.jwt()->>'is_anonymous')::boolean is false
  and storage_path = (select auth.uid())::text || '/' || id::text
  and private.profile_proof_object_exists(storage_path)
);
-- No UPDATE or DELETE policy: a trainer cannot edit or withdraw a proof once uploaded, and there is nothing to
-- replace it with short of uploading a new one (which the in-flight index limits to one at a time anyway). Only
-- `apply_profile_proof`, running as `service_role`, ever changes a row after it is inserted.

-- ===== Storage policies for profile-proofs =====
-- One path segment (the uid folder) plus a lowercase-uuid filename — no "kind" segment, unlike listing-proofs,
-- since a profile proof is not one of a fixed small set of screen types.
create policy profile_proofs_obj_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'profile-proofs'
  and array_length(storage.foldername(name), 1) = 1
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select auth.jwt()->>'is_anonymous')::boolean is false
);
create policy profile_proofs_obj_select_owner on storage.objects for select to authenticated using (
  bucket_id = 'profile-proofs' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
-- No UPDATE and no DELETE policy: unlike a listing proof (deletable while the listing is still open), a profile
-- proof is never replaced or withdrawn once uploaded — see the table policies above.

-- ===== apply_profile_proof: the only writer of profiles.handle / profile_private.friend_code from this queue =====
--
-- Runs as `service_role` only (never PostgREST-reachable by a trainer's own session): the worker calls it once
-- OCR has read a candidate handle and friend code off the screenshot, with the proof row already claimed
-- (`ocr_status = 'processing'`) by the worker's own compare-and-swap. Everything from the row lock to the final
-- settle happens in one transaction, so "write the two profile columns" and "mark the proof done" can never
-- observably split: a caller (or a concurrent `select` on the proof row) never sees a `verified` proof next to
-- an unwritten handle, or a written handle next to a proof still `processing`.
--
-- Step 1 (claim check). `for update` on a row that must still be `processing` — if it is not (already settled
-- by a racing call, or reclaimed after this worker's own lease expired), there is nothing to apply, and
-- 'lost_claim' says so without touching either profile table.
--
-- Step 2 (the writes, in their own sub-transaction). A trainer's OWN handle can collide with itself in only one
-- safe way: setting it to the SAME value it already holds. Postgres's unique index never treats a row as
-- conflicting with its own prior value, so that case just succeeds here, same as any other UPDATE — no special
-- casing needed, and `private.guard_profile_update` (migration …000300) only flips `handle_is_placeholder` when
-- the value actually changes, so re-confirming an already-claimed handle is idempotent on that column too.
-- What DOES need handling is a collision with a DIFFERENT trainer's row, or a value the database's own format
-- rules reject:
--   - `unique_violation` on `profiles_handle_lower_key`       -> 'handle_taken'
--   - `unique_violation` on `profile_private_friend_code_key` -> 'friend_code_taken'
--   - `check_violation`, or `PT400` (`private.guard_profile_update`'s `handle_reserved` guard, for the rare case
--     OCR misreads a handle into looking like the `Trainer\d{8}` placeholder shape) -> 'invalid_handle'
--   - anything else re-raises: an unmapped unique_violation means a constraint changed under this function
--     without a matching update here, which is a bug to surface loudly, not a proof outcome to paper over.
-- The `begin...exception...end` block is Postgres's implicit savepoint: whichever of the two updates ran before
-- the failing one is rolled back to the top of the block, so a `profiles` write that succeeded right before a
-- `profile_private` collision is undone rather than left half-applied.
--
-- Step 3 (settle). `verified` records just the handle (the friend code is not repeated into `ocr_extracted`; it
-- already lives in `profile_private`, and this worker's own logging rule — never write a handle or friend code
-- to a shared log — extends here too, though `ocr_extracted` is owner-only readable rather than a log). Every
-- other outcome records `{reason, handle?, friendCode?}`: whichever of the two OCR actually read, so the app's
-- manual fallback form (typed in by hand) can prefill them rather than making the trainer retype a value the
-- screenshot already gave correctly.
create function public.apply_profile_proof(p_proof_id uuid, p_handle text, p_friend_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_proof      public.profile_proofs;
  v_outcome    text;
  v_constraint text;
begin
  select * into v_proof from public.profile_proofs
   where id = p_proof_id and ocr_status = 'processing' for update;
  if not found then return 'lost_claim'; end if;

  begin
    update public.profiles set handle = p_handle where id = v_proof.user_id;
    update public.profile_private set friend_code = p_friend_code where user_id = v_proof.user_id;
    v_outcome := 'verified';
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_outcome := case v_constraint
        when 'profiles_handle_lower_key'       then 'handle_taken'
        when 'profile_private_friend_code_key' then 'friend_code_taken'
        else null
      end;
      if v_outcome is null then raise; end if;   -- an unmapped unique violation is a bug, not a proof outcome
    when check_violation or sqlstate 'PT400' then
      v_outcome := 'invalid_handle';
  end;

  if v_outcome = 'verified' then
    update public.profile_proofs
       set ocr_status = 'verified', ocr_extracted = jsonb_build_object('handle', p_handle)
     where id = p_proof_id;
  else
    update public.profile_proofs
       set ocr_status = 'failed',
           ocr_extracted = jsonb_build_object('reason', v_outcome, 'handle', p_handle, 'friendCode', p_friend_code)
     where id = p_proof_id;
  end if;

  return v_outcome;
end $$;

revoke execute on function public.apply_profile_proof(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_profile_proof(uuid, text, text) to service_role;

-- ===== notify_profile_ocr: nudges the deployed Azure Function right after an insert =====
--
-- `vault.decrypted_secrets` (Supabase Vault) holds the two settings that vary between "no Azure Function
-- deployed yet" (local development: both secrets absent) and "there is one, call it": `azure_ocr_url` (the
-- deployed `profile-ocr` HTTP endpoint) and `azure_ocr_key` (its function key, sent as `x-functions-key`, the
-- header Azure's `authLevel: 'function'` checks). Neither lives in a table column or an environment variable
-- readable through PostgREST; Vault is the one place a secret can sit in the database without also being
-- select-able by any role with table access.
--
-- No url configured -> `return new` immediately: this is the expected, ordinary state for local development
-- (see the header comment above), not a misconfiguration to warn about on every single insert.
--
-- The `net.http_post` call itself is wrapped in its own `exception ... when others` block that only raises a
-- WARNING. `pg_net` is already asynchronous (it queues the request and returns immediately; nothing here waits
-- for the Function to respond), so nothing about a working `pg_net` call could block or slow the insert — but a
-- MISCONFIGURED one (an unreachable host, a malformed url from a typo'd vault secret) must not turn into a
-- failed upload either. The row is already inserted by the time this trigger runs; the timer sweep is the
-- backstop either way.
create function private.notify_profile_ocr() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  -- The Vault reads sit inside the guarded block too: a Vault permission or decryption problem is exactly as
  -- much a reason to fail an upload as an unreachable host is, which is to say not at all.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'azure_ocr_url';
    if v_url is null then return new; end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'azure_ocr_key';

    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('proofId', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-functions-key', coalesce(v_key, '')),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_profile_ocr: could not queue the Azure call for proof %: %', new.id, sqlerrm;
  end;

  return new;
end $$;

create trigger profile_proofs_notify_ocr after insert on public.profile_proofs
  for each row execute function private.notify_profile_ocr();
