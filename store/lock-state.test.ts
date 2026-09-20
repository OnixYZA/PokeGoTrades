/**
 * Unit tests for the pure trade-lock reducers in `store/lock-state.ts`.
 *
 * Supabase Realtime frames and REST hydrates can arrive out of order, and the reducers settle two
 * separate ordering questions with two separate signals — which is the contract these tests pin down:
 *
 * - Which of two *server* observations is newer → `trade_locks.updated_at`. Only the server can order
 *   writes that may have been made on the partner's device.
 * - Did this device learn something after a given read was issued → `seq`, a local counter. No clock is
 *   consulted, so a device whose clock runs fast cannot discard state it correctly holds.
 *
 * Getting either wrong is expensive in production (a stale frame silently un-confirming a trade), and
 * conflating them is the specific mistake this design exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import type { Listing } from '@/data/types';
import type { LockEvent, TradeLockRow } from '@/lib/api/chats';

import {
  applyListingStatus,
  applyLockEvent,
  isStaleLock,
  LOCK_HELD_ELSEWHERE,
  lockSnapshot,
  type LockSlice,
  type LockVersion,
} from './lock-state';

// ——— time: ISO strings that sort both lexicographically and chronologically, like the real column ———
const iso = (secondsOffset: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, secondsOffset)).toISOString();

/** A stored version entry: the server token this device holds for a chat, and when it last learned it. */
const version = (updatedAt: string | null, seq: number): LockVersion => ({ updatedAt, seq });

// ——— typed fixtures, so each test reads as the scenario it describes ———

function makeSlice(partial: Partial<LockSlice> = {}): LockSlice {
  return {
    lockByListing: {},
    lockConfirmations: {},
    lockEventVersion: {},
    handshakeRequest: null,
    chats: {},
    listings: {},
    ...partial,
  };
}

function makeEvent(partial: Partial<LockEvent> = {}): LockEvent {
  return {
    op: 'update',
    released: false,
    listingId: 'listing-1',
    chatId: 'chat-1',
    sellerConfirmedAt: null,
    buyerConfirmedAt: null,
    updatedAt: iso(1),
    ...partial,
  };
}

function makeLock(partial: Partial<TradeLockRow> = {}): TradeLockRow {
  return {
    accepted_offer_message_id: null,
    buyer_confirmed_at: null,
    buyer_id: 'buyer-uuid',
    chat_id: 'chat-1',
    listing_id: 'listing-1',
    locked_at: iso(0),
    seller_confirmed_at: null,
    seller_id: 'seller-uuid',
    updated_at: iso(1),
    ...partial,
  };
}

function makeListing(partial: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    name: 'Larvitar',
    hue: 0,
    pokemonId: 246,
    form: 'Normal',
    year: 2026,
    lucky: false,
    shiny: false,
    accent: '#7c3aed',
    bg: 'meta',
    seller: 'Ash',
    loc: 'Pallet Town',
    pvp: 'Great League',
    demand: 'Medium',
    tradeType: 'Standard / Registered',
    iv: '100%',
    looking: [],
    status: 'open',
    ...partial,
  };
}

describe('isStaleLock — what counts as an out-of-order frame', () => {
  it('a release is never stale, no matter how old its updatedAt is', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } });
    expect(isStaleLock(state, 'chat-1', iso(1), true)).toBe(false);
  });

  it('a null updatedAt (pre-migration server) is never stale', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } });
    expect(isStaleLock(state, 'chat-1', null, false)).toBe(false);
  });

  it('the first observation of a chat is never stale', () => {
    const state = makeSlice(); // no lockEventVersion entry for this chat yet
    expect(isStaleLock(state, 'chat-1', iso(1), false)).toBe(false);
  });

  it('a frame is never stale against a purely local write, which holds no server token', () => {
    // What an optimistic confirm leaves behind: the sequence advanced, but `confirm_trade` reports no
    // timestamp, so there is nothing server-stamped to call the incoming frame older than.
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(null, 7) } });
    expect(isStaleLock(state, 'chat-1', iso(1), false)).toBe(false);
  });

  it('an update older than the last-seen version is stale', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } });
    expect(isStaleLock(state, 'chat-1', iso(5), false)).toBe(true);
  });

  it('an update at or after the last-seen version is not stale', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } });
    expect(isStaleLock(state, 'chat-1', iso(10), false)).toBe(false); // same version: idempotent replay
    expect(isStaleLock(state, 'chat-1', iso(11), false)).toBe(false);
  });
});

