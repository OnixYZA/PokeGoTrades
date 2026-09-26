import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import sharp from 'sharp';

import { LISTING_PROOF_BUCKET, loadConfig, PROFILE_PROOF_BUCKET } from '../src/core/env';
import { shutdownOcr } from '../src/core/ocr';
import { listingProofsQueue, processQueue, profileProofsQueue } from '../src/core/process';
import { createServiceClient } from '../src/core/supabase';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

/**
 * End-to-end check against the LOCAL Supabase stack: real Storage objects, real `listing_proofs` /
 * `profile_proofs` rows, and the real queue runner (`processQueue`, `src/core/process.ts`) — the same function
 * `src/functions/ocrSweep.ts` and `src/functions/profileOcr.ts` call, just invoked directly instead of through
 * `func start`. `npm run smoke` creates its own listings, trainers and proofs, and deletes them afterwards. It
 * refuses to run against anything but localhost, because it writes rows and files.
 */

const FIXTURES = path.resolve(__dirname, '..', 'test', 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));
type Kind = 'appraisal' | 'movesets' | 'event_badge';

// One `processQueue` run has to cover every case in scenario 1, and the default batch of 10 would not.
process.env.OCR_BATCH_SIZE = '50';
const config = loadConfig();
const host = new URL(config.supabaseUrl).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`Refusing to run the smoke test against ${host}: it writes rows and files. Point it at the local stack.`);
  process.exit(1);
}
const supabase = createServiceClient(config);
const FIVE_MINUTES = 5 * 60_000;

const listingIds: string[] = [];
const listingObjectPaths: string[] = [];
const trainerIds: string[] = [];
const profileObjectPaths: string[] = [];
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

/** A listing proof row, with its image uploaded first (as the app does). `image: null` leaves the object missing. */
async function newListingProof(seller: string, listing: string, kind: Kind, image: { bytes: Buffer; contentType: string } | null): Promise<string> {
  const storagePath = `${seller}/${listing}/${kind}`;
  if (image) {
    const { error } = await supabase.storage.from(LISTING_PROOF_BUCKET).upload(storagePath, image.bytes, { contentType: image.contentType });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    listingObjectPaths.push(storagePath);
  }
  const { data, error } = await supabase.from('listing_proofs').insert({ listing_id: listing, kind, storage_path: storagePath }).select('id').single();
  if (error || !data) throw new Error(`Could not insert the proof row: ${error?.message}`);
  return data.id as string;
}

async function listingProofState(id: string): Promise<{ status: string; extracted: unknown }> {
  const { data, error } = await supabase.from('listing_proofs').select('ocr_status, ocr_extracted').eq('id', id).single();
  if (error || !data) throw new Error(`Could not read proof ${id}: ${error?.message}`);
  return { status: data.ocr_status as string, extracted: data.ocr_extracted };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Removes what an earlier run left behind if it died before its cleanup, so stale rows cannot skew this one. */
async function sweepLeftoverListings(): Promise<void> {
  const { data } = await supabase.from('listings').select('id').like('name', 'OCR smoke %');
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) return;
  const { data: proofs } = await supabase.from('listing_proofs').select('storage_path').in('listing_id', ids);
  const paths = (proofs ?? []).map((row) => row.storage_path as string);
  if (paths.length) await supabase.storage.from(LISTING_PROOF_BUCKET).remove(paths);
  await supabase.from('listings').delete().in('id', ids);
  console.log(`(removed ${ids.length} leftover smoke listing(s) from an earlier run)`);
}

// ================================================================================================================
// Profile proofs: a throwaway auth user per case, never an existing seed trainer — `apply_profile_proof` writes
// a real trainer's `handle` and `friend_code`, and a smoke test has no business renaming someone else's account
// even temporarily. Each throwaway is tagged `user_metadata.ocrSmoke` so a crashed earlier run can be found and
// removed, the same job `sweepLeftoverListings` does for listings by name prefix.
// ================================================================================================================

async function sweepLeftoverTrainers(): Promise<void> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Could not list users: ${error.message}`);
  const stale = (data.users ?? []).filter((u) => (u.user_metadata as Record<string, unknown> | null)?.ocrSmoke === true);
  for (const u of stale) await supabase.auth.admin.deleteUser(u.id);
  if (stale.length) console.log(`(removed ${stale.length} leftover smoke trainer(s) from an earlier run)`);
}

async function newTrainer(label: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `ocr-smoke-${label}-${Date.now()}@pokegotrades.test`,
    email_confirm: true,
    password: `Smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    user_metadata: { ocrSmoke: true },
  });
  if (error || !data.user) throw new Error(`Could not create a throwaway trainer (${label}): ${error?.message}`);
  trainerIds.push(data.user.id);
  return data.user.id;
}

