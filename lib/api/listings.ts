import type { QueryData } from '@supabase/supabase-js';

import {
  LISTING_TAGS,
  POKEBALLS,
  POKEMON_SIZES,
  TRADE_TIMELINES,
  type FilterEnumField,
  type FilterFlagField,
  type PokemonSize,
} from '@/constants/listing-attributes';
import type { FilterSpec } from '@/store/listing-filters';
import type { BackgroundHint, Listing, TradeType } from '@/data/types';
import { creatureRefToJson, parseCreatureRefs } from '@/lib/api/creature-ref';
import type { Database } from '@/lib/database.types';
import { describeError } from '@/lib/rpc-errors';
import { supabase } from '@/lib/supabase';

// ——— DB-derived types ———

type ListingInsert = Database['public']['Tables']['listings']['Insert'];

export type ListingTag = Database['public']['Enums']['listing_tag'];
export type ProofKind = Database['public']['Enums']['proof_kind'];

// Compile-time guarantee the constants/listing-attributes.ts registries stay in lockstep with the
// generated DB enums: if a migration adds, removes or renames a value on one side without a matching
// edit on the other, this fails to typecheck instead of silently drifting (`npx tsc --noEmit` catches
// it immediately, long before a filter chip or a create-listing field could go quietly out of sync).
// Boxing each side in a tuple (`[A]`) stops the conditional from distributing over the union, so this
// checks the two unions are the same set, not that every member of one merely extends the other.
type AssertSameMembers<A extends string, B extends string> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// `never` would satisfy `extends true` trivially, so the assertion must resolve to the literal
// `false` on a mismatch (above) for this gate to actually fail a build.
type Expect<T extends true> = T;
type _ListingTagsMatchDb = Expect<AssertSameMembers<(typeof LISTING_TAGS)[number], Database['public']['Enums']['listing_tag']>>;
type _PokeballsMatchDb = Expect<AssertSameMembers<(typeof POKEBALLS)[number], Database['public']['Enums']['pokeball']>>;
type _PokemonSizesMatchDb = Expect<AssertSameMembers<(typeof POKEMON_SIZES)[number], Database['public']['Enums']['pokemon_size']>>;
type _TradeTimelinesMatchDb = Expect<AssertSameMembers<(typeof TRADE_TIMELINES)[number], Database['public']['Enums']['trade_timeline']>>;

/** `FilterFlagField` (Listing camelCase) -> the actual `listings` column. Only `willTravel` differs. */
const FLAG_DB_COLUMNS: Record<FilterFlagField, 'shiny' | 'lucky' | 'purified' | 'costume' | 'will_travel'> = {
  shiny: 'shiny',
  lucky: 'lucky',
  purified: 'purified',
  costume: 'costume',
  willTravel: 'will_travel',
};

/** `FilterEnumField` (Listing camelCase) -> the actual `listings` column. */
const ENUM_DB_COLUMNS: Record<FilterEnumField, 'size_class' | 'pokeball' | 'trade_timeline'> = {
  sizeClass: 'size_class',
  pokeball: 'pokeball',
  tradeTimeline: 'trade_timeline',
};

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
  // A trigger's `raise sqlstate 'PTxxx' using message = '<stable code>'` (e.g. `untradable_pokemon_listed`)
  // shares one code -> sentence table with the RPCs.
  if (error.code?.startsWith('PT')) return describeError(error).message;
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

/**
 * Everything the feed card and the detail sheet render, plus the seller's handle. `demand_rank`
 * deliberately is not here: clients must stop reading it (it is never written by clients and always
 * reads 'NEW' live) in favor of the `pokemon_market_demand` view, fetched separately in `lib/use-feed.ts`.
 */
const LISTING_COLUMNS =
  'id, seller_id, status, name, pokemon_id, form, form_code, costume_code, catch_year, lucky, shiny, hue, accent, bg, loc, pvp_rank, trade_type, iv_atk, iv_def, iv_sta, looking, tags, notes, untradable, purified, costume, pokeball, size_class, will_travel, trade_timeline, created_at, seller:profiles!listings_seller_id_fkey(handle)';

