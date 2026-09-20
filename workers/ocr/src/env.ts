import fs from 'node:fs';
import path from 'node:path';

import type { DateOrder } from './date';

export const PROOF_BUCKET = 'listing-proofs';

export interface Config {
  supabaseUrl: string;
  /** Bypasses RLS. Lives only in this worker's environment, never in the Expo app's. */
  serviceRoleKey: string;
  batchSize: number;
  dateOrder: DateOrder;
  claimLeaseMs: number;
  imageTimeoutMs: number;
  langPath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
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
 * downloads the model from a CDN, which a Lambda cold start should not depend on.
 * In order: OCR_LANG_PATH, the `lang/` folder `npm run package` ships next to `dist/`, then the dev dependency.
 */
export function resolveLangPath(): string {
  const candidates = [
    process.env.OCR_LANG_PATH,
    path.resolve(__dirname, '..', 'lang'),
    path.dirname(safeResolve(`@tesseract.js-data/eng/4.0.0_best_int/${MODEL}`)),
  ].filter((dir): dir is string => Boolean(dir));

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
    supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    batchSize: positiveInt('OCR_BATCH_SIZE', 10),
    dateOrder: readDateOrder(),
    claimLeaseMs: positiveInt('OCR_CLAIM_LEASE_SECONDS', 600) * 1000,
    imageTimeoutMs: positiveInt('OCR_IMAGE_TIMEOUT_SECONDS', 60) * 1000,
    langPath: resolveLangPath(),
  };
}