/** A synthetic "My Trainer Code" screenshot: plain, high-contrast text, rendered with sharp's SVG support — the
 * same spirit as `test/fixtures/*.png` (rendered from text, not real Pokémon GO screenshots). */
async function renderProfileScreenshot(handle: string, friendCode: string): Promise<Buffer> {
  const grouped = friendCode.replace(/(\d{4})(?=\d)/g, '$1 ');
  const svg = `<svg width="640" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="24" y="48" font-size="26" font-family="monospace" fill="#000000">MY TRAINER CODE</text>
    <text x="24" y="120" font-size="34" font-family="monospace" fill="#000000">${handle}</text>
    <text x="24" y="190" font-size="34" font-family="monospace" fill="#000000">${grouped}</text>
    <text x="24" y="260" font-size="22" font-family="monospace" fill="#000000">SCAN TO ADD FRIEND</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function newProfileProof(userId: string, image: { bytes: Buffer; contentType: string } | null): Promise<string> {
  const id = randomUUID();
  const storagePath = `${userId}/${id}`;
  if (image) {
    const { error } = await supabase.storage.from(PROFILE_PROOF_BUCKET).upload(storagePath, image.bytes, { contentType: image.contentType });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    profileObjectPaths.push(storagePath);
  }
  const { error } = await supabase.from('profile_proofs').insert({ id, storage_path: storagePath, user_id: userId });
  if (error) throw new Error(`Could not insert the profile proof row: ${error.message}`);
  return id;
}

async function profileProofState(id: string): Promise<{ status: string; extracted: unknown }> {
  const { data, error } = await supabase.from('profile_proofs').select('ocr_status, ocr_extracted').eq('id', id).single();
  if (error || !data) throw new Error(`Could not read profile proof ${id}: ${error?.message}`);
  return { status: data.ocr_status as string, extracted: data.ocr_extracted };
}

async function profileOf(userId: string): Promise<{ handle: string; placeholder: boolean; friendCode: string | null }> {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('handle, handle_is_placeholder').eq('id', userId).single();
  if (profileError || !profile) throw new Error(`Could not read profile ${userId}: ${profileError?.message}`);
  const { data: priv, error: privError } = await supabase.from('profile_private').select('friend_code').eq('user_id', userId).single();
  if (privError || !priv) throw new Error(`Could not read profile_private ${userId}: ${privError?.message}`);
  return { handle: profile.handle as string, placeholder: profile.handle_is_placeholder as boolean, friendCode: priv.friend_code as string | null };
}

async function main(): Promise<void> {
  await sweepLeftoverListings();
  await sweepLeftoverTrainers();
  const seller = await sellerId();

  // --- 1. Every listing-proof kind and outcome, through the shared queue runner ------------------------------
  console.log('\n1. One batch through processQueue(listingProofsQueue)');
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
    prepared.push({ case: c, listing, proof: await newListingProof(seller, listing, c.kind, c.image) });
  }

  const summary = await processQueue(supabase, config, listingProofsQueue, { deadline: Date.now() + FIVE_MINUTES });
  console.log(`  processQueue returned ${JSON.stringify(summary)}`);
  for (const { case: c, proof, listing } of prepared) {
    const got = await listingProofState(proof);
    const lucky = await isLucky(listing);
    check(got.status === c.status && same(got.extracted, c.extracted) && lucky === c.lucky, c.name, { ...got, lucky });
  }
  check(summary.claimed >= cases.length && summary.released === 0, 'nothing was released for retry', summary);
  check(summary.luckyGranted === 2, 'two listings were newly made Lucky (not the one that already was)', summary.luckyGranted);
  check(summary.luckyBlocked === 1, 'one listing could not be, because it has an offer', summary.luckyBlocked);

  // --- 2. Two workers, same queue: no proof is claimed twice ---------------------------------------------------
  console.log('\n2. Two overlapping workers over three pending listing proofs');
  const c = await newListing(seller, 'race');
  const raced = await Promise.all(
    (['appraisal', 'movesets', 'event_badge'] as const).map((kind) => newListingProof(seller, c, kind, { bytes: fixture('caught-mdy.png'), contentType: 'image/png' })),
  );
  const [first, second] = await Promise.all([
    processQueue(supabase, config, listingProofsQueue),
    processQueue(supabase, config, listingProofsQueue),
  ]);
  check(first.claimed + second.claimed === raced.length, 'each proof was claimed by exactly one worker', { first: first.claimed, second: second.claimed });
  check(first.verified + second.verified === raced.length, 'each proof was verified exactly once');
  console.log(`  (lost claims: ${first.lostClaim + second.lostClaim}, where a worker found a row already taken)`);
  for (const id of raced) check((await listingProofState(id)).status === 'verified', `proof ${id.slice(0, 8)} is verified`);

  // --- 3. Time budget, stale claims -----------------------------------------------------------------------------
  console.log('\n3. Time budget and stale claims');
  const d = await newListing(seller, 'lease');
  const stale = await newListingProof(seller, d, 'appraisal', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });
  const fresh = await newListingProof(seller, d, 'movesets', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });
  const late = await newListingProof(seller, d, 'event_badge', { bytes: fixture('caught-mdy.png'), contentType: 'image/png' });

  await supabase.from('listing_proofs').update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date(Date.now() - 3_600_000).toISOString() } }).eq('id', stale);
  await supabase.from('listing_proofs').update({ ocr_status: 'processing', ocr_extracted: { claimedAt: new Date().toISOString() } }).eq('id', fresh);

  const rushed = await processQueue(supabase, config, listingProofsQueue, { deadline: Date.now() + 1_000 });
  check(rushed.outOfTime && rushed.claimed === 0, 'with no time left, it starts nothing', rushed);
  check(rushed.recovered === 1, 'a claim older than the lease is released, even by a run with no time left', rushed.recovered);
  check((await listingProofState(late)).status === 'pending', 'the untouched proof is still pending');

  await processQueue(supabase, config, listingProofsQueue, { deadline: Date.now() + FIVE_MINUTES });
  check((await listingProofState(stale)).status === 'verified', 'the released proof was then read');
  check((await listingProofState(late)).status === 'verified', 'the pending proof was read once there was time');
  check((await listingProofState(fresh)).status === 'processing', 'a recent claim (another worker at work) is left alone');

  // --- 4. Profile proofs: the "My Trainer Code" screen, through apply_profile_proof ------------------------------
  console.log('\n4. Profile proofs, on throwaway trainers');
  const alpha = await newTrainer('alpha');
  const alphaHandle = 'OcrSmokeAlpha';
  const alphaCode = '999888777001';
  const alphaProof = await newProfileProof(alpha, { bytes: await renderProfileScreenshot(alphaHandle, alphaCode), contentType: 'image/png' });

  await processQueue(supabase, config, profileProofsQueue, { deadline: Date.now() + FIVE_MINUTES });
  const alphaState = await profileProofState(alphaProof);
  const alphaProfile = await profileOf(alpha);
  check(alphaState.status === 'verified' && same(alphaState.extracted, { handle: alphaHandle }), 'a clean screen verifies and settles with just the handle', alphaState);
  check(alphaProfile.handle === alphaHandle && !alphaProfile.placeholder, 'the trainer\'s handle is set and no longer a placeholder', alphaProfile);
  check(alphaProfile.friendCode === alphaCode, 'and the friend code is set too', alphaProfile);

  const beta = await newTrainer('beta');
  const betaCode = '999888777002';
  const betaProof = await newProfileProof(beta, { bytes: await renderProfileScreenshot(alphaHandle, betaCode), contentType: 'image/png' }); // same handle as alpha, on purpose
  await processQueue(supabase, config, profileProofsQueue, { deadline: Date.now() + FIVE_MINUTES });
  const betaState = await profileProofState(betaProof);
  const betaProfile = await profileOf(beta);
  check(
    betaState.status === 'failed' && same(betaState.extracted, { reason: 'handle_taken', handle: alphaHandle, friendCode: betaCode }),
    'reusing another trainer\'s handle fails the proof with handle_taken, both fields prefilled',
    betaState,
  );
  check(betaProfile.placeholder && betaProfile.friendCode === null, 'and leaves the second trainer\'s own profile untouched', betaProfile);

  const gamma = await newTrainer('gamma');
  const missingProof = await newProfileProof(gamma, null);
  const badBytesProof = await newProfileProof(gamma, { bytes: Buffer.from('not an image'), contentType: 'image/png' });
  await processQueue(supabase, config, profileProofsQueue, { deadline: Date.now() + FIVE_MINUTES });
  check((await profileProofState(missingProof)).status === 'failed', 'a proof whose object never made it to storage fails, same as a listing proof');
  check((await profileProofState(badBytesProof)).status === 'failed', 'bytes that are not an image fail the same way too');
}

async function cleanup(): Promise<void> {
  if (listingObjectPaths.length) await supabase.storage.from(LISTING_PROOF_BUCKET).remove(listingObjectPaths);
  if (listingIds.length) await supabase.from('listings').delete().in('id', listingIds); // cascades to listing_proofs
  if (profileObjectPaths.length) await supabase.storage.from(PROFILE_PROOF_BUCKET).remove(profileObjectPaths);
  for (const id of trainerIds) await supabase.auth.admin.deleteUser(id); // cascades to profiles / profile_private / profile_proofs
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
