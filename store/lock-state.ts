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
 * How one chat's lock state is ordered. Two questions need answering and they need different answers,
 * which is why this is a pair and not a single value:
 *
 * - "Is this frame older than the server state I already applied?" orders two *server* writes, possibly
 *   made on the partner's device. Only the server can order those, so that is `updatedAt`
 *   (`trade_locks.updated_at`). A local counter cannot answer it: frames arrive carrying no local
 *   sequence, so stamping them on arrival would make every frame look newest and the guard a no-op.
 * - "Did I learn this after that read was issued?" is entirely about events on *this device*, so it needs
 *   no clock at all — just `seq`, a local counter that only ever goes up. This used to be a client
 *   `new Date()` compared against a server timestamp, which is a comparison between two unrelated clocks:
 *   a device running fast would discard lock state it had correctly learned.
 *
 * `updatedAt` is null when the entry came from a purely local optimistic write (an RPC that reports no
 * timestamp) or from a server too old to send one. `seq` is always meaningful.
 */
export interface LockVersion {
  updatedAt: string | null;
  seq: number;
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
  /** chatId -> what we know about the ordering of that chat's lock state. See `LockVersion`. */
  lockEventVersion: Record<string, LockVersion>;
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
  const seen = state.lockEventVersion[chatId]?.updatedAt;
  // Nothing server-stamped to compare against (first sighting, or the last write was a local one whose
  // server timestamp we never learned): there is no basis to call this frame stale, so let it through.
  return seen !== undefined && seen !== null && updatedAt < seen;
}

/**
 * What a lock reducer writes back. Only the lock fields — `chats` and `listings` are read, never written,
 * so they stay out of the patch and it drops straight into the store's `set()`.
 */
export type LockPatch = Partial<
  Pick<LockSlice, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion' | 'handshakeRequest'>
>;

/**
 * @param seq the caller's next local sequence number — see `LockVersion.seq`. Passed in rather than read
 * from a counter here so these reducers stay pure and can be exercised with plain literals.
 */
export function applyLockEvent(state: LockSlice, event: LockEvent, seq: number): LockPatch {
  if (isStaleLock(state, event.chatId, event.updatedAt, event.released)) return {};

  const lockByListing = { ...state.lockByListing };
  const lockConfirmations = { ...state.lockConfirmations };
  const lockEventVersion = { ...state.lockEventVersion };
  let handshakeRequest = state.handshakeRequest;

  // Applying anything at all is something this device just learned, so `seq` always advances — even for a
  // payload that carried no server timestamp, which is what keeps `lockSnapshot` from overruling it.
  // A frame without its own `updatedAt` keeps whatever server token we already held.
  lockEventVersion[event.chatId] = {
    updatedAt: event.updatedAt ?? state.lockEventVersion[event.chatId]?.updatedAt ?? null,
    seq,
  };

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
  /**
   * The local sequence number taken when this read was issued. Anything this device learned afterwards
   * carries a higher `seq`, by construction — no clock is consulted on either side of that comparison.
   */
  readSeq: number,
): Pick<LockSlice, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion'> {
  const holders = new Map(locks.map((lock) => [lock.listing_id, lock.chat_id]));
  const lockByListing = { ...state.lockByListing };
  for (const listing of listings) {
    if (listing.status === 'locked') lockByListing[listing.id] = holders.get(listing.id) ?? LOCK_HELD_ELSEWHERE;
    else if (listing.status !== undefined) delete lockByListing[listing.id];
  }

  const lockConfirmations: Record<string, LockConfirmations> = {};
  const lockEventVersion: Record<string, LockVersion> = {};

  // A lock we learned about after this read was issued cannot be overruled by it — not its confirmations,
  // and not the fact that it exists. Rebuilding blindly from the response is what let a slow hydrate
  // un-confirm a trade that had been confirmed while it was in flight.
  for (const [chatId, version] of Object.entries(state.lockEventVersion)) {
    const current = state.lockConfirmations[chatId];
    if (version.seq > readSeq && current) {
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
    // These rows are what this read knows, so they carry the read's own sequence number.
    lockEventVersion[lock.chat_id] = { updatedAt: lock.updated_at, seq: readSeq };
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
