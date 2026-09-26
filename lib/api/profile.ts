import { randomUUID } from 'expo-crypto';

import { findPokemon } from '@/constants/pokedex';
import type { CreatureRef } from '@/data/types';
import type { Database, Json } from '@/lib/database.types';
import type { PickedProof } from '@/lib/proof-image';
import { readProofBytes } from '@/lib/proof-image';
import { supabase } from '@/lib/supabase';

export type Team = Database['public']['Enums']['team_name'];
export type CreatureList = Database['public']['Enums']['creature_list'];

export const TEAMS: readonly Team[] = ['Mystic', 'Valor', 'Instinct'];

/** `profiles.handle` CHECK: URL-safe, 3-15 characters. */
export const HANDLE_PATTERN = /^[A-Za-z0-9]{3,15}$/;
/** The signup trigger hands out `Trainer` + 8 digits; the guard trigger refuses to let anyone pick one. */
const PLACEHOLDER_HANDLE_PATTERN = /^Trainer[0-9]{8}$/;
/** `profile_private.friend_code` CHECK: exactly 12 digits, stored raw. */
export const FRIEND_CODE_LENGTH = 12;

export interface MyProfile {
  id: string;
  handle: string;
  handleIsPlaceholder: boolean;
  team: Team | null;
  friendCode: string | null;
}

/** A problem with the profile form that should be shown next to a field. */
export class ProfileError extends Error {
  readonly field: 'handle' | 'team' | 'friendCode' | 'form';

  constructor(field: ProfileError['field'], message: string) {
    super(message);
    this.name = 'ProfileError';
    this.field = field;
  }
}

/** Digits only, capped at 12, grouped for typing: '284199037715' -> '2841 9903 7715'. */
export function formatFriendCode(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, FRIEND_CODE_LENGTH);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function friendCodeDigits(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Client-side mirror of `private.profile_ready()` (migration …000300), which is not callable from
 * the client: a permanent account with a chosen handle, a team and a friend code. Listing, offering
 * and chatting are refused by RLS until it is true.
 */
export function isProfileReady(profile: MyProfile): boolean {
  return !profile.handleIsPlaceholder && profile.team !== null && profile.friendCode !== null;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ProfileError('form', 'You are signed out. Reopen the app and try again.');
  return data.session.user.id;
}

/** The signed-in trainer's own profile, including the private friend code (owner-only under RLS). */
export async function fetchMyProfile(): Promise<MyProfile> {
  const id = await currentUserId();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, handle_is_placeholder, team, profile_private(friend_code)')
    .eq('id', id)
    .single();
  if (error) throw new ProfileError('form', error.message);
  return {
    id: data.id,
    handle: data.handle,
    handleIsPlaceholder: data.handle_is_placeholder,
    team: data.team,
    friendCode: data.profile_private?.friend_code ?? null,
  };
}

/** Whether this session may create listings right now, for gating the "new listing" button. */
export async function getPostingReadiness(): Promise<'anonymous' | 'incomplete' | 'ready'> {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.is_anonymous) return 'anonymous';
  return isProfileReady(await fetchMyProfile()) ? 'ready' : 'incomplete';
}

/** Shared by `fetchMyArsenal` and `fetchMyWishlist`: the signed-in trainer's own creatures in one
 *  list, in slot order. Readable by anyone; owned by them. Parsed defensively, the way
 *  `fetchLatestProfileProof` reads `ocr_extracted`: this client never validates jsonb against a schema. */
async function fetchMyCreatures(list: CreatureList): Promise<CreatureRef[]> {
  const id = await currentUserId();
  const { data, error } = await supabase
    .from('trainer_creatures')
    .select('creature')
    .eq('owner_id', id)
    .eq('list', list)
    .order('sort_order', { ascending: true });
  if (error) throw new ProfileError('form', error.message);
  const creatures: CreatureRef[] = [];
  for (const { creature } of data) {
    if (typeof creature !== 'object' || creature === null || Array.isArray(creature)) continue;
    const { name, pokemonId, hue, shiny, lucky } = creature;
    if (typeof name !== 'string' || typeof pokemonId !== 'number' || typeof hue !== 'number') continue;
    creatures.push({ name, pokemonId, hue, ...(shiny === true ? { shiny } : {}), ...(lucky === true ? { lucky } : {}) });
  }
  return creatures;
}

