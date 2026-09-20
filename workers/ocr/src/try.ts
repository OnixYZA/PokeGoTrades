import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { parseCatchDate } from './date';
import { readDateOrder, resolveLangPath } from './env';
import { recognizeText, shutdownOcr } from './ocr';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

/**
 * `npm run try -- ./screenshot.png`: OCR one local image and show what the worker would make of it. No
 * database or Supabase key needed. This is the way to tune against real Pokémon GO screenshots: the raw text
 * shows what tesseract actually read, so a missed date can be told apart from a missed "Caught".
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run try -- <path to a png, jpg or webp>');

  const started = Date.now();
  const text = await recognizeText(fs.readFileSync(file), { langPath: resolveLangPath(), timeoutMs: 60_000 });
  const found = parseCatchDate(text, { order: readDateOrder() });

  console.log('--- OCR text -------------------------------------------------');
  console.log(text.trim() || '(nothing read)');
  console.log('--- result (' + (Date.now() - started) + ' ms) --------------------------------------');
  console.log(found ? `verified   ${JSON.stringify(found.ambiguous ? { caughtAt: found.caughtAt, ambiguous: true } : { caughtAt: found.caughtAt })}` : 'failed     {"reason":"unreadable"}');
  await shutdownOcr();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
