/**
 * Mirrors PokeMiners/pogo_assets' `Images/Pokemon - 256x256/Addressable Assets` icons into this
 * project's own `sprites` Supabase Storage bucket (supabase/migrations/20260927000400_sprites_bucket.sql),
 * so the app never depends on a third-party GitHub mirror (or PokéAPI — R5) at runtime.
 *
 * RELATIVE IMPORTS ONLY, and no `react-native` / `expo-*` / `lib/supabase.ts` (R1): this runs under
 * `tsx`, a plain Node process with no Metro/babel `@/` alias resolution and no RN runtime.
 *
 * Usage (see package.json's "sprites:mirror" script):
 *   npm run sprites:mirror -- --range=1-151             # dry run: prints the plan, touches nothing
 *   npm run sprites:mirror -- --range=1-151 --yes        # for real: downloads + uploads
 *   npm run sprites:mirror -- --all --yes                # every species, every form AND costume
 *   npm run sprites:mirror -- --forms --range=1-3 --yes  # base + form variants only, no costumes
 *
 * Flags:
 *   --yes             Actually download + upload. Without it, this only ever prints a plan.
 *   --forms           Include form variants (regional/mega/gigantamax/size, e.g. `fALOLA`).
 *   --costumes        Include costume variants (event outfits, e.g. `cJAN_2020_NOEVOLVE`).
 *   --all             Shorthand for --forms --costumes together (and their combination).
 *   --range=A-B       Only pokemonId in [A, B] (inclusive). Default: every id in the Pokédex.
 *   --force           Overwrite an object that's already in the bucket (default: skip it, without
 *                     downloading it again).
 *   --concurrency=N   Parallel downloads/uploads when --yes (default 4).
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL comes from .env.local (the app's own file). SUPABASE_SECRET_KEY and the
 * optional GITHUB_TOKEN belong in .env.scripts.local, which is gitignored (`.env*.local`) and never
 * loaded by Expo, so the service-role secret never sits in the app's env file.
 *
 * R2: this script must never be invoked with --yes by an agent, only by a human who has reviewed the
 * dry-run plan first.
 */
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { SPRITE_BUCKET, SPRITE_FOLDER } from '../lib/sprite-url';
import { planMirror, type MirrorPlan, type MirrorScope, type PlannedUpload } from './pokeminers';

// Loaded before anything reads process.env. dotenv never overrides, so a value exported in the shell
// wins over both files, and .env.scripts.local wins over .env.local.
for (const file of ['.env.scripts.local', '.env.local']) {
  dotenv.config({ path: path.resolve(__dirname, '..', file), quiet: true });
}

const REPO = 'PokeMiners/pogo_assets';
const ASSET_DIR = 'Images/Pokemon - 256x256/Addressable Assets';
const DEFAULT_CONCURRENCY = 4;
const DOWNLOAD_ATTEMPTS = 3;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Sprites are immutable per key in practice; a week keeps the CDN warm while still letting a
 *  `--force` correction reach clients reasonably soon. */
const CACHE_CONTROL_SECONDS = '604800';

// ================================================================================================
// Flags
// ================================================================================================

interface Flags extends MirrorScope {
  yes: boolean;
  force: boolean;
  concurrency: number;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    yes: false,
    forms: false,
    costumes: false,
    force: false,
    concurrency: DEFAULT_CONCURRENCY,
    range: null,
  };
  for (const arg of argv) {
    if (arg === '--yes') flags.yes = true;
    else if (arg === '--forms') flags.forms = true;
    else if (arg === '--costumes') flags.costumes = true;
    else if (arg === '--all') flags.forms = flags.costumes = true;
    else if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice('--concurrency='.length));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--concurrency must be a positive whole number, got "${arg}".`);
      flags.concurrency = n;
    } else if (arg.startsWith('--range=')) {
      const raw = arg.slice('--range='.length);
      const m = /^(\d+)-(\d+)$/.exec(raw);
      if (!m) throw new Error(`--range must look like A-B (e.g. --range=1-151), got "${raw}".`);
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (lo > hi) throw new Error(`--range's low end must not exceed its high end, got "${raw}".`);
      flags.range = [lo, hi];
    } else {
      throw new Error(
        `Unrecognized argument "${arg}". Recognized: --yes --forms --costumes --all --range=A-B --force --concurrency=N`,
      );
    }
  }
  return flags;
}

