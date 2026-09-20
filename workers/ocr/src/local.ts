import path from 'node:path';

import dotenv from 'dotenv';

import { loadConfig } from './env';
import { log } from './log';
import { shutdownOcr } from './ocr';
import { processPending } from './process';
import { createServiceClient } from './supabase';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

/**
 * Local runner. `npm run once` works through the queue one time and exits; `npm run dev` keeps polling
 * (every 5 s, or `--interval <seconds>`) until Ctrl-C. It runs exactly the code the Lambda handler runs.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const at = args.indexOf('--interval');
  const intervalMs = (at >= 0 ? Number(args[at + 1]) : 5) * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('--interval needs a number of seconds.');

  const config = loadConfig();
  const supabase = createServiceClient(config);

  let stopping = false;
  let wake: (() => void) | undefined; // cuts the wait between polls short
  process.on('SIGINT', () => {
    if (stopping) process.exit(130); // a second Ctrl-C does not wait for the current proof
    stopping = true;
    log('info', 'stopping after the current proof');
    wake?.();
  });

  do {
    try {
      const summary = await processPending(supabase, config);
      const busy = summary.claimed + summary.recovered + summary.lostClaim > 0 || summary.outOfTime;
      if (once || busy) log('info', 'run finished', { ...summary }); // an idle poll every few seconds would just be noise
    } catch (error) {
      log('error', 'run failed', { error: error instanceof Error ? error.message : String(error) });
      if (once) process.exitCode = 1;
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wake = () => {
        clearTimeout(timer); // otherwise the pending timer keeps the process alive after Ctrl-C
        resolve();
      };
    });
  } while (!stopping);

  await shutdownOcr();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