describe('applyLockEvent', () => {
  it('drops a stale frame entirely, returning an empty patch', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } });
    const event = makeEvent({ chatId: 'chat-1', updatedAt: iso(5) });

    expect(applyLockEvent(state, event, 2)).toEqual({});
  });

  it('applies a newer frame: confirmations update and the stored version bumps', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(1), 1) } });
    const event = makeEvent({
      chatId: 'chat-1',
      listingId: 'listing-1',
      updatedAt: iso(2),
      sellerConfirmedAt: iso(2),
      buyerConfirmedAt: null,
    });

    const patch = applyLockEvent(state, event, 2);

    expect(patch.lockConfirmations?.['chat-1']).toEqual({ sellerConfirmedAt: iso(2), buyerConfirmedAt: null });
    expect(patch.lockEventVersion?.['chat-1']).toEqual(version(iso(2), 2));
    expect(patch.lockByListing?.['listing-1']).toBe('chat-1');
  });

  it('a stale hydrate carrying a null confirmation cannot un-confirm a trade', () => {
    // The buyer confirms at t=2; the store stamps lockEventVersion to match.
    const confirmedPatch = applyLockEvent(
      makeSlice(),
      makeEvent({ chatId: 'chat-1', updatedAt: iso(2), sellerConfirmedAt: null, buyerConfirmedAt: iso(2) }),
      1,
    );
    const stateAfterConfirm = makeSlice({
      lockByListing: confirmedPatch.lockByListing,
      lockConfirmations: confirmedPatch.lockConfirmations,
      lockEventVersion: confirmedPatch.lockEventVersion,
    });
    expect(stateAfterConfirm.lockConfirmations['chat-1'].buyerConfirmedAt).toBe(iso(2));

    // A frame from before the confirmation (t=1) arrives late, carrying buyerConfirmedAt: null —
    // this is the exact shape of the regression the guard exists to prevent.
    const stalePatch = applyLockEvent(
      stateAfterConfirm,
      makeEvent({ chatId: 'chat-1', updatedAt: iso(1), sellerConfirmedAt: null, buyerConfirmedAt: null }),
      2,
    );

    // It must be dropped outright, so the earlier confirmation is left exactly as it was.
    expect(stalePatch).toEqual({});
    expect(stateAfterConfirm.lockConfirmations['chat-1'].buyerConfirmedAt).toBe(iso(2));
  });

  it('a release applies even when older than the stored version, and clears the chat', () => {
    const state = makeSlice({
      lockByListing: { 'listing-1': 'chat-1' },
      lockConfirmations: { 'chat-1': { sellerConfirmedAt: iso(2), buyerConfirmedAt: iso(2) } },
      lockEventVersion: { 'chat-1': version(iso(5), 1) }, // newer than the release event's updatedAt below
      handshakeRequest: 'chat-1',
    });
    const event = makeEvent({
      op: 'delete',
      released: true,
      chatId: 'chat-1',
      listingId: 'listing-1',
      updatedAt: iso(1), // older than iso(5): would be dropped as stale if release weren't exempt
    });

    const patch = applyLockEvent(state, event, 2);

    expect(patch.lockByListing).not.toHaveProperty('listing-1');
    expect(patch.lockConfirmations).not.toHaveProperty('chat-1');
    expect(patch.lockEventVersion).not.toHaveProperty('chat-1'); // gone, not merely restamped
    expect(patch.handshakeRequest).toBeNull();
  });

  it('a null updatedAt (unordered payload) is applied, not dropped', () => {
    const state = makeSlice({ lockEventVersion: { 'chat-1': version(iso(10), 1) } }); // would look "newer" than the event
    const event = makeEvent({
      chatId: 'chat-1',
      listingId: 'listing-1',
      updatedAt: null,
      sellerConfirmedAt: iso(1),
      buyerConfirmedAt: null,
    });

    const patch = applyLockEvent(state, event, 2);

    expect(patch.lockConfirmations?.['chat-1']).toEqual({ sellerConfirmedAt: iso(1), buyerConfirmedAt: null });
    expect(patch.lockByListing?.['listing-1']).toBe('chat-1');
    // No server token travelled with the event, so the one already stored is kept — but `seq` still
    // advances, because this device did just learn something.
    expect(patch.lockEventVersion?.['chat-1']).toEqual(version(iso(10), 2));
  });

  it("opening a lock on the buyer's own chat auto-opens their Handshake", () => {
    const state = makeSlice({ chats: { 'chat-1': { myRole: 'buyer' } } });
    const event = makeEvent({ op: 'insert', chatId: 'chat-1' });

    expect(applyLockEvent(state, event, 2).handshakeRequest).toBe('chat-1');
  });

  it("locking the seller's own chat does not open a Handshake", () => {
    const state = makeSlice({ chats: { 'chat-1': { myRole: 'seller' } } });
    const event = makeEvent({ op: 'insert', chatId: 'chat-1' });

    expect(applyLockEvent(state, event, 2).handshakeRequest).toBeNull();
  });

  it('only an insert opens the Handshake — an update on the same buyer chat does not', () => {
    const state = makeSlice({ chats: { 'chat-1': { myRole: 'buyer' } } });
    const event = makeEvent({ op: 'update', chatId: 'chat-1' });

    expect(applyLockEvent(state, event, 2).handshakeRequest).toBeNull();
  });
});