function selectListings() {
  return supabase.from('listings').select(LISTING_COLUMNS);
}

type ListingRow = QueryData<ReturnType<typeof selectListings>>[number];

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
    ...(row.form_code ? { formCode: row.form_code } : {}),
    ...(row.costume_code ? { costumeCode: row.costume_code } : {}),
    year: row.catch_year,
    lucky: row.lucky,
    shiny: row.shiny,
    hue: row.hue,
    accent: row.accent,
    bg: row.bg,
    loc: row.loc,
    pvp: row.pvp_rank,
    tradeType: row.trade_type,
    iv: formatIv(row),
    looking: parseCreatureRefs(row.looking),
    untradable: row.untradable,
    tags: row.tags,
    notes: row.notes ?? undefined,
    purified: row.purified,
    costume: row.costume,
    pokeball: row.pokeball,
    sizeClass: row.size_class,
    willTravel: row.will_travel,
    tradeTimeline: row.trade_timeline,
  };
}

type ListingsQuery = ReturnType<typeof selectListings>;

/**
 * The handful of PostgREST filter builder methods this needs to call with a column name chosen at
 * runtime (from `FilterSpec`), rather than a literal written at the call site. The real builder
 * types `.eq()` / `.in()` per literal `ColumnName` (so `.eq('shiny', true)` is checked against
 * `shiny`'s exact column type) — exactly the thing a spec-driven loop cannot give it, since the
 * column varies per iteration and the flag/enum columns do not all share one value type. This is the
 * one deliberate loosening in this file; every other column name here is still a compile-time literal.
 */
interface DynamicColumnFilter {
  eq(column: string, value: unknown): unknown;
  in(column: string, values: readonly unknown[]): unknown;
}

/**
 * The PostgREST twin of `matchesFilter` (store/listing-filters.ts) — same semantics, different
 * engine. Keep the two in sync: a change to one without the other means the live feed and the mock
 * feed disagree about what a filter chip means.
 *
 * Every postgrest-js filter method mutates the query's own `URLSearchParams` and returns `this`
 * (see node_modules/@supabase/postgrest-js's `PostgrestFilterBuilder`), so `query` itself already
 * reflects every call below — this returns the same reference it was given, not a new one.
 */
export function applyFilterSpec(query: ListingsQuery, spec: FilterSpec): ListingsQuery {
  const dynamic = query as unknown as DynamicColumnFilter;

  for (const field of Object.keys(spec.flags) as FilterFlagField[]) {
    dynamic.eq(FLAG_DB_COLUMNS[field], spec.flags[field]!);
  }

  if (spec.tagsAll.length > 0) {
    query.contains('tags', spec.tagsAll);
  }
  if (spec.tagsNone.length > 0) {
    // Quoted array literal: tag values contain spaces ("PvP Ready", "Level 1", ...).
    const literal = `{${spec.tagsNone.map((tag) => `"${tag}"`).join(',')}}`;
    query.not('tags', 'ov', literal);
  }

  for (const field of Object.keys(spec.enumIn) as FilterEnumField[]) {
    dynamic.in(ENUM_DB_COLUMNS[field], spec.enumIn[field]!);
  }
  for (const field of Object.keys(spec.enumNotIn) as FilterEnumField[]) {
    // NULL must still pass an exclude (matchesFilter's rule), so this is an OR, not a plain `.not.in`.
    const column = ENUM_DB_COLUMNS[field];
    query.or(`${column}.is.null,${column}.not.in.(${spec.enumNotIn[field]!.join(',')})`);
  }

  return query;
}

/** Open and locked listings in one area, newest first, narrowed by the compiled filter spec. */
export async function fetchFeedListings(loc: string, spec: FilterSpec): Promise<Listing[]> {
  const filtered = applyFilterSpec(selectListings().in('status', FEED_STATUSES).eq('loc', loc), spec);
  const { data, error } = await filtered.order('created_at', { ascending: false });
  if (error) throw apiError(error);
  return data.map(toListing);
}

