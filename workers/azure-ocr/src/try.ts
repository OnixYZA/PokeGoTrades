import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { readDateOrder, resolveLangPath } from './core/env';
import { recognizeText, shutdownOcr } from './core/ocr';
import { interpretProfile, interpretProof, LUCKY_CUTOFF } from './core/parser';
import { decodeProfileQr } from './core/qr';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const LUCKY_LINE = {
  early: `caught before ${LUCKY_CUTOFF}: would set the listing to Guaranteed Lucky`,
  late: `caught on or after ${LUCKY_CUTOFF}: no badge`,
  unclear: `the date reads either side of ${LUCKY_CUTOFF}: no badge (not granted on a guess)`,
} as const;

const PROFILE_FAILURE_LINE = {
  no_handle: 'no trainer name found on its own line',
  no_friend_code: 'no single 12-digit friend code found (missing, or two different candidates)',
} as const;

/**
 * `npm run try -- ./screenshot.png [appraisal|movesets|event_badge|profile]`: OCR one local image and show what
 * the worker would decide for that kind of proof (default `appraisal`). No database or Supabase key needed.
 * This is the way to tune against real Pokémon GO screenshots: the raw text shows what tesseract actually read,
 * so a missed date (or, for `profile`, a missed handle or friend code) can be told apart from a missed anchor
 * word. `profile` also runs the QR scan a real profile proof would get, and prints the handle it found — safe
 * here because this command's output goes only to the developer running it on their own machine, unlike
 * `src/core/log.ts`, which must never carry a handle or a friend code into a shared log stream.
 */
async function main(): Promise<void> {
  const [file, kind = 'appraisal'] = process.argv.slice(2);
  if (!file) throw new Error('Usage: npm run try -- <path to a png, jpg or webp> [appraisal|movesets|event_badge|profile]');

  const image = fs.readFileSync(file);
  const started = Date.now();
  const text = await recognizeText(image, { langPath: resolveLangPath(), timeoutMs: 60_000 });

  console.log('--- OCR text -------------------------------------------------');
  console.log(text.trim() || '(nothing read)');

  if (kind === 'profile') {
    const qrPayload = await decodeProfileQr(image);
    const verdict = interpretProfile(text, qrPayload);
    console.log(`--- profile proof (${Date.now() - started} ms) ----------------------------------`);
    console.log(`QR payload: ${qrPayload ?? '(none decoded)'}`);
    if (verdict.status === 'verified') {
      console.log(`verified   handle=${verdict.handle} friendCode=${verdict.friendCode}`);
    } else {
      console.log(`failed     reason=${verdict.reason}${verdict.handle ? ` handle=${verdict.handle}` : ''}${verdict.friendCode ? ` friendCode=${verdict.friendCode}` : ''}`);
      console.log(`           (${PROFILE_FAILURE_LINE[verdict.reason]})`);
    }
    await shutdownOcr();
    return;
  }

  const verdict = interpretProof(kind, text, { order: readDateOrder() });
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
