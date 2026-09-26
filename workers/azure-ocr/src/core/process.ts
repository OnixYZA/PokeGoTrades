import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { LISTING_PROOF_BUCKET, PROFILE_PROOF_BUCKET, type Config } from './env';
import { log } from './log';
import { recognizeText, UnreadableImageError } from './ocr';
import { interpretProfile, interpretProof } from './parser';
import { decodeProfileQr } from './qr';

export interface Summary {
  /** Rows this run took over from `pending`. */
  claimed: number;
  verified: number;
  failed: number;
  /** Put back to `pending` because of a problem that may pass (storage or database hiccup). */
  released: number;
  /** Rows another worker claimed first, or whose status changed while this run was reading them. */
  lostClaim: number;
  /** Stale `processing` rows from a crashed run, returned to `pending` at the start. */
  recovered: number;
  /** Listings this run set to `lucky = true`, on the strength of an appraisal proof caught before the cutoff.
   * Only the listing queue ever moves this off zero. */
  luckyGranted: number;
  /** Listings that earned the badge but could not be given it because an offer already exists (see `grantLucky`).
   * Only the listing queue ever moves this off zero. */
  luckyBlocked: number;
  /** True when the run stopped early because the time budget was nearly used up. */
  outOfTime: boolean;
}

function emptySummary(): Summary {
  return { claimed: 0, verified: 0, failed: 0, released: 0, lostClaim: 0, recovered: 0, luckyGranted: 0, luckyBlocked: 0, outOfTime: false };
}

/** Adds two summaries together, e.g. combining a webhook-hinted `processOne` with the sweep that follows it. */
export function mergeSummaries(a: Summary, b: Summary): Summary {
  return {
    claimed: a.claimed + b.claimed,
    verified: a.verified + b.verified,
    failed: a.failed + b.failed,
    released: a.released + b.released,
    lostClaim: a.lostClaim + b.lostClaim,
    recovered: a.recovered + b.recovered,
    luckyGranted: a.luckyGranted + b.luckyGranted,
    luckyBlocked: a.luckyBlocked + b.luckyBlocked,
    outOfTime: a.outOfTime || b.outOfTime,
  };
}

export interface RunOptions {
  /** Epoch ms after which no new proof is started (the Function's own remaining time budget). */
  deadline?: number;
}

const UNREADABLE = { reason: 'unreadable' } as const;

const TOO_LARGE = { reason: 'image_too_large' } as const;

/**
 * The most decoded pixels we will hand to tesseract.js. A proof screenshot is a phone screen; anything
 * past this is not one.
 *
 * The bucket's 5 MB upload cap (migrations …000600 and …000100_profile_proofs) bounds bytes, not pixels, and
 * those are very different numbers: a mostly-flat PNG a few dozen kB long can carry 20000x20000 and expand past
 * a gigabyte once decoded. Tesseract decodes before anything in this worker gets a chance to look, and the
 * resulting OOM is a process kill rather than a thrown error — so the catch in `runRow` never runs, the row is
 * never released, and it sits `processing` until the lease expires. `recoverStaleClaims` then puts it back to
 * `pending`, where, being the oldest, it is claimed first on the next run and kills that one too. One upload is
 * enough to stall a queue indefinitely, which is why the check below has to come first and why failing it is
 * terminal, for every queue this worker drains.
 */
const MAX_PIXELS = 4000 * 4000;

/**
 * What a queue's own logic decides, once OCR text (and, for the profile queue, a possible QR payload) is in hand:
 * - `verified` / `failed`: the shared runner (`runRow`) CAS-settles the row itself with `extracted`, exactly as
 *   it does for the terminal checks (missing file, undecodable image, oversized image) that never reach a
 *   queue's `handle` at all.
 * - `settled`: the queue's `handle` already settled the row through its own path (the profile queue calls the
 *   `apply_profile_proof` RPC, which settles atomically with the profile writes it makes). The runner must not
 *   settle it again; it only counts `outcome` into the summary.
 */