/**
 * Specific listings, whatever their status. The feed only shows open and locked ones, but a trainer
 * keeps seeing a completed or withdrawn listing their chats reference (`listings_read` allows it).
 */
export async function fetchListingsByIds(ids: string[]): Promise<Listing[]> {
  if (ids.length === 0) return [];
  const { data, error } = await selectListings().in('id', ids);
  if (error) throw apiError(error);
  return data.map(toListing);
}

// ——— writes ———

/**
 * The listing fields a trainer supplies, and only those. The generated `Insert` type marks every
 * column writable, but the `authenticated` role is granted just these (SUPABASE_PLAN.md §2.1, plus
 * `purified`/`costume`/`pokeball`/`will_travel`/`trade_timeline` from migration …000100): `seller_id`
 * defaults to `auth.uid()`, and `status`, `pvp_rank`, `demand_rank`, `untradable` and the timestamps
 * are server-owned. Shadow backgrounds are rejected by a CHECK constraint.
 *
 * `lucky` is server-owned too: only the OCR worker may set it, once an appraisal proof backs the claim
 * (migration …000200_lock_lucky_to_service_role). PostgREST turns every key in the body into a column,
 * so sending it here — even as `false` — would now fail the insert with 42501. It is absent on purpose.
 *
 * `sizeClass` is likewise absent on purpose: it is service-role only (migration …000100's comment on
 * `listings.size_class`), so a trainer never supplies it — it is always `null` until a future OCR pass
 * fills it in server-side.
 */
export type NewListingInput = Pick<
  Listing,
  | 'id'
  | 'name'
  | 'pokemonId'
  | 'hue'
  | 'form'
  | 'year'
  | 'shiny'
  | 'accent'
  | 'loc'
  | 'tradeType'
  | 'iv'
  | 'looking'
  | 'purified'
  | 'costume'
  | 'pokeball'
  | 'willTravel'
  | 'tradeTimeline'
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
    purified: input.purified,
    costume: input.costume,
    pokeball: input.pokeball,
    will_travel: input.willTravel,
    trade_timeline: input.tradeTimeline,
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

// ——— post-publish verification (polled by CreateListingModal's 'verifying' step) ———

export type ProofOcrStatus = Database['public']['Enums']['ocr_status'];

export interface ListingProofStatus {
  id: string;
  kind: ProofKind;
  status: ProofOcrStatus;
}

export interface ListingVerification {
  proofs: ListingProofStatus[];
  /** Service-role only (see `NewListingInput`'s comment); still `null` until a verified appraisal sets it. */
  sizeClass: PokemonSize | null;
  lucky: boolean;
  /** Whether the worker upserted a private `listing_proof_private` row for this listing — never the
   *  `catch_location` value itself, which is seller-only by RLS and never rendered anywhere in the UI. */
  catchLocationSaved: boolean;
}

/**
 * One round trip: the listing's own service-role fields (`size_class`, `lucky`) plus every proof's
 * settle state, embedded via the `listing_proofs_listing_id_fkey` / `listing_proof_private_proof_id_fkey`
 * relationships. `ocr_status` is the single authoritative completion signal — the worker
 * (`workers/azure-ocr/src/core/process.ts`) writes `size_class` / `lucky` / `listing_proof_private`
 * *before* it settles a proof's `ocr_status` to `verified` | `failed` | `rejected`, so once every proof
 * here is settled those fields are final for this publish. `listing_proof_private` is selected only for
 * `proof_id` (never `catch_location`) so a location string never even reaches this client.
 */
export async function fetchListingVerification(listingId: string): Promise<ListingVerification> {
  const { data, error } = await supabase
    .from('listings')
    .select('size_class, lucky, listing_proofs(id, kind, ocr_status, listing_proof_private(proof_id))')
    .eq('id', listingId)
    .single();
  if (error) throw apiError(error);

  return {
    proofs: data.listing_proofs.map((proof) => ({ id: proof.id, kind: proof.kind, status: proof.ocr_status })),
    sizeClass: data.size_class,
    lucky: data.lucky,
    catchLocationSaved: data.listing_proofs.some((proof) => proof.listing_proof_private !== null),
  };
}