/** The signed-in trainer's Arsenal (what they can offer), in slot order. */
export async function fetchMyArsenal(): Promise<CreatureRef[]> {
  return fetchMyCreatures('arsenal');
}

/** The signed-in trainer's Wishlist (what they're hunting), in slot order. */
export async function fetchMyWishlist(): Promise<CreatureRef[]> {
  return fetchMyCreatures('wishlist');
}

/** `trainer_creatures_slot_key` caps each list at 50 rows (`sort_order` 0..49). */
const MAX_TRAINER_CREATURE_SLOTS = 50;
const CREATURE_LIST_LABEL: Record<CreatureList, string> = { arsenal: 'Arsenal', wishlist: 'Wishlist' };

/** The lowest sort_order in 0..49 not already occupied in this list, or null when all 50 are taken.
 *  A read-then-insert has an inherent race (see `addCreature`'s retry), but it's the only way to pick
 *  a slot at all: `sort_order` has no server-side "next free value" the client could ask for instead. */
async function firstFreeSlot(ownerId: string, list: CreatureList): Promise<number | null> {
  const { data, error } = await supabase
    .from('trainer_creatures')
    .select('sort_order')
    .eq('owner_id', ownerId)
    .eq('list', list);
  if (error) throw new ProfileError('form', error.message);
  const used = new Set(data.map((row) => row.sort_order));
  for (let slot = 0; slot < MAX_TRAINER_CREATURE_SLOTS; slot++) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/** How many times to re-pick a slot after losing a race to a concurrent insert (see the `23505`
 *  branch below) before giving up and surfacing the error — covers "two taps in a row" without
 *  retrying forever against a genuinely full list. */
const ADD_CREATURE_ATTEMPTS = 3;

/**
 * Shared by `addToArsenal` / `addToWishlist`. The stored `name` and `hue` are always read back out of
 * the pokedex by `pokemonId` — never taken from the caller — so a trainer's Arsenal/Wishlist entry can
 * never drift from the one source of truth for what a Pokémon is called or how it's colored (AGENTS.md:
 * never hallucinate game data).
 */
async function addCreature(list: CreatureList, pokemonId: number): Promise<void> {
  const entry = findPokemon(pokemonId);
  if (!entry) throw new ProfileError('form', "That Pokémon isn't in the dex.");
  // A fresh object literal, not a `CreatureRef`-typed value: `creature_ref_is_valid` (the DB check
  // constraint) would reject a `CreatureRef` variable's `shiny`/`lucky` if either were `undefined`
  // rather than omitted, and `Json` has no room for that key even so — see `creatureRefToJson` in
  // lib/api/listings.ts for the same shape used to insert `looking`.
  const creature: Json = { name: entry.name, pokemonId: entry.pokemonId, hue: entry.hue };
  const ownerId = await currentUserId();

  for (let attempt = 1; attempt <= ADD_CREATURE_ATTEMPTS; attempt++) {
    const slot = await firstFreeSlot(ownerId, list);
    if (slot === null) throw new ProfileError('form', `Your ${CREATURE_LIST_LABEL[list]} is full (50).`);

    const { error } = await supabase.from('trainer_creatures').insert({ list, creature, sort_order: slot });
    if (!error) return;
    // Another insert (a second tap, another tab) took this exact slot between the read above and this
    // write — re-read the now-current free slots and try again, rather than surfacing a confusing
    // uniqueness error for what is, from the trainer's point of view, just "add this Pokémon".
    if (error.code !== '23505' || attempt === ADD_CREATURE_ATTEMPTS) throw new ProfileError('form', error.message);
  }
}

/** Adds a Pokémon (by national dex id) to the signed-in trainer's Arsenal, in the lowest free slot. */
export async function addToArsenal(pokemonId: number): Promise<void> {
  return addCreature('arsenal', pokemonId);
}

/** Adds a Pokémon (by national dex id) to the signed-in trainer's Wishlist, in the lowest free slot. */
export async function addToWishlist(pokemonId: number): Promise<void> {
  return addCreature('wishlist', pokemonId);
}

export interface ProfileInput {
  handle: string;
  team: Team;
  friendCode: string;
}

/**
 * Completes the profile with two direct updates (column-granted, owner-only RLS), after which
 * `private.profile_ready()` is true. Re-running with the same values is harmless, so a failure on the
 * second update (say, a taken friend code) leaves a form the trainer can just correct and resubmit.
 */
export async function saveProfile(input: ProfileInput): Promise<void> {
  const handle = input.handle.trim();
  const friendCode = friendCodeDigits(input.friendCode);

  if (!HANDLE_PATTERN.test(handle)) {
    throw new ProfileError('handle', 'Use 3 to 15 letters or digits, no spaces.');
  }
  if (PLACEHOLDER_HANDLE_PATTERN.test(handle)) {
    throw new ProfileError('handle', 'Pick a name of your own.');
  }
  if (friendCode.length !== FRIEND_CODE_LENGTH) {
    throw new ProfileError('friendCode', `A friend code has ${FRIEND_CODE_LENGTH} digits.`);
  }

  const id = await currentUserId();

  const profile = await supabase.from('profiles').update({ handle, team: input.team }).eq('id', id).select('id');
  if (profile.error) {
    if (profile.error.code === '23505') throw new ProfileError('handle', 'That handle is taken.');
    if (profile.error.message === 'handle_reserved') throw new ProfileError('handle', 'Pick a name of your own.');
    if (profile.error.code === '23514') throw new ProfileError('handle', 'Use 3 to 15 letters or digits, no spaces.');
    throw new ProfileError('form', profile.error.message);
  }
  if (profile.data.length === 0) throw new ProfileError('form', 'Could not update your profile. Try again.');

  const priv = await supabase.from('profile_private').update({ friend_code: friendCode }).eq('user_id', id).select('user_id');
  if (priv.error) {
    if (priv.error.code === '23505') throw new ProfileError('friendCode', 'That friend code is already registered.');
    if (priv.error.code === '23514') throw new ProfileError('friendCode', `A friend code has ${FRIEND_CODE_LENGTH} digits.`);
    throw new ProfileError('form', priv.error.message);
  }
  if (priv.data.length === 0) throw new ProfileError('form', 'Could not update your profile. Try again.');
}

/** A direct column update, same shape as the two updates inside `saveProfile`: owner-only RLS, so a
 *  stale id or a signed-out session just matches zero rows rather than throwing a permission error. */
export async function saveTeam(team: Team): Promise<void> {
  const id = await currentUserId();
  const { data, error } = await supabase.from('profiles').update({ team }).eq('id', id).select('id');
  if (error) throw new ProfileError('team', error.message);
  if (data.length === 0) throw new ProfileError('team', 'Could not update your profile. Try again.');
}

// ——— profile-proof screenshots (migration …000100_profile_proofs) ———

/** Mirrors the `listing-proofs` bucket's limits (5 MiB, jpeg/png/webp) but holds trainer-code screenshots. */
export const PROFILE_PROOF_BUCKET = 'profile-proofs';

const PROFILE_PROOF_FAILURE_REASONS = [
  'unreadable',
  'image_too_large',
  'no_handle',
  'no_friend_code',
  'handle_taken',
  'friend_code_taken',
  'invalid_handle',
] as const;

/** `ocr_extracted.reason` when `ocr_status = 'failed'`, set by the Azure Function that reads the screenshot. */
export type ProfileProofFailure = (typeof PROFILE_PROOF_FAILURE_REASONS)[number];

function isProofFailureReason(value: unknown): value is ProfileProofFailure {
  return typeof value === 'string' && (PROFILE_PROOF_FAILURE_REASONS as readonly string[]).includes(value);
}

export type ProfileProofStatus = 'pending' | 'processing' | 'verified' | 'failed' | 'rejected';

export interface ProfileProof {
  id: string;
  status: ProfileProofStatus;
  /** Only set once `status` is `'failed'`. */
  reason: ProfileProofFailure | null;
  /** Whatever the OCR pass read before it gave up, so the manual fallback isn't a blank form. */
  handle: string | null;
  friendCode: string | null;
  createdAt: string;
}

/**
 * Uploads one trainer-code screenshot and records it, mirroring `uploadListingProof`'s upload-then-insert
 * shape (lib/api/listings.ts): the storage insert policy only accepts an object at `<uid>/<id>` for the
 * caller's own id, so the id is minted here and the object has to exist before the row can reference it.
 * A trainer may only have one proof in flight at a time (a partial unique index on `user_id`), so a retry
 * while one is still `pending`/`processing` fails with `23505`.
 */
export async function uploadProfileProof(proof: PickedProof): Promise<void> {
  const bytes = await readProofBytes(proof);
  const id = randomUUID();
  const path = `${await currentUserId()}/${id}`;
  const bucket = supabase.storage.from(PROFILE_PROOF_BUCKET);

  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: proof.contentType, upsert: false });
  if (uploadError) throw new ProfileError('form', uploadError.message);

  const { error: insertError } = await supabase.from('profile_proofs').insert({ id, storage_path: path });
  if (insertError) {
    // Best-effort: clients have no delete policy on this bucket (see the migration's doc comment), so
    // this may simply be refused. The row insert never happened either way, so nothing else can ever
    // reference the object — an orphan left behind here is harmless.
    await bucket.remove([path]);
    if (insertError.code === '23505') throw new ProfileError('form', 'Your last screenshot is still being read.');
    throw new ProfileError('form', insertError.message);
  }
}