export type HandleResult =
  | { status: 'verified' | 'failed'; extracted: Record<string, unknown>; log?: Record<string, unknown> }
  | { status: 'settled'; outcome: 'verified' | 'failed' | 'lostClaim'; log?: Record<string, unknown> };

export interface HandleContext<Row> {
  supabase: SupabaseClient;
  config: Config;
  row: Row;
  /** The tesseract.js transcription of the downloaded image. */
  text: string;
  /** The same bytes `text` was read from, for a queue that also wants to look at the pixels (the profile queue's QR scan). */
  image: Buffer;
  /** Mutable in place for queue-specific counters (`luckyGranted` / `luckyBlocked`) that only the listing queue uses. */
  summary: Summary;
}

/** A row shape every queue must have: what `runRow` needs to claim, download, and settle it, whatever else it carries. */
export interface QueueRow {
  id: string;
  storage_path: string;
}

export interface QueueSpec<Row extends QueueRow> {
  /** The table this queue lives in (`listing_proofs`, `profile_proofs`). */
  table: string;
  /** The Storage bucket `storage_path` is relative to. */
  bucket: string;
  /** Passed to `.select()` when listing or claiming rows; must be enough for `handle` and for logging. */
  select: string;
  /** Extra fields to fold into every log line for a row in this queue (never OCR text, a handle, or a friend code). */
  logFields(row: Row): Record<string, unknown>;
  /** Decides the outcome once OCR (and, if relevant, a QR scan) has run. See `HandleResult`. */
  handle(ctx: HandleContext<Row>): Promise<HandleResult>;
}

interface ListingProofRow extends QueueRow {
  listing_id: string;
  kind: string;
}

interface ProfileProofRow extends QueueRow {
  user_id: string;
}

/**
 * One pass over a queue: recover stale claims, then take up to `config.batchSize` pending rows, oldest first,
 * and read each one.
 *
 * Every row moves pending -> processing -> verified | failed, and each move is a compare-and-swap on the
 * current status (`update ... where ocr_status = <expected>`), so two overlapping runs (the timer trigger firing
 * again before the last one finished, an HTTP-triggered sweep alongside it, a retry) never read the same row
 * twice, and a result never overwrites a status someone else set meanwhile, such as a moderator's `rejected`.
 * That is what `for update skip locked` gives, without a database function: PostgREST cannot express it.
 */
