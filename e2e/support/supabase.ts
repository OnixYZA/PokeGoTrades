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
 * The app has no password screen (email OTP only), so a trainer "logs in" the way a returning session would
 * arrive: a password grant against GoTrue, stored where supabase-js keeps its session. The app then boots
 * straight into that session instead of signing in anonymously.
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
  tradesCounts: Record<string, number>,
): Promise<void> {
  await admin.from('completed_trades').delete().eq('listing_id', listingId);
  await admin.from('listings').delete().eq('id', listingId);
  for (const [id, trades_count] of Object.entries(tradesCounts)) {
    await admin.from('profiles').update({ trades_count }).eq('id', id);
  }
}

export async function tradesCounts(admin: SupabaseClient, trainers: Trainer[]): Promise<Record<string, number>> {
  const { data, error } = await admin.from('profiles').select('id, trades_count').in('id', trainers.map((t) => t.id));
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.id as string, row.trades_count as number]));
}
