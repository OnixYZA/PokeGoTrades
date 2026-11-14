/**
 * The pure rules for a listing leaving the marketplace: which statuses the feed shows, and what withdrawing
 * a listing does to the cached listing and to every chat on it.
 *
 * Like `store/lock-state.ts`, this lives apart from `trade-store.tsx` on purpose: that module reaches
 * `expo-crypto`, `react-native` and a Supabase client that throws at import time without env vars, so
 * nothing inside it can be unit-tested. Everything here is dependency-free (type-only imports of the app's
 * data types plus the sibling lock reducers) and tested directly (`store/listing-lifecycle.test.ts`).
 */
import type { Chat, Listing, ListingStatus } from '@/data/types';

import { applyListingStatus } from './lock-state';

/** Statuses the feed shows (SUPABASE_PLAN.md §1.8: completed and withdrawn listings are hidden). */
export const FEED_STATUSES: readonly ListingStatus[] = ['open', 'locked'];

/** Whether a listing belongs in the feed. Mock seeds carry no status and are always visible. */
export function isFeedVisible(listing: Pick<Listing, 'status'>): boolean {
  return listing.status === undefined || FEED_STATUSES.includes(listing.status);
}

/**
 * Why `withdraw_listing` would refuse this listing right now, as the RPC's own error code (so the sentence comes
 * from `lib/rpc-errors.ts`), or `null` when it may be withdrawn. The ONE rule both the detail screen (which
 * button state to show) and the store (whether to call the server) read, so the two cannot disagree.
 *
 * "Locked" is either signal: the listing's own `status`, or a lock holder in `lockByListing`. The mock only ever
 * records a lock in `lockByListing`, and a live `lock` event can arrive before its `listing_status` event, so
 * the status alone would show an enabled button the store then refuses.
 */
export function withdrawRefusal(
  listing: Pick<Listing, 'status'> | undefined,
  lockHeld: boolean,
): 'unlock_first' | 'not_open' | null {
  if (listing?.status === 'locked' || lockHeld) return 'unlock_first';
  if (listing?.status !== undefined && listing.status !== 'open') return 'not_open';
  return null;
}

/** The slice of the store a withdrawal rewrites. Narrower than `TradeState`, so tests use plain literals. */
export interface WithdrawSlice {
  listings: Record<string, Listing>;
  chats: Record<string, Chat>;
  lockByListing: Record<string, string>;
}

/**
 * What `withdraw_listing` (supabase/migrations/20260916000500_rpcs.sql) leaves behind, applied locally so the
 * UI does not wait for the realtime round trip: the listing becomes `withdrawn` (through
 * `applyListingStatus`, so `lockByListing` is cleared exactly as a realtime event would clear it) and every
 * open chat on it is closed.
 *
 * - A live chat that is still `open` becomes `closed`. A bailed or completed chat keeps its own, more
 *   specific, status — the RPC only closes open chats.
 * - A mock chat has no `status`, and the mock renders an inactive chat as LOCKED, so it is retired the way
 *   mock `confirmTrade` retires one: `active: false, archived: true`.
 * - Chats on other listings are untouched. A listing that is not cached still closes its chats.
 *
 * Returns new objects; never mutates the input.
 */
export function applyListingWithdrawn(state: WithdrawSlice, listingId: string): WithdrawSlice {
  const { listings, lockByListing } = applyListingStatus(state, listingId, 'withdrawn');
  const chats: Record<string, Chat> = {};
  for (const [id, chat] of Object.entries(state.chats)) {
    if (chat.listingId !== listingId) {
      chats[id] = chat;
    } else if (chat.myRole !== undefined) {
      chats[id] = chat.status === 'open' ? { ...chat, status: 'closed' } : chat;
    } else {
      chats[id] = { ...chat, active: false, archived: true };
    }
  }
  return { listings, chats, lockByListing };
}
