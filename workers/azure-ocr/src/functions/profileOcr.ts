import { app, type HttpHandler, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

import { isAuthorized } from '../core/auth';
import { loadConfig, readWorkerSecret } from '../core/env';
import { log } from '../core/log';
import { mergeSummaries, processOne, processQueue, profileProofsQueue } from '../core/process';
import { createServiceClient } from '../core/supabase';

/**
 * Azure gives an HTTP-triggered Function up to 230 s to respond (Flex/Elastic Premium hard cap); this leaves a
 * margin under that for the response itself to be written and for one in-flight image to finish rather than
 * being cut off mid-recognition.
 */
const HTTP_BUDGET_MS = 200_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `private.notify_profile_ocr` (migration …000100_profile_proofs.sql) calls this over HTTP right after a
 * `profile_proofs` row is inserted, with `{"proofId": "<uuid>"}` as the body — a nudge, not a command: pg_net
 * is fire-and-forget, so the insert never waits for this Function, and this Function never assumes the row it
 * was pointed at is still there or still `pending` by the time it runs.
 *
 * The body is parsed leniently on purpose. It is only a hint for which row to look at first: a missing,
 * malformed, or non-uuid `proofId` just means "no hint", not a bad request, because a manual test
 * (`curl -X POST .../api/profile-ocr -H "x-api-key: <PGT_WORKER_SECRET>" -d '{}'`) and a delayed or duplicated
 * pg_net call are both legitimate ways to reach this Function with nothing usable in the body.
 *
 * After the hinted row (if any) is handled, this sweeps the rest of the `profile_proofs` queue for the time
 * that remains — so if the vault-configured `azure_ocr_url` ever falls behind (a burst of uploads, a cold
 * start), the very next webhook call catches up the backlog rather than leaving it to the next timer tick.
 *
 * Registered `authLevel: 'anonymous'`, not `'function'`: this used to lean on an Azure-issued function key
 * (opaque, awkward to read back out for a containerized Functions host) checked by the platform before the
 * handler ever ran. Now the caller — `private.notify_profile_ocr`, migration `20260928000100_ocr_vault_auth.sql`
 * — sends our own shared secret as `x-api-key`, and the handler is the only thing that checks it (below), so
 * there is no host-level gate left to rely on.
 */
const handler: HttpHandler = async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
  // The only gate this endpoint has now (see the header comment): checked before anything else runs, so an
  // unauthorized request never reaches the body parser, `loadConfig()`, or Supabase.
  let workerSecret: string;
  try {
    workerSecret = readWorkerSecret();
  } catch (error) {
    // Fail closed: an unset or too-short secret must never fall back to "no check". No secret material in the
    // log — only that the server-side configuration itself is broken.
    context.error(error instanceof Error ? error.message : String(error));
    return { status: 500 };
  }
  if (!isAuthorized(request.headers.get('x-api-key'), workerSecret)) {
    // No body detail, and never log the header value: a mismatch is either a stale key or a probe, and neither
    // learns anything from a more specific response than a bare 401.
    return { status: 401 };
  }

  try {
    const config = loadConfig();
    const supabase = createServiceClient(config);
    const hint = await readProofIdHint(request);

    const hinted = hint ? await processOne(supabase, config, profileProofsQueue, hint) : undefined;
    const swept = await processQueue(supabase, config, profileProofsQueue, { deadline: Date.now() + HTTP_BUDGET_MS });
    const summary = hinted ? mergeSummaries(hinted, swept) : swept;

    log('info', 'run finished', { ...summary });
    return { status: 200, jsonBody: summary };
  } catch (error) {
    // No detail in the response: this is a service boundary the client (the database trigger, or a manual
    // curl) does not control and cannot act on. The message still goes to the Function's own log stream.
    context.error(error instanceof Error ? error.message : String(error));
    return { status: 500 };
  }
};

async function readProofIdHint(request: HttpRequest): Promise<string | undefined> {
  try {
    const body = (await request.json()) as { proofId?: unknown } | null;
    const id = body?.proofId;
    return typeof id === 'string' && UUID_RE.test(id) ? id : undefined;
  } catch {
    return undefined; // no body, or not JSON: the hint is optional
  }
}

app.http('profileOcr', { methods: ['POST'], authLevel: 'anonymous', route: 'profile-ocr', handler });
