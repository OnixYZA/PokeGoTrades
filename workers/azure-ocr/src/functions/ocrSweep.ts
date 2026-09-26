import { app, type InvocationContext, type Timer, type TimerHandler } from '@azure/functions';

import { loadConfig, type Config } from '../core/env';
import { log } from '../core/log';
import { listingProofsQueue, processQueue, profileProofsQueue, type QueueRow, type QueueSpec, type Summary } from '../core/process';
import { createServiceClient } from '../core/supabase';

/**
 * The timer trigger that replaces the Lambda worker's EventBridge `rate(1 minute)` schedule. It is also, right
 * now, the ONLY reliable way either queue gets drained end to end against the hosted project: the hosted
 * database's `pg_net` cannot reach `http://localhost:7071` (see the profile queue's insert trigger,
 * `private.notify_profile_ocr`), so a proof uploaded while developing locally sits `pending` until either this
 * sweep runs or someone deploys the Function and points `azure_ocr_url` at it. `npm start` runs this on startup
 * by default (`OCR_SWEEP_ON_STARTUP`, local.settings.json.example) for exactly that reason — including whatever
 * is already `pending` in the hosted `listing_proofs` table, unrelated to this migration.
 *
 * Both queues share one time budget (`OCR_RUN_BUDGET_SECONDS`, default 540 s) because they share the one
 * tesseract.js worker (`src/core/ocr.ts`): whatever time the profile sweep spends recognizing text is time the
 * listing sweep does not get, and the deadline reflects that rather than giving each queue its own full budget.
 * The profile queue goes first — new-account onboarding is a one-shot, blocking wait for the trainer, where
 * `listing_proofs` failing to keep up just delays a badge.
 */
const handler: TimerHandler = async (_timer: Timer, context: InvocationContext): Promise<void> => {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return;
  }
  const supabase = createServiceClient(config);
  const deadline = Date.now() + config.runBudgetMs;

  // Each queue fails on its own. A queue-level error (its table not migrated yet on this project, a PostgREST
  // outage scoped to one table, a bad grant) must not stop the other queue from draining — before this, a
  // missing `profile_proofs` table would have silently halted every listing proof as well.
  const sweep = async (name: string, spec: QueueSpec<QueueRow>): Promise<Summary | { error: string }> => {
    try {
      return await processQueue(supabase, config, spec, { deadline });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`${name} sweep failed: ${message}`);
      return { error: message };
    }
  };

  const profile = await sweep('profile_proofs', profileProofsQueue);
  const listing = await sweep('listing_proofs', listingProofsQueue);
  log('info', 'run finished', { profile, listing });
};

app.timer('ocrSweep', {
  schedule: '0 */1 * * * *',
  runOnStartup: process.env.OCR_SWEEP_ON_STARTUP === 'true',
  handler,
});
