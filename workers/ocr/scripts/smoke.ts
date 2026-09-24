import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { handler } from '../src/handler';
import { loadConfig, PROOF_BUCKET } from '../src/env';
import { shutdownOcr } from '../src/ocr';
import { processPending } from '../src/process';
import { createServiceClient } from '../src/supabase';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

/**
 * End-to-end check against the LOCAL Supabase stack: real Storage objects, real `listing_proofs` rows, the real
 * Lambda handler and OCR. `npm run smoke` creates its own listings and proofs, and deletes them afterwards.
 * It refuses to run against anything but localhost, because it writes rows and files.
 */

const FIXTURES = path.resolve(__dirname, '..', 'test', 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));
type Kind = 'appraisal' | 'movesets' | 'event_badge';

// One handler run has to cover every case in scenario 1, and the default batch of 10 would not.
process.env.OCR_BATCH_SIZE = '50';
const config = loadConfig();
const host = new URL(config.supabaseUrl).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`Refusing to run the smoke test against ${host}: it writes rows and files. Point it at the local stack.`);
  process.exit(1);
}
const supabase = createServiceClient(config);

const listingIds: string[] = [];
const objectPaths: string[] = [];
const problems: string[] = [];
const check = (ok: boolean, label: string, detail?: unknown) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : `   got ${JSON.stringify(detail)}`}`);
  if (!ok) problems.push(label);
};

async function sellerId(): Promise<string> {
  const { data, error } = await supabase.from('profiles').select('id').order('created_at').limit(1).single();
  if (error || !data) throw new Error(`No profile to own the test listings: ${error?.message}`);
  return data.id as string;
}

/** A second trainer, to make an offer with. */
async function buyerId(seller: string): Promise<string> {
  const { data, error } = await supabase.from('profiles').select('id').neq('id', seller).order('created_at').limit(1).single();
  if (error || !data) throw new Error(`No second profile to make an offer: ${error?.message}`);
  return data.id as string;
}

async function newListing(seller: string, label: string, options: { lucky?: boolean } = {}): Promise<string> {
  const { data, error } = await supabase
    .from('listings')
    .insert({
      seller_id: seller,
      name: `OCR smoke ${label}`,
      lucky: options.lucky ?? false,
      pokemon_id: 150,
      catch_year: 2024,
      hue: 220,
      loc: 'Adyar',
      trade_type: 'Standard / Registered',
      looking: [{ name: 'Smoke Wanted', pokemonId: 149, hue: 340 }],
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not create a listing: ${error?.message}`);
  listingIds.push(data.id as string);
  return data.id as string;
}

/** An open chat on the listing, i.e. an offer. From then on `guard_listing_update` freezes the listing's trade details. */
async function newOffer(listing: string, seller: string, buyer: string): Promise<void> {
  const { error } = await supabase.from('chats').insert({ listing_id: listing, seller_id: seller, buyer_id: buyer });
  if (error) throw new Error(`Could not create the offer: ${error.message}`);
}

async function isLucky(listing: string): Promise<boolean> {
  const { data, error } = await supabase.from('listings').select('lucky').eq('id', listing).single();
  if (error || !data) throw new Error(`Could not read listing ${listing}: ${error?.message}`);
  return data.lucky as boolean;
}

/** A proof row, with its image uploaded first (as the app does). `image: null` leaves the object missing. */
async function newProof(seller: string, listing: string, kind: Kind, image: { bytes: Buffer; contentType: string } | null): Promise<string> {
  const storagePath = `${seller}/${listing}/${kind}`;
  if (image) {
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(storagePath, image.bytes, { contentType: image.contentType });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    objectPaths.push(storagePath);
  }
  const { data, error } = await supabase.from('listing_proofs').insert({ listing_id: listing, kind, storage_path: storagePath }).select('id').single();
  if (error || !data) throw new Error(`Could not insert the proof row: ${error?.message}`);
  return data.id as string;
}

async function state(id: string): Promise<{ status: string; extracted: unknown }> {
  const { data, error } = await supabase.from('listing_proofs').select('ocr_status, ocr_extracted').eq('id', id).single();
  if (error || !data) throw new Error(`Could not read proof ${id}: ${error?.message}`);
  return { status: data.ocr_status as string, extracted: data.ocr_extracted };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Removes what an earlier run left behind if it died before its cleanup, so stale rows cannot skew this one. */
async function sweepLeftovers(): Promise<void> {
  const { data } = await supabase.from('listings').select('id').like('name', 'OCR smoke %');
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) return;
  const { data: proofs } = await supabase.from('listing_proofs').select('storage_path').in('listing_id', ids);
  const paths = (proofs ?? []).map((row) => row.storage_path as string);
  if (paths.length) await supabase.storage.from(PROOF_BUCKET).remove(paths);
  await supabase.from('listings').delete().in('id', ids);
  console.log(`(removed ${ids.length} leftover smoke listing(s) from an earlier run)`);
}

