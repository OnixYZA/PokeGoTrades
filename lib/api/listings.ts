import type { QueryData } from '@supabase/supabase-js';

import type { BackgroundHint, CreatureRef, Listing, TradeType } from '@/data/types';
import type { Database, Json } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

// ——— DB-derived types ———

type ListingInsert = Database['public']['Tables']['listings']['Insert'];

export type ListingTag = Database['public']['Enums']['listing_tag'];
export type ProofKind = Database['public']['Enums']['proof_kind'];

const PROOF_BUCKET = 'listing-proofs';

/** Statuses the feed shows (SUPABASE_PLAN.md §1.8: completed and withdrawn listings are hidden). */
const FEED_STATUSES: Database['public']['Enums']['listing_status'][] = ['open', 'locked'];

// ——— errors ———

/** Anything that went wrong talking to Supabase, with the Postgres / PostgREST code when there is one. */
export class ListingsApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ListingsApiError';
    this.code = code;
  }
}

/**
 * Publishing is several requests. `listingCreated` says whether the row exists yet: retrying with the
 * same `NewListingInput.id` is safe either way (see `insertListing` and `uploadListingProof`).
 */
export class PublishListingError extends ListingsApiError {
  readonly stage: 'listing' | 'proof';
  readonly listingCreated: boolean;

  constructor(cause: ListingsApiError, stage: 'listing' | 'proof', listingCreated: boolean) {
    super(cause.message, cause.code);
    this.name = 'PublishListingError';
    this.stage = stage;
    this.listingCreated = listingCreated;
  }
}

function apiError(error: { message: string; code?: string }): ListingsApiError {
  return new ListingsApiError(error.message, error.code);
}

/** Turns a failed feed / publish call into a sentence for the UI. */
export function listingErrorMessage(error: unknown): string {
  if (!(error instanceof ListingsApiError)) return error instanceof Error ? error.message : 'Something went wrong.';
  switch (error.code) {
    case '42501':
      return 'Finish setting up your trainer profile before posting.';
    case '23503':
      return 'That area is not available yet.';
    case '23514':
      return 'The server rejected some of the listing details. Go back and check them.';
    case 'PGRST116':
      return 'This listing can no longer be edited.';
    case 'no_session':
      return 'You are signed out. Reopen the app and try again.';
    default:
      return error.message;
  }
}

// ——— reads ———

/** Everything the feed card and the detail sheet render, plus the seller's handle. */
const LISTING_COLUMNS =
  'id, seller_id, status, name, pokemon_id, form, catch_year, lucky, shiny, hue, accent, bg, loc, pvp_rank, demand_rank, trade_type, iv_atk, iv_def, iv_sta, looking, tags, notes, untradable, created_at, seller:profiles!listings_seller_id_fkey(handle)';

function selectListings() {
  return supabase.from('listings').select(LISTING_COLUMNS);
}

type ListingRow = QueryData<ReturnType<typeof selectListings>>[number];

function toCreatureRefs(value: Json): CreatureRef[] {
  if (!Array.isArray(value)) return [];
  const refs: CreatureRef[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, pokemonId, hue, shiny, lucky } = entry;
    if (typeof name !== 'string' || typeof pokemonId !== 'number' || typeof hue !== 'number') continue;
    refs.push({ name, pokemonId, hue, ...(shiny === true ? { shiny } : {}), ...(lucky === true ? { lucky } : {}) });
  }
  return refs;
}

function creatureRefToJson(ref: CreatureRef): Json {
  return {
    name: ref.name,
    pokemonId: ref.pokemonId,
    hue: ref.hue,
    ...(ref.shiny ? { shiny: true } : {}),
    ...(ref.lucky ? { lucky: true } : {}),
  };
}

/** `Listing.iv` is the display string '15/15/14', or 'Unrated' when the columns are null. */
function formatIv(row: Pick<ListingRow, 'iv_atk' | 'iv_def' | 'iv_sta'>): string {
  const { iv_atk, iv_def, iv_sta } = row;
  return iv_atk === null || iv_def === null || iv_sta === null ? 'Unrated' : `${iv_atk}/${iv_def}/${iv_sta}`;
}

function parseIv(iv: string): { iv_atk: number; iv_def: number; iv_sta: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/.exec(iv.trim());
  if (!match) return null;
  const [iv_atk, iv_def, iv_sta] = match.slice(1).map(Number);
  return [iv_atk, iv_def, iv_sta].every((n) => n >= 0 && n <= 15) ? { iv_atk, iv_def, iv_sta } : null;
}

/** DB row -> the `Listing` shape every component already consumes. `dist` stays unset (D3). */
export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    sellerId: row.seller_id,
    seller: row.seller?.handle ?? 'Unknown trainer',
    status: row.status,
    name: row.name,
    pokemonId: row.pokemon_id,
    form: row.form,
    year: row.catch_year,
    lucky: row.lucky,
    shiny: row.shiny,
    hue: row.hue,
    accent: row.accent,
    bg: row.bg,
    loc: row.loc,
    pvp: row.pvp_rank,
    demand: row.demand_rank,
    tradeType: row.trade_type,
    iv: formatIv(row),
    looking: toCreatureRefs(row.looking),
    untradable: row.untradable,
    tags: row.tags,
    notes: row.notes ?? undefined,
  };
}

