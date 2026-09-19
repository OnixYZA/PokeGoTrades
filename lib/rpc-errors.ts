/**
 * Turns the failures of the trade RPCs and chat writes into sentences for the UI (SUPABASE_PLAN.md
 * §2.4). An RPC raises `sqlstate 'PTxxx' using message = '<stable code>'`, which PostgREST returns as
 * HTTP xxx with `{ code: 'PTxxx', message: '<stable code>' }` — so the *message* is what the client
 * switches on, and the sqlstate is only a class (403 forbidden, 409 conflict, 429 rate limit).
 */

/** What the caller should do besides telling the trainer. */
export type FollowUp =
  /** Local state may be stale: refetch inbox, locks and listings. */
  | 'resync'
  /** The account is not ready to write: send the trainer to onboarding. */
  | 'onboarding'
  /** Nothing to reconcile. */
  | 'none';

export interface ErrorInfo {
  /** The stable RPC code ('already_locked'), a sqlstate ('42501') or 'network' / 'unknown'. */
  code: string;
  /** Postgres sqlstate when the server sent one ('PT409', '23505', '42501'). */
  sqlState?: string;
  message: string;
  followUp: FollowUp;
  /** The failed action means the handshake / lock it was acting on is gone. */
  lockGone?: boolean;
}

const KNOWN: Record<string, Omit<ErrorInfo, 'code' | 'sqlState'>> = {
  already_locked: { message: 'You already locked another offer on this listing.', followUp: 'resync' },
  not_lockable: { message: 'This trade can no longer be locked.', followUp: 'resync' },
  not_seller: { message: 'Only the seller can do that.', followUp: 'none' },
  not_lock_holder: { message: 'This trade is no longer locked.', followUp: 'resync', lockGone: true },
  no_active_lock: { message: 'This trade is no longer locked.', followUp: 'resync', lockGone: true },
  handshake_unavailable: { message: 'This trade is no longer locked.', followUp: 'resync', lockGone: true },
  nothing_to_withdraw: { message: 'Your confirmation already changed. Refreshing.', followUp: 'resync' },
  chat_not_open: { message: 'This chat was closed.', followUp: 'resync' },
  not_participant: { message: 'You are not part of this trade.', followUp: 'resync' },
  listing_not_open: {
    message: 'This listing is no longer open. It may have been locked by another trainer.',
    followUp: 'resync',
  },
  // Deliberately generic on the server, so it never says who blocked whom. Keep it that way here.
  offer_not_allowed: { message: 'You cannot make an offer on this listing.', followUp: 'none' },
  own_listing: { message: 'You cannot make an offer on your own listing.', followUp: 'none' },
  permanent_account_required: { message: 'Verify your email to continue.', followUp: 'onboarding' },
  profile_incomplete: { message: 'Finish your trainer profile to continue.', followUp: 'onboarding' },
  rate_limited: { message: 'You are doing that too fast. Try again in a moment.', followUp: 'none' },
  invalid_offer_message: { message: 'That offer is no longer valid.', followUp: 'resync' },
  invalid_offer: { message: 'That offer was rejected. Pick another.', followUp: 'none' },
  empty_offer: { message: 'Add an offer or a message first.', followUp: 'none' },
  client_id_required: { message: 'Something went wrong sending that. Try again.', followUp: 'none' },
  note_too_long: { message: 'That note is too long.', followUp: 'none' },
};

const NETWORK_HINTS = ['network request failed', 'failed to fetch', 'fetch failed', 'network error', 'timed out'];

function isNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return NETWORK_HINTS.some((hint) => lower.includes(hint));
}

/** Accepts a PostgREST error, our `ChatApiError`, or anything thrown. */
export function describeError(error: unknown): ErrorInfo {
  const raw = (error ?? {}) as { message?: unknown; code?: unknown; sqlState?: unknown };
  const message = typeof raw.message === 'string' ? raw.message : '';
  const sqlState =
    typeof raw.sqlState === 'string' ? raw.sqlState : typeof raw.code === 'string' && raw.code ? raw.code : undefined;

  const known = KNOWN[message];
  if (known) return { code: message, sqlState, ...known };

  if (sqlState === '42501') {
    // RLS refused a write: the chat is frozen, closed, bailed or blocked (or the account is not ready).
    return {
      code: '42501',
      sqlState,
      message: 'You cannot post in this chat right now. It may be frozen or closed.',
      followUp: 'resync',
    };
  }
  if (sqlState === 'PT429') return { code: 'rate_limited', sqlState, ...KNOWN.rate_limited };
  if (isNetworkFailure(message)) {
    return { code: 'network', sqlState, message: 'Network problem. Check your connection and try again.', followUp: 'none' };
  }
  return { code: sqlState ?? 'unknown', sqlState, message: message || 'Something went wrong. Try again.', followUp: 'none' };
}