async function main(): Promise<void> {
  await sweepLeftovers();
  const seller = await sellerId();

  // --- 1. Every kind and outcome, through the Lambda handler ------------------------------------------------------
  console.log('\n1. One batch through the Lambda handler');
  const buyer = await buyerId(seller);
  const png = (name: string) => ({ bytes: fixture(name), contentType: 'image/png' });
  const notAnImage = { bytes: Buffer.from('this is not an image'), contentType: 'image/png' };

  interface Case {
    name: string;
    kind: Kind;
    image: { bytes: Buffer; contentType: string } | null;
    status: 'verified' | 'failed';
    extracted: unknown;
    /** Whether the listing ends up Guaranteed Lucky. */
    lucky: boolean;
    /** The listing starts out Lucky already, or has an offer on it. */
    listing?: { lucky?: boolean; offer?: boolean };
  }
  const UNREADABLE = { reason: 'unreadable' };
  const cases: Case[] = [
    // appraisal: the catch date is required, and decides the badge (cutoff 2019-07-01)
    { name: 'appraisal, PNG, caught 2018-11-23 -> verified, listing earns Lucky', kind: 'appraisal', image: png('caught-2018.png'), status: 'verified', extracted: { caughtAt: '2018-11-23' }, lucky: true },
    { name: 'appraisal, WebP, 7/4/2018 (either reading is before the cutoff) -> Lucky', kind: 'appraisal', image: { bytes: fixture('caught-ambiguous.webp'), contentType: 'image/webp' }, status: 'verified', extracted: { caughtAt: '2018-07-04', ambiguous: true }, lucky: true },
    { name: 'appraisal, PNG, caught 2021-03-14 -> verified, no badge', kind: 'appraisal', image: png('caught-mdy.png'), status: 'verified', extracted: { caughtAt: '2021-03-14' }, lucky: false },
    { name: 'appraisal, JPEG, spaced 25 / 12 / 2019 -> verified, no badge', kind: 'appraisal', image: { bytes: fixture('caught-dmy-spaced.jpg'), contentType: 'image/jpeg' }, status: 'verified', extracted: { caughtAt: '2019-12-25' }, lucky: false },
    { name: 'appraisal, 03/09/2019 (9 March or 3 September) -> verified, badge NOT granted on a guess', kind: 'appraisal', image: png('caught-straddle.png'), status: 'verified', extracted: { caughtAt: '2019-03-09', ambiguous: true }, lucky: false },
    { name: 'appraisal, already-Lucky listing -> verified, stays Lucky', kind: 'appraisal', image: png('caught-2018.png'), status: 'verified', extracted: { caughtAt: '2018-11-23' }, lucky: true, listing: { lucky: true } },
    { name: 'appraisal, listing already has an offer -> verified, badge blocked by the guard', kind: 'appraisal', image: png('caught-2018.png'), status: 'verified', extracted: { caughtAt: '2018-11-23' }, lucky: false, listing: { offer: true } },
    { name: 'appraisal, no catch date (only an unrelated date) -> failed', kind: 'appraisal', image: png('no-date.png'), status: 'failed', extracted: UNREADABLE, lucky: false },
    { name: 'appraisal, bytes that are not an image -> failed', kind: 'appraisal', image: notAnImage, status: 'failed', extracted: UNREADABLE, lucky: false },
    { name: 'appraisal, object missing from storage -> failed', kind: 'appraisal', image: null, status: 'failed', extracted: UNREADABLE, lucky: false },
    // movesets / event_badge: no date needed, readable text is enough, and they never touch the badge
    { name: 'movesets, readable screen with no date -> verified', kind: 'movesets', image: png('no-date.png'), status: 'verified', extracted: {}, lucky: false },
    { name: 'event_badge, screen with a 2018 date -> verified, date ignored, no badge', kind: 'event_badge', image: png('caught-2018.png'), status: 'verified', extracted: {}, lucky: false },
    { name: 'movesets, blank image (no text) -> failed', kind: 'movesets', image: png('blank.png'), status: 'failed', extracted: UNREADABLE, lucky: false },
    { name: 'event_badge, bytes that are not an image -> failed', kind: 'event_badge', image: notAnImage, status: 'failed', extracted: UNREADABLE, lucky: false },
  ];

  const prepared: { case: Case; proof: string; listing: string }[] = [];
  for (const [i, c] of cases.entries()) {
    const listing = await newListing(seller, `case ${i + 1}`, { lucky: c.listing?.lucky });
    if (c.listing?.offer) await newOffer(listing, seller, buyer);
    prepared.push({ case: c, listing, proof: await newProof(seller, listing, c.kind, c.image) });
  }

  const summary = await handler({}, { getRemainingTimeInMillis: () => 5 * 60_000 });
  console.log(`  handler returned ${JSON.stringify(summary)}`);
  for (const { case: c, proof, listing } of prepared) {
    const got = await state(proof);
    const lucky = await isLucky(listing);
    check(got.status === c.status && same(got.extracted, c.extracted) && lucky === c.lucky, c.name, { ...got, lucky });
  }
  check(summary.claimed >= cases.length && summary.released === 0, 'nothing was released for retry', summary);
  check(summary.luckyGranted === 2, 'two listings were newly made Lucky (not the one that already was)', summary.luckyGranted);
  check(summary.luckyBlocked === 1, 'one listing could not be, because it has an offer', summary.luckyBlocked);

  // --- 2. Two workers, same queue: no proof is claimed twice ---------------------------------------------------
  console.log('\n2. Two overlapping workers over three pending proofs');
  const c = await newListing(seller, 'race');
  const raced = await Promise.all(
    (['appraisal', 'movesets', 'event_badge'] as const).map((kind) => newProof(seller, c, kind, { bytes: fixture('caught-mdy.png'), contentType: 'image/png' })),
  );
  const [first, second] = await Promise.all([processPending(supabase, config), processPending(supabase, config)]);
  check(first.claimed + second.claimed === raced.length, 'each proof was claimed by exactly one worker', { first: first.claimed, second: second.claimed });
  check(first.verified + second.verified === raced.length, 'each proof was verified exactly once');
  console.log(`  (lost claims: ${first.lostClaim + second.lostClaim}, where a worker found a row already taken)`);
  for (const id of raced) check((await state(id)).status === 'verified', `proof ${id.slice(0, 8)} is verified`);

  // --- 3. Time budget, stale claims -----------------------------------------------------------------------------
  console.log('\n3. Time budget and stale claims');
  const d = await newListing(seller, 'lease');
  const stale = await newProof(seller, d, 'appraisal', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });
  const fresh = await newProof(seller, d, 'movesets', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });
  const late = await newProof(seller, d, 'event_badge', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });

  await supabase.from('listing_proofs').update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date(Date.now() - 3_600_000).toISOString() } }).eq('id', stale);
  await supabase.from('listing_proofs').update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date().toISOString() } }).eq('id', fresh);

  const rushed = await processPending(supabase, config, { deadline: Date.now() + 1_000 });
  check(rushed.outOfTime && rushed.claimed === 0, 'with no time left, it starts nothing', rushed);
  check(rushed.recovered === 1, 'a claim older than the lease is released, even by a run with no time left', rushed.recovered);
  check((await state(late)).status === 'pending', 'the untouched proof is still pending');

  await processPending(supabase, config);
  check((await state(stale)).status === 'verified', 'the released proof was then read');
  check((await state(late)).status === 'verified', 'the pending proof was read once there was time');
  check((await state(fresh)).status === 'processing', 'a recent claim (another worker at work) is left alone');
}

async function cleanup(): Promise<void> {
  if (objectPaths.length) await supabase.storage.from(PROOF_BUCKET).remove(objectPaths);
  if (listingIds.length) await supabase.from('listings').delete().in('id', listingIds); // cascades to listing_proofs
}

main()
  .catch((error: unknown) => {
    problems.push(error instanceof Error ? error.message : String(error));
    console.error(error);
  })
  .finally(async () => {
    await cleanup().catch((error: unknown) => console.error('cleanup failed:', error));
    await shutdownOcr();
    console.log(problems.length ? `\nSMOKE FAILED (${problems.length}): ${problems.join('; ')}` : '\nSmoke test passed.');
    process.exit(problems.length ? 1 : 0);
  });
