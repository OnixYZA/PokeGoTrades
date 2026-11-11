/**
 * Unit tests for `store/listing-lifecycle.ts`: what the feed shows, and what withdrawing a listing does to
 * the cached listing, its lock entry and every chat on it. The reducer must mirror `withdraw_listing`
 * (supabase/migrations/20260916000500_rpcs.sql) without mutating the state it was handed.
 */
import { describe, expect, it } from 'vitest';
import type { Chat, Listing } from '@/data/types';

import { applyListingWithdrawn, isFeedVisible, withdrawRefusal, type WithdrawSlice } from './listing-lifecycle';

function makeListing(partial: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    name: 'Larvitar',
    hue: 0,
    pokemonId: 246,
    year: 2026,
    lucky: false,
    shiny: false,
    accent: '#7c3aed',
    bg: 'meta',
    seller: 'Ash',
    loc: 'Adyar',
    pvp: 'Great League',
    tradeType: 'Standard / Registered',
    iv: '100%',
    looking: [],
    tags: [],
    purified: false,
    costume: false,
    pokeball: null,
    sizeClass: null,
    willTravel: false,
    isGigantamax: false,
    isDynamax: false,
    tradeTimeline: 'flexible',
    status: 'open',
    ...partial,
  };
}

function makeChat(partial: Partial<Chat> = {}): Chat {
  return { id: 'chat-1', listingId: 'listing-1', partner: 'Misty', preview: '', unread: 0, active: true, ...partial };
}

function makeSlice(partial: Partial<WithdrawSlice> = {}): WithdrawSlice {
  return { listings: {}, chats: {}, lockByListing: {}, ...partial };
}

/** Freezes every nested object so any in-place write throws under strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('isFeedVisible', () => {
  it('shows listings with no status (mock seeds), open and locked', () => {
    expect(isFeedVisible({ status: undefined })).toBe(true);
    expect(isFeedVisible({ status: 'open' })).toBe(true);
    expect(isFeedVisible({ status: 'locked' })).toBe(true);
  });

  it('hides withdrawn and completed listings', () => {
    expect(isFeedVisible({ status: 'withdrawn' })).toBe(false);
    expect(isFeedVisible({ status: 'completed' })).toBe(false);
  });
});

describe('applyListingWithdrawn', () => {
  it('marks the listing withdrawn and drops its lock entry', () => {
    const state = makeSlice({
      listings: { 'listing-1': makeListing({ status: 'open' }) },
      lockByListing: { 'listing-1': 'chat-1', 'listing-2': 'chat-9' },
    });
    const next = applyListingWithdrawn(state, 'listing-1');
    expect(next.listings['listing-1'].status).toBe('withdrawn');
    expect(next.lockByListing).toEqual({ 'listing-2': 'chat-9' });
  });

  it('closes a live open chat', () => {
    const state = makeSlice({ chats: { 'chat-1': makeChat({ myRole: 'seller', status: 'open' }) } });
    expect(applyListingWithdrawn(state, 'listing-1').chats['chat-1'].status).toBe('closed');
  });

  it('leaves a live chat that already ended with its own status', () => {
    const bailed = makeChat({ myRole: 'buyer', status: 'bailed' });
    const state = makeSlice({ chats: { 'chat-1': bailed } });
    expect(applyListingWithdrawn(state, 'listing-1').chats['chat-1']).toBe(bailed);
  });

  it('retires a mock chat the way mock confirmTrade does', () => {
    const state = makeSlice({ chats: { 'chat-1': makeChat({ active: true }) } });
    const chat = applyListingWithdrawn(state, 'listing-1').chats['chat-1'];
    expect(chat.active).toBe(false);
    expect(chat.archived).toBe(true);
    expect(chat.status).toBeUndefined();
  });

  it('does not touch chats on other listings', () => {
    const other = makeChat({ id: 'chat-2', listingId: 'listing-2', myRole: 'seller', status: 'open' });
    const state = makeSlice({ chats: { 'chat-1': makeChat({ myRole: 'seller', status: 'open' }), 'chat-2': other } });
    expect(applyListingWithdrawn(state, 'listing-1').chats['chat-2']).toBe(other);
  });

  it('still closes its chats when the listing is not cached', () => {
    const state = makeSlice({ chats: { 'chat-1': makeChat({ myRole: 'seller', status: 'open' }) } });
    const next = applyListingWithdrawn(state, 'listing-1');
    expect(next.listings).toEqual({});
    expect(next.chats['chat-1'].status).toBe('closed');
  });

  it('never mutates its input', () => {
    const state = deepFreeze(
      makeSlice({
        listings: { 'listing-1': makeListing({ status: 'locked' }) },
        chats: {
          'chat-1': makeChat({ myRole: 'seller', status: 'open' }),
          'chat-2': makeChat({ id: 'chat-2' }),
        },
        lockByListing: { 'listing-1': 'chat-1' },
      }),
    );
    expect(() => applyListingWithdrawn(state, 'listing-1')).not.toThrow();
  });
});

describe('withdrawRefusal', () => {
  it('allows an open listing, and a mock listing with no status, when no lock is held', () => {
    expect(withdrawRefusal({ status: 'open' }, false)).toBeNull();
    expect(withdrawRefusal({ status: undefined }, false)).toBeNull();
    expect(withdrawRefusal(undefined, false)).toBeNull();
  });

  it('refuses a locked listing as unlock_first, by status or by a held lock alone', () => {
    expect(withdrawRefusal({ status: 'locked' }, false)).toBe('unlock_first');
    // The mock (and a live lock event ahead of its listing_status) records the lock only in lockByListing.
    expect(withdrawRefusal({ status: undefined }, true)).toBe('unlock_first');
    expect(withdrawRefusal({ status: 'open' }, true)).toBe('unlock_first');
  });

  it('refuses a listing that is already closed as not_open', () => {
    expect(withdrawRefusal({ status: 'withdrawn' }, false)).toBe('not_open');
    expect(withdrawRefusal({ status: 'completed' }, false)).toBe('not_open');
  });
});
