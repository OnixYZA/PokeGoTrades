import type { Database } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type Team = Database['public']['Enums']['team_name'];

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