export async function processQueue<Row extends QueueRow>(
  supabase: SupabaseClient,
  config: Config,
  spec: QueueSpec<Row>,
  options: RunOptions = {},
): Promise<Summary> {
  const summary = emptySummary();
  summary.recovered = await recoverStaleClaims(supabase, config, spec);

  const { data: candidates, error } = await supabase
    .from(spec.table)
    .select(spec.select)
    .eq('ocr_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(config.batchSize);
  if (error) throw new Error(`Could not list pending rows in ${spec.table}: ${error.message}`);

  // Stop starting new work while there is still time for one more image plus its bookkeeping.
  const needed = config.imageTimeoutMs + 5_000;

  // `spec.select` is a plain `string`, not a literal type, so supabase-js cannot infer a row shape from it the
  // way it can from an inline literal — it falls back to a generic error-shaped type instead. The cast is exactly
  // as safe (or as unsafe) as the original Lambda worker's cast from an inline `SELECT` constant: `spec.select`
  // is written once per queue, right next to the `Row` interface it must match (see `listingProofsQueue` /
  // `profileProofsQueue` below).
  for (const candidate of (candidates ?? []) as unknown as Row[]) {
    if (options.deadline !== undefined && options.deadline - Date.now() < needed) {
      summary.outOfTime = true;
      break;
    }

    const row = await claim(supabase, spec, candidate.id);
    if (!row) {
      summary.lostClaim++;
      continue;
    }
    summary.claimed++;
    await runRow(supabase, config, spec, row, summary);
  }

  return summary;
}

/**
 * Claims and processes exactly one `pending` row by id — the webhook-hint path (`src/functions/profileOcr.ts`
 * passes the `proofId` the insert trigger points at). If the row is not `pending` any more — another sweep
 * already took it, or it settled between the trigger firing and the Function running — this just counts a lost
 * claim rather than treating it as an error: the row is either already done or someone else's problem now.
 */
export async function processOne<Row extends QueueRow>(supabase: SupabaseClient, config: Config, spec: QueueSpec<Row>, id: string): Promise<Summary> {
  const summary = emptySummary();
  const row = await claim(supabase, spec, id);
  if (!row) {
    summary.lostClaim++;
    return summary;
  }
  summary.claimed++;
  await runRow(supabase, config, spec, row, summary);
  return summary;
}

/**
 * A run that dies (crash, a killed Function) leaves its row in `processing`. Give those back after the lease.
 * The lease itself is not configurable per queue: both proof kinds go through the same tesseract worker, so the
 * same `OCR_CLAIM_LEASE_SECONDS` bounds a crashed claim on either one.
 */
async function recoverStaleClaims<Row extends QueueRow>(supabase: SupabaseClient, config: Config, spec: QueueSpec<Row>): Promise<number> {
  const staleBefore = new Date(Date.now() - config.claimLeaseMs).toISOString();
  const { data, error } = await supabase
    .from(spec.table)
    .update({ ocr_status: 'pending', ocr_extracted: null })
    .eq('ocr_status', 'processing')
    .or(`ocr_extracted.is.null,ocr_extracted->>claimedAt.lt.${staleBefore}`)
    .select('id');
  if (error) throw new Error(`Could not recover stale claims in ${spec.table}: ${error.message}`);
  for (const row of data ?? []) log('warn', 'released a stale claim', { table: spec.table, id: row.id });
  return data?.length ?? 0;
}

/** pending -> processing, stamping when, so a crashed run can be told from one still working. */
async function claim<Row extends QueueRow>(supabase: SupabaseClient, spec: QueueSpec<Row>, id: string): Promise<Row | null> {
  const { data, error } = await supabase
    .from(spec.table)
    .update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date().toISOString() } })
    .eq('id', id)
    .eq('ocr_status', 'pending')
    .select(spec.select);
  if (error) throw new Error(`Could not claim ${spec.table} row ${id}: ${error.message}`);
  return (data?.[0] as unknown as Row | undefined) ?? null;
}

async function runRow<Row extends QueueRow>(supabase: SupabaseClient, config: Config, spec: QueueSpec<Row>, row: Row, summary: Summary): Promise<void> {
  const started = Date.now();
  const fields = { table: spec.table, id: row.id, ...spec.logFields(row) };

  /** Saves a `verified` / `failed` outcome and counts it, unless the row was changed by someone else meanwhile. */
  const finish = async (status: 'verified' | 'failed', extracted: Record<string, unknown>, detail: Record<string, unknown>) => {
    if (await settle(supabase, spec, row.id, status, extracted)) {
      summary[status]++;
      log('info', status, { ...fields, ...detail, ms: Date.now() - started });
    } else {
      summary.lostClaim++;
      log('warn', 'result discarded: the row changed while it was being read', fields);
    }
  };

  try {
    const image = await download(supabase, spec.bucket, row.storage_path);
    if (!image) return await finish('failed', UNREADABLE, { cause: 'file_missing' });

    // Header-only read: sharp parses the dimensions without decoding the pixels, so an oversized image is
    // rejected on the strength of its header and never reaches a decoder. Both outcomes here are terminal
    // — releasing for retry would rebuild the crash loop this check exists to break.
    const size = await measure(image);
    if (!size) return await finish('failed', UNREADABLE, { cause: 'decode_error' });
    const pixels = size.width * size.height;
    if (pixels > MAX_PIXELS) {
      return await finish('failed', TOO_LARGE, { cause: 'image_too_large', ...size, pixels, maxPixels: MAX_PIXELS });
    }

    const text = await recognizeText(image, { langPath: config.langPath, timeoutMs: config.imageTimeoutMs });
    const result = await spec.handle({ supabase, config, row, text, image, summary });

    if (result.status === 'settled') {
      summary[result.outcome]++;
      log('info', result.outcome === 'lostClaim' ? 'lost claim' : result.outcome, { ...fields, ...(result.log ?? {}), ms: Date.now() - started });
      return;
    }
    await finish(result.status, result.extracted, result.log ?? {});
  } catch (error) {
    if (error instanceof UnreadableImageError) {
      return await finish('failed', UNREADABLE, { cause: 'decode_error', detail: error.message });
    }
    // Storage or database trouble, or the OCR worker itself could not start. None of that says the row is
    // bad, so put it back for the next run rather than failing it for good.
    log('error', 'could not process, released for retry', { ...fields, error: error instanceof Error ? error.message : String(error) });
    await release(supabase, spec, row.id).catch(() => undefined); // if this fails too, the lease brings it back
    summary.released++;
  }
}

