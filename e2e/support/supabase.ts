import { execFileSync } from 'node:child_process';

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/** Seeded trainers (supabase/seed.sql): `<handle lowercased>@pokegotrades.test` / `password123`. */
export const PASSWORD = 'password123';

export interface Trainer {
  id: string;
  handle: string;
  email: string;
  /** How the Handshake shows the friend code: 12 raw digits as `dddd · dddd · dddd`. */
  friendCode: string;
}

export const DRIFTCORAL: Trainer = {
  id: 'a0000000-0000-4000-8000-000000000001',
  handle: 'DriftCoral',
  email: 'driftcoral@pokegotrades.test',
  friendCode: '2841 · 9903 · 7715',
};

export const MINTRUNNER: Trainer = {
  id: 'a0000000-0000-4000-8000-000000000008',
  handle: 'MintRunner',
  email: 'mintrunner@pokegotrades.test',
  friendCode: '1000 · 0000 · 0008',
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Start the local stack (npm run db:start) and see .env.example.`);
  return value;
}

export const SUPABASE_URL = (): string => required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
const anonKey = (): string =>
  required('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** The key supabase-js keeps its session under: `sb-<first label of the API host>-auth-token`. */
export const sessionStorageKey = (): string => `sb-${new URL(SUPABASE_URL()).hostname.split('.')[0]}-auth-token`;

/** Service-role key: from the environment, else from the local stack the CLI is running. */
function serviceKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const match = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error('Could not read SERVICE_ROLE_KEY from `supabase status`. Is the local stack running?');
  return match[1];
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Bypasses RLS: only for arranging and inspecting state around a test, never for the flow under test. */
export const adminClient = (): SupabaseClient => createClient(SUPABASE_URL(), serviceKey(), clientOptions);

/**
 * The app has no password screen (Google/Microsoft OAuth only), so a trainer "logs in" the way a
 * permanent session would arrive: a password grant against GoTrue, stored where supabase-js keeps its
 * session. The app then boots straight into that session instead of signing in anonymously.
 */
export async function signIn(trainer: Trainer): Promise<Session> {
  const { data, error } = await createClient(SUPABASE_URL(), anonKey(), clientOptions).auth.signInWithPassword({
    email: trainer.email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(`Sign-in as ${trainer.handle} failed: ${error?.message ?? 'no session'}`);
  return data.session;
}

export interface ListingFixture {
  id: string;
  name: string;
  /** The creature the seller is Looking For, i.e. the row the buyer picks in the offer sheet. */
  wanted: string;
}

/**
 * A fresh open listing for `seller`, so the run neither depends on nor consumes the seeded ones (completing
 * a trade closes the listing for good). The name is unique per run, which is how the feed finds it.
 */
export async function createListingFixture(admin: SupabaseClient, seller: Trainer, runId: string): Promise<ListingFixture> {
  const wanted = 'E2E Wanted Dragonite';
  const { data, error } = await admin
    .from('listings')
    .insert({
      seller_id: seller.id,
      name: `E2E Mewtwo ${runId}`,
      pokemon_id: 150,
      form: 'Standard',
      catch_year: 2024,
      hue: 220,
      accent: '#4fb3ff',
      bg: 'meta',
      loc: 'Adyar', // the feed's default area
      trade_type: 'Standard / Registered',
      looking: [{ name: wanted, pokemonId: 149, hue: 340 }],
    })
    .select('id, name')
    .single();
  if (error || !data) throw new Error(`Could not create the listing fixture: ${error?.message}`);
  return { id: data.id as string, name: data.name as string, wanted };
}

/** Everything a run leaves behind: the trade row (its listing FK is `set null`, so it must go first), the
 *  listing with its chats / messages / lock (cascade), and the trades counters the completion bumped. */
export async function removeListingFixture(
  admin: SupabaseClient,
  listingId: string,
  trainers: Trainer[],
): Promise<void> {
  // Count before deleting: this is how much *this* fixture added, which is what we have to take back.
  const { data: trades, error } = await admin.from('completed_trades').select('id').eq('listing_id', listingId);
  if (error) throw new Error(`Could not read the fixture's trades: ${error.message}`);
  const added = trades?.length ?? 0;

  await admin.from('completed_trades').delete().eq('listing_id', listingId);
  await admin.from('listings').delete().eq('id', listingId);
  if (added > 0) await Promise.all(trainers.map((t) => decrementTrades(admin, t.id, added)));
}

/**
 * Takes `by` off a trainer's `trades_count` relatively, so teardown only ever undoes what its own run
 * added.
 *
 * This used to snapshot every counter in `beforeAll` and write the snapshots back in `afterAll`. Two
 * things were wrong with that. A run killed between the trade and the teardown (CI timeout, SIGKILL) left
 * the increment in place, and the next run read the inflated number as its baseline and restored *that* —
 * so every crash ratcheted the counter up permanently, and nothing asserted an absolute count, so nothing
 * ever noticed. And with `workers > 1`, two specs sharing these trainers would both snapshot the same
 * starting value and the later teardown would stamp its stale snapshot over the other's work.
 *
 * PostgREST cannot express `set trades_count = trades_count - 1`, so the relative update is done as a
 * compare-and-swap: read, then write conditioned on the value not having moved. A concurrent writer makes
 * the update match zero rows, and we re-read and try again rather than clobbering it.
 */
async function decrementTrades(admin: SupabaseClient, id: string, by: number, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data: row, error: readError } = await admin
      .from('profiles')
      .select('trades_count')
      .eq('id', id)
      .single();
    if (readError) throw new Error(`Could not read trades_count for ${id}: ${readError.message}`);

    const current = row.trades_count as number;
    const { data: updated, error: writeError } = await admin
      .from('profiles')
      .update({ trades_count: Math.max(0, current - by) })
      .eq('id', id)
      .eq('trades_count', current) // the compare half: nobody moved it since the read
      .select('id');
    if (writeError) throw new Error(`Could not restore trades_count for ${id}: ${writeError.message}`);
    if (updated && updated.length > 0) return;
  }
  throw new Error(`Could not restore trades_count for ${id}: it kept changing under ${attempts} attempts`);
}

export async function tradesCounts(admin: SupabaseClient, trainers: Trainer[]): Promise<Record<string, number>> {
  const { data, error } = await admin.from('profiles').select('id, trades_count').in('id', trainers.map((t) => t.id));
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.id as string, row.trades_count as number]));
}