function requireEnv(name: string, where: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Set it in ${where} (see .env.example) or export it before running.`);
  return value;
}

// ================================================================================================
// GitHub: resolve master -> commit SHA, enumerate the one asset folder
// ================================================================================================

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  // Unauthenticated GitHub API calls share a 60/hour rate limit across everyone on the same egress IP.
  // An optional personal access token (public-repo read, no scopes) raises that to 5000/hour.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
    throw new Error(
      `GitHub API rate limit exhausted while ${what}; it resets at ${reset.toLocaleTimeString()}. ` +
        `Wait, or set GITHUB_TOKEN in .env.scripts.local (raises the limit to 5000/hour).`,
    );
  }
  throw new Error(`GitHub responded ${res.status} ${res.statusText} while ${what}.`);
}

async function resolveCommitSha(): Promise<string> {
  const body = await githubJson<{ object: { sha: string } }>(
    `https://api.github.com/repos/${REPO}/git/ref/heads/master`,
    `resolving ${REPO}@master`,
  );
  return body.object.sha;
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

async function getTree(sha: string, what: string): Promise<TreeEntry[]> {
  const body = await githubJson<{ tree: TreeEntry[]; truncated: boolean }>(
    `https://api.github.com/repos/${REPO}/git/trees/${sha}`,
    `listing ${what}`,
  );
  if (body.truncated) throw new Error(`GitHub truncated the tree listing of ${what}; cannot enumerate it safely.`);
  return body.tree;
}

/** Walks commit -> `Images` -> `Pokemon - 256x256` -> `Addressable Assets` one NON-recursive tree at a
 *  time. A recursive listing of the whole repo is one call, but pogo_assets is large enough that GitHub
 *  may truncate it (100k entries / 7 MB); four small listings never hit that cap. */
async function listAssetFiles(commitSha: string): Promise<string[]> {
  let treeSha = commitSha;
  let walked = '';
  for (const segment of ASSET_DIR.split('/')) {
    const entries = await getTree(treeSha, walked || 'the repo root');
    const dir = entries.find((entry) => entry.type === 'tree' && entry.path === segment);
    if (!dir) throw new Error(`"${segment}" not found under ${walked || 'the repo root'} at ${commitSha}.`);
    treeSha = dir.sha;
    walked = walked ? `${walked}/${segment}` : segment;
  }
  const files = await getTree(treeSha, walked);
  return files.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
}

function rawFileUrl(sha: string, sourceFile: string): string {
  const segments = [...ASSET_DIR.split('/'), sourceFile].map(encodeURIComponent);
  return `https://raw.githubusercontent.com/${REPO}/${sha}/${segments.join('/')}`;
}

// ================================================================================================
// Reporting
// ================================================================================================

function describeScope(flags: Flags): string {
  const range = flags.range ? `pokemonId ${flags.range[0]}-${flags.range[1]}` : 'every pokemonId in the Pokédex';
  return `${range}, forms=${flags.forms ? 'yes' : 'no'}, costumes=${flags.costumes ? 'yes' : 'no'}`;
}

function printPlan(sha: string, flags: Flags, plan: MirrorPlan): void {
  console.log('PokeGoTrades sprite mirror');
  console.log(`Source: ${REPO} @ ${sha} (master), "${ASSET_DIR}"`);
  console.log(`Scope:  ${describeScope(flags)}`);
  console.log('');

  if (plan.invalidCode.length > 0) {
    console.log(`${plan.invalidCode.length} source file(s) skipped: form/costume code isn't [A-Z0-9_]+ upstream:`);
    for (const file of plan.invalidCode) console.log(`  ~ ${file}`);
    console.log('');
  }
  if (plan.collisions.length > 0) {
    console.log(`${plan.collisions.length} KEY COLLISION(S), excluded until resolved by hand:`);
    for (const line of plan.collisions) console.log(`  ! ${line}`);
    console.log('');
  }
  if (plan.missingBase.length > 0) {
    console.log(`${plan.missingBase.length} Pokédex id(s) have no base icon upstream (the app shows the letter tile):`);
    console.log(`  ${plan.missingBase.join(', ')}`);
    console.log('');
  }

  for (const item of plan.uploads) {
    console.log(`  ${item.key.padEnd(48)} <- ${item.sourceFile}`);
  }
  console.log('');
  console.log(
    flags.yes
      ? `${plan.uploads.length} file(s) planned for the "${SPRITE_BUCKET}" bucket.`
      : `${plan.uploads.length} file(s) would be uploaded to the "${SPRITE_BUCKET}" bucket.\n` +
          `This was a DRY RUN — nothing was downloaded or uploaded. Re-run with --yes (and\n` +
          `SUPABASE_SECRET_KEY set in .env.scripts.local) to actually mirror them.`,
  );
}

