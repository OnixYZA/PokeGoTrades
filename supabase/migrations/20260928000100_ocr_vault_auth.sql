-- Swaps `private.notify_profile_ocr` (migration ...000100_profile_proofs.sql) from an Azure Functions key to our
-- own shared secret. Azure's own function keys (what `authLevel: 'function'` checked, sent as `x-functions-key`)
-- are opaque and awkward to read back out once `workers/azure-ocr` moved off a plain Flex Consumption Function
-- App onto a containerized host (Azure Container Apps) — there is no simple `az functionapp function keys list`
-- equivalent for that host. Instead the worker now generates its own random value (`openssl rand -hex 32`),
-- which lives in exactly two places: the Container App secret `pgt-worker-secret` (env var `PGT_WORKER_SECRET`,
-- read by `workers/azure-ocr/src/core/env.ts`'s `readWorkerSecret`) and, unchanged, this SAME Vault secret NAME,
-- `azure_ocr_key` — only what it holds changed, not what it is called, so this migration does not touch how the
-- key is stored or read out of Vault, only what gets sent with it. `workers/azure-ocr/src/functions/profileOcr.ts`
-- is now registered `authLevel: 'anonymous'` and checks the `x-api-key` header itself
-- (`workers/azure-ocr/src/core/auth.ts`'s constant-time `isAuthorized`) — it is now the ONLY gate on that
-- endpoint, where the Azure host used to reject an unkeyed request before the handler ever ran.
--
-- `create or replace function` keeps the function's signature, `language`, `security definer`, `search_path`,
-- and overall structure identical to the original, and keeps the existing trigger
-- (`profile_proofs_notify_ocr`) pointed at it with its existing privileges untouched — only the body changes.
create or replace function private.notify_profile_ocr() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  -- The Vault reads sit inside the guarded block too: a Vault permission or decryption problem is exactly as
  -- much a reason to fail an upload as an unreachable host is, which is to say not at all.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'azure_ocr_url';
    if v_url is null then return new; end if;   -- unset: the normal local-dev state, not a misconfiguration

    -- Unlike the url, a missing key here IS a misconfiguration: a url without a key would previously have sent
    -- an empty `x-functions-key` header (Azure's own host would still have rejected it), but now that this
    -- endpoint's only gate is the header check inside the handler itself, sending the request with no key (or
    -- coalesced to '') would reach `profileOcr` and simply be rejected there as 401 — a wasted, logged call, not
    -- a silent failure, but there is no reason to make that round trip. Warn instead and skip the call outright.
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'azure_ocr_key';
    if v_key is null then
      raise warning 'notify_profile_ocr: azure_ocr_url is set but azure_ocr_key is missing; not calling for proof %', new.id;
      return new;
    end if;

    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('proofId', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-api-key', v_key),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_profile_ocr: could not queue the Azure call for proof %: %', new.id, sqlerrm;
  end;

  return new;
end $$;