/**
 * The newest of the signed-in trainer's own proof uploads, or null when they have never tried one.
 * Reads `ocr_extracted` defensively, the way `fetchMyArsenal` reads `looking`: it is a service-role
 * write this client never validates against a schema.
 */
export async function fetchLatestProfileProof(): Promise<ProfileProof | null> {
  const id = await currentUserId();
  const { data, error } = await supabase
    .from('profile_proofs')
    .select('id, ocr_status, ocr_extracted, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ProfileError('form', error.message);
  if (!data) return null;

  const extracted = data.ocr_extracted;
  const fields: Record<string, unknown> =
    typeof extracted === 'object' && extracted !== null && !Array.isArray(extracted) ? extracted : {};

  return {
    id: data.id,
    status: data.ocr_status as ProfileProofStatus,
    reason: isProofFailureReason(fields.reason) ? fields.reason : null,
    handle: typeof fields.handle === 'string' ? fields.handle : null,
    friendCode: typeof fields.friendCode === 'string' ? fields.friendCode : null,
    createdAt: data.created_at,
  };
}

/** A friendly sentence per failure reason (see the `profile_proofs` migration's doc comment on `ocr_extracted`). */
export function describeProofFailure(reason: ProfileProofFailure): string {
  switch (reason) {
    case 'unreadable':
      return "We couldn't read that screenshot. Try a brighter, uncropped shot of the My Trainer Code screen.";
    case 'image_too_large':
      return 'That image was too large to process. Try a smaller screenshot.';
    case 'no_handle':
      return "We couldn't find a trainer name on that screenshot.";
    case 'no_friend_code':
      return "We couldn't find a friend code on that screenshot.";
    case 'handle_taken':
      return "That trainer name is already registered here. If it's yours, enter your details manually and contact support.";
    case 'friend_code_taken':
      return "That friend code is already registered here. If it's yours, enter your details manually and contact support.";
    case 'invalid_handle':
      return "That trainer name isn't in a format we accept. Enter it manually instead.";
    default:
      return 'Something went wrong reading that screenshot.';
  }
}