// ================================================================================================
// Download + upload (only reached with --yes)
// ================================================================================================

async function withRetries<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        console.warn(`  retrying ${label} (${attempt + 1}/${attempts}) in ${backoffMs}ms: ${errorMessage(error)}`);
        await delay(backoffMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function downloadSource(sha: string, sourceFile: string): Promise<Buffer> {
  const url = rawFileUrl(sha, sourceFile);
  const bytes = await withRetries(`download ${sourceFile}`, DOWNLOAD_ATTEMPTS, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  // The bucket only checks the DECLARED content type, so an HTML error page uploaded as image/png would
  // be accepted and then render as a broken sprite in the app. Check the actual bytes.
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${sourceFile} is not a PNG (bad signature)`);
  }
  return bytes;
}

type UploadOutcome = 'uploaded' | 'failed';

async function uploadOne(supabase: SupabaseClient, sha: string, item: PlannedUpload, force: boolean): Promise<UploadOutcome> {
  try {
    const bytes = await downloadSource(sha, item.sourceFile);
    const { error } = await supabase.storage.from(SPRITE_BUCKET).upload(item.key, bytes, {
      contentType: 'image/png',
      cacheControl: CACHE_CONTROL_SECONDS,
      upsert: force,
    });
    if (error) {
      console.error(`  ! ${item.key} failed: ${error.message}`);
      return 'failed';
    }
    console.log(`  + ${item.key} <- ${item.sourceFile}`);
    return 'uploaded';
  } catch (error) {
    console.error(`  ! ${item.key} failed: ${errorMessage(error)}`);
    return 'failed';
  }
}

/** Every object key already under `SPRITE_FOLDER`, so a re-run skips them BEFORE downloading anything:
 *  not re-pulling thousands of files from GitHub is the point of mirroring in the first place. */
async function listExistingKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(SPRITE_BUCKET).list(SPRITE_FOLDER, { limit: pageSize, offset });
    if (error) throw new Error(`Could not list existing sprites: ${error.message}`);
    for (const object of data) keys.add(`${SPRITE_FOLDER}/${object.name}`);
    if (data.length < pageSize) return keys;
  }
}

/** A fixed-size worker pool, not `Promise.all(items.map(...))`: with thousands of planned uploads, all
 *  of them starting at once would blow past GitHub's / Supabase's own concurrent-connection limits. */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function runner(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
}

// ================================================================================================
// Main
// ================================================================================================

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL', '.env.local');
  // Required only for --yes: a dry run never touches Supabase at all.
  const secretKey = flags.yes ? requireEnv('SUPABASE_SECRET_KEY', '.env.scripts.local') : null;
  if (secretKey?.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SECRET_KEY is a publishable key; uploads need the secret (sb_secret_...) key.');
  }
  if (flags.yes) console.log(`Target: ${new URL(supabaseUrl).host}, bucket "${SPRITE_BUCKET}"`);

  console.log(`Resolving ${REPO}@master...`);
  const sha = await resolveCommitSha();
  console.log(`  -> ${sha}`);

  console.log(`Listing "${ASSET_DIR}"...`);
  const files = await listAssetFiles(sha);
  console.log(`  -> ${files.length} file(s) found`);
  console.log('');

  const plan = planMirror(files, flags);
  printPlan(sha, flags, plan);

  if (!flags.yes) {
    if (plan.collisions.length > 0) process.exitCode = 1;
    return; // dry run: stop here, nothing downloaded or uploaded
  }

  const supabase = createClient(supabaseUrl, secretKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error: bucketError } = await supabase.storage.getBucket(SPRITE_BUCKET);
  if (bucketError) {
    throw new Error(`Bucket "${SPRITE_BUCKET}" not reachable (${bucketError.message}). Run \`npx supabase db push\` first.`);
  }

  const existing = flags.force ? new Set<string>() : await listExistingKeys(supabase);
  const todo = plan.uploads.filter((item) => !existing.has(item.key));
  const skipped = plan.uploads.length - todo.length;
  console.log(`Uploading ${todo.length} file(s); ${skipped} already in the bucket (pass --force to overwrite).`);

  let uploaded = 0;
  let failed = 0;
  await runWithConcurrency(todo, flags.concurrency, async (item) => {
    if ((await uploadOne(supabase, sha, item, flags.force)) === 'uploaded') uploaded++;
    else failed++;
  });

  console.log('');
  console.log(`Done: ${uploaded} uploaded, ${skipped} already there, ${failed} failed.`);
  if (plan.collisions.length > 0 || failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