describe('lockSnapshot', () => {
  it('a locked listing with no visible lock row maps to LOCK_HELD_ELSEWHERE', () => {
    const state = makeSlice();
    const listing = makeListing({ id: 'listing-1', status: 'locked' });

    const snapshot = lockSnapshot(state, [], [listing], 10);

    expect(snapshot.lockByListing['listing-1']).toBe(LOCK_HELD_ELSEWHERE);
  });

  it("a locked listing with a visible lock row maps to that lock's chat", () => {
    const state = makeSlice();
    const listing = makeListing({ id: 'listing-1', status: 'locked' });
    const lock = makeLock({ listing_id: 'listing-1', chat_id: 'chat-9' });

    const snapshot = lockSnapshot(state, [lock], [listing], 10);

    expect(snapshot.lockByListing['listing-1']).toBe('chat-9');
  });

  it('a lock learned after the read began survives, unoverruled by the snapshot row', () => {
    const state = makeSlice({
      lockEventVersion: { 'chat-1': version(iso(5), 11) }, // seq 11: learned while the read was in flight
      lockConfirmations: { 'chat-1': { sellerConfirmedAt: null, buyerConfirmedAt: iso(5) } },
    });
    const readSeq = 10; // the read was issued at seq 10, before that confirmation was learned
    const staleRow = makeLock({
      chat_id: 'chat-1',
      seller_confirmed_at: null,
      buyer_confirmed_at: null, // what the row looked like at query time, before the confirmation
      updated_at: iso(1),
    });

    const snapshot = lockSnapshot(state, [staleRow], [], readSeq);

    expect(snapshot.lockConfirmations['chat-1']).toEqual({ sellerConfirmedAt: null, buyerConfirmedAt: iso(5) });
    expect(snapshot.lockEventVersion['chat-1']).toEqual(version(iso(5), 11));
  });

  it('a lock last learned before the read began is replaced by the snapshot row', () => {
    const state = makeSlice({
      lockEventVersion: { 'chat-2': version(iso(0), 3) }, // seq 3: learned well before the read
      lockConfirmations: { 'chat-2': { sellerConfirmedAt: null, buyerConfirmedAt: null } },
    });
    const readSeq = 10;
    const freshRow = makeLock({
      chat_id: 'chat-2',
      seller_confirmed_at: null,
      buyer_confirmed_at: iso(5), // confirmed by the time the snapshot query ran
      updated_at: iso(5),
    });

    const snapshot = lockSnapshot(state, [freshRow], [], readSeq);

    expect(snapshot.lockConfirmations['chat-2']).toEqual({ sellerConfirmedAt: null, buyerConfirmedAt: iso(5) });
    // Rows from this read carry the read's own sequence number.
    expect(snapshot.lockEventVersion['chat-2']).toEqual(version(iso(5), readSeq));
  });

  // The point of the refactor: these two prove the decision is made on `seq` alone, with the server
  // timestamps arranged to argue for the opposite answer. Under the old `readAt` comparison — a client
  // clock against a server one — a fast-running device got these backwards.
  it('preserves a locally-learned lock even when its server timestamp is the older one', () => {
    const state = makeSlice({
      lockEventVersion: { 'chat-1': version(iso(1), 11) }, // OLDER server token, but learned after the read
      lockConfirmations: { 'chat-1': { sellerConfirmedAt: null, buyerConfirmedAt: iso(1) } },
    });
    const rowWithNewerTimestamp = makeLock({ chat_id: 'chat-1', buyer_confirmed_at: null, updated_at: iso(99) });

    const snapshot = lockSnapshot(state, [rowWithNewerTimestamp], [], 10);

    expect(snapshot.lockConfirmations['chat-1'].buyerConfirmedAt).toBe(iso(1));
    expect(snapshot.lockEventVersion['chat-1']).toEqual(version(iso(1), 11));
  });

  it('replaces a stale local entry even when its server timestamp is the newer one', () => {
    const state = makeSlice({
      lockEventVersion: { 'chat-1': version(iso(99), 3) }, // NEWER server token, but learned before the read
      lockConfirmations: { 'chat-1': { sellerConfirmedAt: null, buyerConfirmedAt: iso(99) } },
    });
    const rowWithOlderTimestamp = makeLock({ chat_id: 'chat-1', buyer_confirmed_at: null, updated_at: iso(1) });

    const snapshot = lockSnapshot(state, [rowWithOlderTimestamp], [], 10);

    expect(snapshot.lockConfirmations['chat-1'].buyerConfirmedAt).toBeNull();
    expect(snapshot.lockEventVersion['chat-1']).toEqual(version(iso(1), 10));
  });
});

describe('applyListingStatus', () => {
  it('locking a listing with no known holder marks it LOCK_HELD_ELSEWHERE', () => {
    const state = makeSlice({ listings: { 'listing-1': makeListing({ id: 'listing-1', status: 'open' }) } });

    const result = applyListingStatus(state, 'listing-1', 'locked');

    expect(result.lockByListing['listing-1']).toBe(LOCK_HELD_ELSEWHERE);
    expect(result.listings['listing-1'].status).toBe('locked');
  });

  it('locking a listing that already names a holder leaves that holder alone', () => {
    const state = makeSlice({ lockByListing: { 'listing-1': 'chat-1' } });

    const result = applyListingStatus(state, 'listing-1', 'locked');

    expect(result.lockByListing['listing-1']).toBe('chat-1');
  });

  it("a non-locked status clears the listing's lock entry", () => {
    const state = makeSlice({ lockByListing: { 'listing-1': 'chat-1' } });

    const result = applyListingStatus(state, 'listing-1', 'open');

    expect(result.lockByListing).not.toHaveProperty('listing-1');
  });
});
