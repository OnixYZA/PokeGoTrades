import fs from 'node:fs';
import path from 'node:path';

import type { DateOrder } from './date';

/** The two OCR queues this worker drains. Table and bucket names, kept together since they always travel as a pair. */
export const LISTING_PROOF_BUCKET = 'listing-proofs';
export const PROFILE_PROOF_BUCKET = 'profile-proofs';

export interface Config {
  supabaseUrl: string;
  /** Bypasses RLS. Lives only in this Function App's application settings, never in the Expo app's. */
  serviceRoleKey: string;
  batchSize: number;
  dateOrder: DateOrder;
  claimLeaseMs: number;
  imageTimeoutMs: number;
  langPath: string;
  /** How long a sweep (the timer trigger, or one HTTP invocation) may keep starting new proofs. */
  runBudgetMs: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See local.settings.json.example.`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number, got "${raw}".`);
  return value;
}

export function readDateOrder(): DateOrder {
  const raw = (process.env.OCR_DATE_ORDER ?? 'MDY').toUpperCase();
  if (raw !== 'MDY' && raw !== 'DMY') throw new Error(`OCR_DATE_ORDER must be MDY or DMY, got "${raw}".`);
  return raw;
}

const MODEL = 'eng.traineddata.gz';

/**
 * Where tesseract.js finds the English model. It must be a real folder: with no `langPath` tesseract.js quietly
 * downloads the model from a CDN, which a Function cold start should not depend on.
 *
 * In order: `OCR_LANG_PATH` (an operator-provided override, for a deploy layout that ships the model somewhere
 * of its own choosing), then `@tesseract.js-data/eng`, resolved by `require` rather than assumed to sit at some
 * fixed relative path — this code runs unchanged whether `tsx` is executing `src/core/env.ts` straight from
 * source (`npm run try` / `npm test`) or Node is loading the compiled `dist/src/core/env.js`, and `require`'s
 * own node_modules search finds the package the same way from either location without this file needing to know
 * which one it is.
 *
 * That package moved from a dev dependency to a regular one (package.json) specifically so `func azure
 * functionapp publish`'s remote build installs it: Azure's Node build runs a production install, and a dev
 * dependency would simply not be there at runtime. The Lambda build's `scripts/package.sh`, which used to hand-copy
 * just this one file into a `lang/` folder to keep the zip small, has no Azure equivalent — `.funcignore` drops
 * the model variant this worker does not use instead.
 */
export function resolveLangPath(): string {
  const candidates = [process.env.OCR_LANG_PATH, path.dirname(safeResolve(`@tesseract.js-data/eng/4.0.0_best_int/${MODEL}`))].filter(
    (dir): dir is string => Boolean(dir),
  );

  const found = candidates.find((dir) => fs.existsSync(path.join(dir, MODEL)));
  if (!found) throw new Error(`Could not find ${MODEL}. Looked in: ${candidates.join(', ')}. Run npm install or set OCR_LANG_PATH.`);
  return found;
}

function safeResolve(request: string): string {
  try {
    return require.resolve(request);
  } catch {
    return '';
  }
}

export function loadConfig(): Config {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    batchSize: positiveInt('OCR_BATCH_SIZE', 10),
    dateOrder: readDateOrder(),
    claimLeaseMs: positiveInt('OCR_CLAIM_LEASE_SECONDS', 600) * 1000,
    imageTimeoutMs: positiveInt('OCR_IMAGE_TIMEOUT_SECONDS', 60) * 1000,
    langPath: resolveLangPath(),
    // The timer trigger's own budget for one sweep across both queues. An HTTP invocation ignores this and uses
    // its own margin under Azure's 230 s hard limit instead (src/functions/profileOcr.ts).
    runBudgetMs: positiveInt('OCR_RUN_BUDGET_SECONDS', 540) * 1000,
  };
}
