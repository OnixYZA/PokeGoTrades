import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { readDateOrder, resolveLangPath } from './env';
import { recognizeText, shutdownOcr } from './ocr';
import { interpretProof, LUCKY_CUTOFF } from './parser';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const LUCKY_LINE = {
  early: `caught before ${LUCKY_CUTOFF}: would set the listing to Guaranteed Lucky`,
  late: `caught on or after ${LUCKY_CUTOFF}: no badge`,
  unclear: `the date reads either side of ${LUCKY_CUTOFF}: no badge (not granted on a guess)`,
} as const;

/**
 * `npm run try -- ./screenshot.png [appraisal|movesets|event_badge]`: OCR one local image and show what the
 * worker would decide for that kind of proof (default `appraisal`). No database or Supabase key needed. This is
 * the way to tune against real Pokémon GO screenshots: the raw text shows what tesseract actually read, so a
 * missed date can be told apart from a missed "Caught".
 */
async function main(): Promise<void> {
  const [file, kind = 'appraisal'] = process.argv.slice(2);
  if (!file) throw new Error('Usage: npm run try -- <path to a png, jpg or webp> [appraisal|movesets|event_badge]');

  const started = Date.now();
  const text = await recognizeText(fs.readFileSync(file), { langPath: resolveLangPath(), timeoutMs: 60_000 });
  const verdict = interpretProof(kind, text, { order: readDateOrder() });

  console.log('--- OCR text -------------------------------------------------');
  console.log(text.trim() || '(nothing read)');
  console.log(`--- ${kind} proof (${Date.now() - started} ms) ----------------------------------`);
  console.log(`${verdict.status.padEnd(10)} ${JSON.stringify(verdict.extracted)}`);
  if (verdict.status === 'failed') console.log(`           (${verdict.cause === 'no_date' ? 'no catch date after "Caught"' : 'no readable text'})`);
  else if (verdict.lucky) console.log(`           ${LUCKY_LINE[verdict.lucky]}`);
  await shutdownOcr();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