type LuckyOutcome = 'granted' | 'unchanged' | 'blocked';

/**
 * Sets `listings.lucky = true`, which is what puts the Guaranteed Lucky badge on the feed card.
 * - `granted`: the listing was not Lucky and now is.
 * - `unchanged`: it already was (or the listing is gone), so nothing was written.
 * - `blocked`: someone has already made an offer on it. `guard_listing_update` refuses any change to a listing's
 *   trade details from then on (the bait-and-switch rule) and has no exception for the service role. That is a
 *   final answer, not a fault, so it does not fail the proof or retry it every minute: the proof still verifies,
 *   the listing stays as it is, and the `luckyBlocked` count and log line say it happened.
 * Any other error is thrown, and the proof is retried.
 */
async function grantLucky(supabase: SupabaseClient, listingId: string): Promise<LuckyOutcome> {
  const { data, error } = await supabase.from('listings').update({ lucky: true }).eq('id', listingId).eq('lucky', false).select('id');
  if (error) {
    if (error.message === 'listing_has_offers') return 'blocked';
    throw new Error(`Could not update listing ${listingId}: ${error.message}`);
  }
  return (data?.length ?? 0) > 0 ? 'granted' : 'unchanged';
}

/** The image bytes, or `null` when the object does not exist (a permanent failure). Any other error throws. */
async function download(supabase: SupabaseClient, bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    const { status, statusCode } = error as unknown as { status?: number; statusCode?: string | number };
    // Storage reports a missing object as HTTP 400 with statusCode "404".
    if (String(statusCode) === '404' || status === 404) return null;
    throw new Error(`download failed: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * The image's pixel dimensions from its header, or `null` when the bytes are not a readable image at all.
 * `metadata()` does not decode, so this stays cheap and bounded whatever the file claims to be — which is
 * the whole point of asking before handing the buffer to tesseract.js.
 */
async function measure(image: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    // `limitInputPixels: false` turns off sharp's own ~268 MP ceiling. Nothing is decoded here, so it
    // allocates nothing; it just stops sharp throwing on the very images this check exists to catch,
    // which would otherwise report them as `decode_error` and hide a bomb among the corrupt uploads.
    // MAX_PIXELS above stays the single place the limit is decided.
    const { width, height } = await sharp(image, { limitInputPixels: false }).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null; // not an image, or a truncated/corrupt one: a permanent failure, not a retry.
  }
}

/** processing -> a terminal status. False when the row is no longer `processing` (someone else moved it). */
async function settle<Row extends QueueRow>(
  supabase: SupabaseClient,
  spec: QueueSpec<Row>,
  id: string,
  status: 'verified' | 'failed',
  extracted: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(spec.table)
    .update({ ocr_status: status, ocr_extracted: extracted })
    .eq('id', id)
    .eq('ocr_status', 'processing')
    .select('id');
  if (error) throw new Error(`Could not save the result for ${spec.table} row ${id}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function release<Row extends QueueRow>(supabase: SupabaseClient, spec: QueueSpec<Row>, id: string): Promise<void> {
  const { error } = await supabase
    .from(spec.table)
    .update({ ocr_status: 'pending', ocr_extracted: null })
    .eq('id', id)
    .eq('ocr_status', 'processing');
  if (error) throw new Error(error.message);
}

// ================================================================================================================
// The two queues. Each `QueueSpec` is the one place that says what a row looks like, where its images live, and
// what "done" means for it; `processQueue` / `processOne` above never know the difference.
// ================================================================================================================

/**
 * `listing_proofs`: unchanged from the Lambda worker's `processPending`, now expressed as a `QueueSpec`. The
 * Guaranteed Lucky update happens inside `handle`, BEFORE the row is reported `verified` to `runRow` — on
 * purpose: if the run dies in between, the row is still `processing`, so it is released and redone and the
 * (idempotent) badge update simply repeats. The other order could leave a verified proof whose listing never
 * got its badge, and nothing would retry it.
 */
export const listingProofsQueue: QueueSpec<ListingProofRow> = {
  table: 'listing_proofs',
  bucket: LISTING_PROOF_BUCKET,
  select: 'id, listing_id, kind, storage_path',
  logFields: (row) => ({ listingId: row.listing_id, kind: row.kind }),
  async handle({ supabase, config, row, text, summary }) {
    const verdict = interpretProof(row.kind, text, { order: config.dateOrder });
    if (verdict.status === 'failed') return { status: 'failed', extracted: verdict.extracted, log: { cause: verdict.cause } };

    const lucky = verdict.lucky === 'early' ? await grantLucky(supabase, row.listing_id) : undefined;
    if (lucky === 'granted') summary.luckyGranted++;
    if (lucky === 'blocked') summary.luckyBlocked++;

    return { status: 'verified', extracted: verdict.extracted, log: { ...verdict.extracted, catchVsCutoff: verdict.lucky, lucky } };
  },
};

/**
 * `profile_proofs`: the "My Trainer Code" screen. Unlike the listing queue, a verified read does not settle the
 * row itself — it calls `public.apply_profile_proof`, which writes `profiles.handle` and
 * `profile_private.friend_code` and settles the proof row in the same database transaction (migration
 * …000100_profile_proofs.sql). That RPC, not this worker, is what makes "write the two profile columns" and
 * "mark the proof done" atomic, and it is also what turns a name/code collision into a `failed` proof with a
 * reason the app's manual fallback form can read, rather than a thrown error.
 *
 * `apply_profile_proof` returns which of those things happened; `lostClaim` covers the one case where the RPC's
 * own `for update` found the row was no longer `processing` (settled or reclaimed between this worker's claim
 * and the RPC call) — the same meaning `lostClaim` has everywhere else in this file.
 */
export const profileProofsQueue: QueueSpec<ProfileProofRow> = {
  table: 'profile_proofs',
  bucket: PROFILE_PROOF_BUCKET,
  select: 'id, user_id, storage_path',
  logFields: (row) => ({ userId: row.user_id }), // never the handle or friend code themselves — see src/core/log.ts
  async handle({ supabase, row, text, image }) {
    const qrPayload = await decodeProfileQr(image);
    const verdict = interpretProfile(text, qrPayload);

    if (verdict.status === 'failed') {
      const extracted: Record<string, unknown> = { reason: verdict.reason };
      if (verdict.handle) extracted.handle = verdict.handle;
      if (verdict.friendCode) extracted.friendCode = verdict.friendCode;
      return { status: 'failed', extracted, log: { cause: verdict.reason } };
    }

    const { data, error } = await supabase.rpc('apply_profile_proof', {
      p_proof_id: row.id,
      p_handle: verdict.handle,
      p_friend_code: verdict.friendCode,
    });
    if (error) throw new Error(`apply_profile_proof failed for ${row.id}: ${error.message}`);

    const outcome = data as string;
    return { status: 'settled', outcome: outcome === 'verified' ? 'verified' : outcome === 'lost_claim' ? 'lostClaim' : 'failed', log: { outcome } };
  },
};