/** Open and locked listings in one area, newest first. */
export async function fetchFeedListings(loc: string): Promise<Listing[]> {
  const { data, error } = await selectListings()
    .in('status', FEED_STATUSES)
    .eq('loc', loc)
    .order('created_at', { ascending: false });
  if (error) throw apiError(error);
  return data.map(toListing);
}

// ——— writes ———

/**
 * The listing fields a trainer supplies, and only those. The generated `Insert` type marks every
 * column writable, but the `authenticated` role is granted just these (SUPABASE_PLAN.md §2.1):
 * `seller_id` defaults to `auth.uid()`, and `status`, `pvp_rank`, `demand_rank`, `untradable` and
 * the timestamps are server-owned. Shadow backgrounds are rejected by a CHECK constraint.
 */
export type NewListingInput = Pick<
  Listing,
  'id' | 'name' | 'pokemonId' | 'hue' | 'form' | 'year' | 'lucky' | 'shiny' | 'accent' | 'loc' | 'tradeType' | 'iv' | 'looking'
> & {
  bg: Exclude<BackgroundHint, 'shadow'>;
  tags: ListingTag[];
  notes?: string;
};

/** Every granted column except `id`, so the same object serves both the insert and the retry update. */
function toFields(input: NewListingInput): Omit<ListingInsert, 'id'> {
  return {
    name: input.name,
    pokemon_id: input.pokemonId,
    form: input.form,
    catch_year: input.year,
    lucky: input.lucky,
    shiny: input.shiny,
    hue: input.hue,
    accent: input.accent,
    bg: input.bg,
    loc: input.loc,
    trade_type: input.tradeType satisfies TradeType,
    ...(parseIv(input.iv) ?? { iv_atk: null, iv_def: null, iv_sta: null }),
    looking: input.looking.map(creatureRefToJson),
    tags: input.tags,
    notes: input.notes?.trim() || null,
  };
}

/**
 * Inserts one listing and returns it as the feed would. The id is generated on the device, so a
 * retry after a partly failed publish hits the primary key (23505); the row from the first attempt
 * is still ours and still open, so the retry re-applies the latest form values to it instead.
 */
export async function insertListing(input: NewListingInput): Promise<Listing> {
  const fields = toFields(input);
  const { data, error } = await supabase
    .from('listings')
    .insert({ id: input.id, ...fields })
    .select(LISTING_COLUMNS)
    .single();
  if (!error) return toListing(data);
  if (error.code !== '23505') throw apiError(error);

  const retried = await supabase.from('listings').update(fields).eq('id', input.id).select(LISTING_COLUMNS).single();
  if (retried.error) throw apiError(retried.error);
  return toListing(retried.data);
}

export interface ProofUploadInput {
  kind: ProofKind;
  data: ArrayBuffer;
  /** Sent explicitly: the storage client cannot infer it from an ArrayBuffer. */
  contentType: string;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ListingsApiError('Not signed in.', 'no_session');
  return data.session.user.id;
}

/**
 * Stores one proof screenshot at `<uid>/<listing id>/<kind>` and records it in `listing_proofs`.
 * The storage policy only accepts a path inside the caller's own folder for a listing that already
 * exists, is open and is theirs, so the listing row must be inserted first. Safe to retry: a leftover
 * object is replaced (there is no upsert policy, so delete then upload) and a duplicate row is fine.
 */
export async function uploadListingProof(listingId: string, proof: ProofUploadInput): Promise<void> {
  const path = `${await currentUserId()}/${listingId}/${proof.kind}`;
  const bucket = supabase.storage.from(PROOF_BUCKET);
  const options = { contentType: proof.contentType, upsert: false };

  let { error } = await bucket.upload(path, proof.data, options);
  if (error && 'statusCode' in error && String(error.statusCode) === '409') {
    const removed = await bucket.remove([path]);
    if (removed.error) throw apiError(removed.error);
    ({ error } = await bucket.upload(path, proof.data, options));
  }
  if (error) throw apiError(error);

  const { error: rowError } = await supabase
    .from('listing_proofs')
    .insert({ listing_id: listingId, kind: proof.kind, storage_path: path });
  if (rowError && rowError.code !== '23505') throw apiError(rowError);
}

/**
 * Creates the listing, then attaches its proofs. Every step is idempotent for a given
 * `input.id`, so after a `PublishListingError` the caller can simply call this again.
 */
export async function publishListing(input: NewListingInput, proofs: ProofUploadInput[]): Promise<Listing> {
  let listing: Listing;
  try {
    listing = await insertListing(input);
  } catch (error) {
    throw new PublishListingError(error instanceof ListingsApiError ? error : apiError(error as Error), 'listing', false);
  }

  for (const proof of proofs) {
    try {
      await uploadListingProof(listing.id, proof);
    } catch (error) {
      throw new PublishListingError(
        error instanceof ListingsApiError ? error : apiError(error as Error),
        'proof',
        true
      );
    }
  }
  return listing;
}
