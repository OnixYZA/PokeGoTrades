/**
 * The pure reducers behind the trade lock: how a lock frame, a listing-status frame or a fresh read
 * changes what the client believes about who holds which listing and who has confirmed.
 *
 * These live apart from `trade-store.tsx` on purpose. That module reaches `expo-crypto`, `react-native`
 * and a Supabase client that throws at import time without env vars, so nothing inside it can be exercised
 * without standing up most of the app. The rules below are the part that is actually easy to get wrong —
 * stale-frame ordering especially — so they are kept free of every runtime dependency and tested directly
 * (`store/lock-state.test.ts`). `trade-store.tsx` re-exports what the rest of the app already imported.
 */
import type { ChatRole, Listing, ListingStatus } from '@/data/types';
import type { LockEvent, TradeLockRow } from '@/lib/api/chats';

/** `lockByListing` value when the listing is locked but the lock is not visible to me: a competing
 *  buyer only ever learns "frozen", never who won (SUPABASE_PLAN.md §4.2). */
export const LOCK_HELD_ELSEWHERE = '__elsewhere__' as const;

/** Each side's confirmation timestamp for the chat that holds a listing's lock (D2). */
export interface LockConfirmations {
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
}

/**
 * The slice of the store these reducers read. Narrower than `TradeState` so the rules can be exercised
 * with a handful of literals instead of a whole store.
 */
export interface LockSlice {
  /** listingId -> the one chat holding that listing's lock (or `LOCK_HELD_ELSEWHERE`). */
  lockByListing: Record<string, string>;
  /** chatId -> each side's confirmation of the trade that chat holds. */
  lockConfirmations: Record<string, LockConfirmations>;
  /** chatId -> `trade_locks.updated_at` of the newest lock state applied. See `isStaleLock`. */
  lockEventVersion: Record<string, string>;
  /** A chat whose Handshake should open by itself: the buyer's, when the seller locks (D1). */
  handshakeRequest: string | null;
  /** Only `myRole` is read, to decide whose Handshake auto-opens. */
  chats: Record<string, { myRole?: ChatRole }>;
  listings: Record<string, Listing>;
}

/**
 * True when this observation of a lock is older than what we already applied for that chat.
 *
 * A release is never stale: the row is gone, and `updated_at` on a DELETE is the value the row held before
 * it was removed, so it can legitimately look older than a confirmation that preceded it. Ignoring a
 * release would strand the UI on a lock that no longer exists, which is far worse than replaying one.
 */
export function isStaleLock(
  state: Pick<LockSlice, 'lockEventVersion'>,
  chatId: string,
  updatedAt: string | null,
  released: boolean,
): boolean {
  if (released || !updatedAt) return false; // unordered payload (pre-migration server): apply it
  const seen = state.lockEventVersion[chatId];
  return seen !== undefined && updatedAt < seen;
}

/**
 * What a lock reducer writes back. Only the lock fields — `chats` and `listings` are read, never written,
 * so they stay out of the patch and it drops straight into the store's `set()`.
 */
export type LockPatch = Partial<
  Pick<LockSlice, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion' | 'handshakeRequest'>
>;

export function applyLockEvent(state: LockSlice, event: LockEvent): LockPatch {
  if (isStaleLock(state, event.chatId, event.updatedAt, event.released)) return {};

  const lockByListing = { ...state.lockByListing };
  const lockConfirmations = { ...state.lockConfirmations };
  const lockEventVersion = { ...state.lockEventVersion };
  let handshakeRequest = state.handshakeRequest;

  if (event.updatedAt) lockEventVersion[event.chatId] = event.updatedAt;

  if (event.released) {
    if (lockByListing[event.listingId] === event.chatId) delete lockByListing[event.listingId];
    delete lockConfirmations[event.chatId];
    delete lockEventVersion[event.chatId]; // the lock is gone; a later lock on this chat starts fresh
    if (handshakeRequest === event.chatId) handshakeRequest = null;
  } else {
    lockByListing[event.listingId] = event.chatId;
    lockConfirmations[event.chatId] = {
      sellerConfirmedAt: event.sellerConfirmedAt,
      buyerConfirmedAt: event.buyerConfirmedAt,
    };
    // D1: the seller locked *my* offer, so my Handshake opens by itself.
    if (event.op === 'insert' && state.chats[event.chatId]?.myRole === 'buyer') handshakeRequest = event.chatId;
  }
  return { lockByListing, lockConfirmations, lockEventVersion, handshakeRequest };
}

/**
 * Rebuilds lock state from a fresh read (SUPABASE_PLAN.md §4.2): for each listing whose status is known,
 * `locked` maps to the visible lock's chat, or to `LOCK_HELD_ELSEWHERE` when its holder is hidden from me,
 * and anything else clears it. Confirmations come from the locks I am a party to.
 */
export function lockSnapshot(
  state: Pick<LockSlice, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion'>,
  locks: TradeLockRow[],
  listings: Listing[],
  /** When this read left the client. Anything learned since is newer than the read, by construction. */
  readAt: string,
): Pick<LockSlice, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion'> {
  const holders = new Map(locks.map((lock) => [lock.listing_id, lock.chat_id]));
  const lockByListing = { ...state.lockByListing };
  for (const listing of listings) {
    if (listing.status === 'locked') lockByListing[listing.id] = holders.get(listing.id) ?? LOCK_HELD_ELSEWHERE;
    else if (listing.status !== undefined) delete lockByListing[listing.id];
  }

  const lockConfirmations: Record<string, LockConfirmations> = {};
  const lockEventVersion: Record<string, string> = {};

  // A lock we learned about after this read was issued cannot be overruled by it — not its confirmations,
  // and not the fact that it exists. Rebuilding blindly from the response is what let a slow hydrate
  // un-confirm a trade that had been confirmed while it was in flight.
  for (const [chatId, version] of Object.entries(state.lockEventVersion)) {
    const current = state.lockConfirmations[chatId];
    if (version >= readAt && current) {
      lockConfirmations[chatId] = current;
      lockEventVersion[chatId] = version;
    }
  }

  for (const lock of locks) {
    if (lock.chat_id in lockConfirmations) continue; // a newer local observation already won
    lockConfirmations[lock.chat_id] = {
      sellerConfirmedAt: lock.seller_confirmed_at,
      buyerConfirmedAt: lock.buyer_confirmed_at,
    };
    lockEventVersion[lock.chat_id] = lock.updated_at;
  }
  return { lockByListing, lockConfirmations, lockEventVersion };
}

export function applyListingStatus(
  state: Pick<LockSlice, 'lockByListing' | 'listings'>,
  listingId: string,
  status: ListingStatus,
): Pick<LockSlice, 'lockByListing' | 'listings'> {
  const listing = state.listings[listingId];
  const lockByListing = { ...state.lockByListing };
  if (status === 'locked') {
    // A `lock` event names the holder and always wins; without one, the lock is held elsewhere.
    lockByListing[listingId] ??= LOCK_HELD_ELSEWHERE;
  } else {
    delete lockByListing[listingId];
  }
  return {
    lockByListing,
    listings: listing ? { ...state.listings, [listingId]: { ...listing, status } } : state.listings,
  };
}
