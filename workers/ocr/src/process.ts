import type { SupabaseClient } from '@supabase/supabase-js';

import { PROOF_BUCKET, type Config } from './env';
import { log } from './log';
import { recognizeText, UnreadableImageError } from './ocr';
import { interpretProof } from './parser';

interface ProofRow {
  id: string;
  listing_id: string;
  kind: string;
  storage_path: string;
}

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
  /** Listings this run set to `lucky = true`, on the strength of an appraisal proof caught before the cutoff. */
  luckyGranted: number;
  /** Listings that earned the badge but could not be given it because an offer already exists (see `grantLucky`). */
  luckyBlocked: number;
  /** True when the run stopped early because the time budget was nearly used up. */
  outOfTime: boolean;
}

export interface RunOptions {
  /** Epoch ms after which no new proof is started (Lambda: now + remaining time). */
  deadline?: number;
}

const SELECT = 'id, listing_id, kind, storage_path';

const UNREADABLE = { reason: 'unreadable' } as const;

/**
 * One pass over the queue: recover stale claims, then take up to `config.batchSize` pending proofs,
 * oldest first, and read each one.
 *
 * Every row moves pending -> processing -> verified | failed, and each move is a compare-and-swap on the
 * current status (`update ... where ocr_status = <expected>`), so two overlapping runs (Lambda schedules
 * that overlap, a retry, a local worker next to the deployed one) never read the same proof twice, and a
 * result never overwrites a status someone else set meanwhile, such as a moderator's `rejected`.
 * That is what `for update skip locked` gives, without a database function: PostgREST cannot express it.
 */
export async function processPending(supabase: SupabaseClient, config: Config, options: RunOptions = {}): Promise<Summary> {
  const summary: Summary = {
    claimed: 0,
    verified: 0,
    failed: 0,
    released: 0,
    lostClaim: 0,
    recovered: 0,
    luckyGranted: 0,
    luckyBlocked: 0,
    outOfTime: false,
  };
  summary.recovered = await recoverStaleClaims(supabase, config);

  const { data: candidates, error } = await supabase
    .from('listing_proofs')
    .select(SELECT)
    .eq('ocr_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(config.batchSize);
  if (error) throw new Error(`Could not list pending proofs: ${error.message}`);

  // Stop starting new work while there is still time for one more image plus its bookkeeping.
  const needed = config.imageTimeoutMs + 5_000;

  for (const candidate of (candidates ?? []) as ProofRow[]) {
    if (options.deadline !== undefined && options.deadline - Date.now() < needed) {
      summary.outOfTime = true;
      break;
    }

    const row = await claim(supabase, candidate.id);
    if (!row) {
      summary.lostClaim++;
      continue;
    }
    summary.claimed++;
    await handle(supabase, config, row, summary);
  }

  return summary;
}

/** A run that dies (Lambda timeout, crash) leaves its row in `processing`. Give those back after the lease. */
async function recoverStaleClaims(supabase: SupabaseClient, config: Config): Promise<number> {
  const staleBefore = new Date(Date.now() - config.claimLeaseMs).toISOString();
  const { data, error } = await supabase
    .from('listing_proofs')
    .update({ ocr_status: 'pending', ocr_extracted: null })
    .eq('ocr_status', 'processing')
    .or(`ocr_extracted.is.null,ocr_extracted->>claimedAt.lt.${staleBefore}`)
    .select('id');
  if (error) throw new Error(`Could not recover stale claims: ${error.message}`);
  for (const row of data ?? []) log('warn', 'released a stale claim', { id: row.id });
  return data?.length ?? 0;
}

/** pending -> processing, stamping when, so a crashed run can be told from one still working. */
async function claim(supabase: SupabaseClient, id: string): Promise<ProofRow | null> {
  const { data, error } = await supabase
    .from('listing_proofs')
    .update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date().toISOString() } })
    .eq('id', id)
    .eq('ocr_status', 'pending')
    .select(SELECT);
  if (error) throw new Error(`Could not claim proof ${id}: ${error.message}`);
  return (data?.[0] as ProofRow | undefined) ?? null;
}

async function handle(supabase: SupabaseClient, config: Config, row: ProofRow, summary: Summary): Promise<void> {
  const started = Date.now();
  const fields = { id: row.id, listingId: row.listing_id, kind: row.kind };

  /** Saves the outcome and counts it, unless the row was changed by someone else in the meantime. */
  const finish = async (status: 'verified' | 'failed', extracted: Record<string, unknown>, detail: Record<string, unknown>) => {
    if (await settle(supabase, row.id, status, extracted)) {
      summary[status]++;
      log('info', status, { ...fields, ...detail, ms: Date.now() - started });
    } else {
      summary.lostClaim++;
      log('warn', 'result discarded: the proof changed while it was being read', fields);
    }
  };

  try {
    const image = await download(supabase, row.storage_path);
    if (!image) return await finish('failed', UNREADABLE, { cause: 'file_missing' });

    const text = await recognizeText(image, { langPath: config.langPath, timeoutMs: config.imageTimeoutMs });
    const verdict = interpretProof(row.kind, text, { order: config.dateOrder });
    if (verdict.status === 'failed') return await finish('failed', verdict.extracted, { cause: verdict.cause });

    // An appraisal that puts the catch before the cutoff earns its listing the Guaranteed Lucky badge. This
    // happens BEFORE the proof is saved as verified, on purpose: if the run dies in between, the proof is still
    // `processing`, so it is released and redone and the badge update (which is idempotent) simply repeats.
    // The other order could leave a verified proof whose listing never got its badge, and nothing would retry it.
    const lucky = verdict.lucky === 'early' ? await grantLucky(supabase, row.listing_id) : undefined;
    if (lucky === 'granted') summary.luckyGranted++;
    if (lucky === 'blocked') summary.luckyBlocked++;

    await finish('verified', verdict.extracted, { ...verdict.extracted, catchVsCutoff: verdict.lucky, lucky });
  } catch (error) {
    if (error instanceof UnreadableImageError) {
      return await finish('failed', UNREADABLE, { cause: 'decode_error', detail: error.message });
    }
    // Storage or database trouble, or the OCR worker itself could not start. None of that says the proof is
    // bad, so put it back for the next run rather than failing it for good.
    log('error', 'could not process, released for retry', { ...fields, error: error instanceof Error ? error.message : String(error) });
    await release(supabase, row.id).catch(() => undefined); // if this fails too, the lease brings it back
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
async function download(supabase: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).download(path);
  if (error) {
    const { status, statusCode } = error as unknown as { status?: number; statusCode?: string | number };
    // Storage reports a missing object as HTTP 400 with statusCode "404".
    if (String(statusCode) === '404' || status === 404) return null;
    throw new Error(`download failed: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/** processing -> a terminal status. False when the row is no longer `processing` (someone else moved it). */
async function settle(
  supabase: SupabaseClient,
  id: string,
  status: 'verified' | 'failed',
  extracted: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('listing_proofs')
    .update({ ocr_status: status, ocr_extracted: extracted })
    .eq('id', id)
    .eq('ocr_status', 'processing')
    .select('id');
  if (error) throw new Error(`Could not save the result for proof ${id}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function release(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('listing_proofs')
    .update({ ocr_status: 'pending', ocr_extracted: null })
    .eq('id', id)
    .eq('ocr_status', 'processing');
  if (error) throw new Error(error.message);
}
