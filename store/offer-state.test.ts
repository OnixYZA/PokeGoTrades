/**
 * Unit tests for the pure offer rules in `store/offer-state.ts`.
 *
 * One function answers three questions that used to be answered separately: may this offer's card be opened,
 * may its Trade Summary be confirmed, and will `lockChat` take it. The contract pinned down here is the one
 * the chat depends on:
 *
 * - Position in the thread is irrelevant. Any of the buyer's offers can be accepted, not only the newest
 *   (the server's `lock_trade` takes any buyer offer in the chat, so the client must not be stricter).
 * - A dead offer (withdrawn, rejected, or in a chat that ended) cannot be opened or confirmed.
 * - A locked or frozen trade still lets an offer be read but never confirmed.
 * - Only the seller accepts, and only the buyer's offers.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/data/types';
import type { TradeView } from './trade-store';

import { newestAcceptableOffer, offerAvailability, type OfferViewer } from './offer-state';

type Phase = TradeView['phase'];

/**
 * A viewer, stated as the scenario it is. `canLock` is spelled out rather than derived because it belongs to
 * `selectTradeView` (D1: seller, chat open), which cannot be loaded here — it reaches `expo-crypto` and a
 * Supabase client that throws at import time. Each case below sets it to what that selector returns for it.
 */
function viewer(phase: Phase, role: 'seller' | 'buyer', live = true): OfferViewer {
  return { phase, live, canLock: role === 'seller' && phase === 'open' };
}

const SELLER_OPEN = viewer('open', 'seller');
const BUYER_OPEN = viewer('open', 'buyer');

/** The buyer's offer, as the seller sees it: sent by the other trainer. */
const theirOffer = (id: string, partial: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'them',
  kind: 'offer',
  text: '',
  time: '10:00',
  offer: { name: 'Zamazenta', pokemonId: 889, hue: 340 },
  ...partial,
});

const myOffer = (id: string): ChatMessage => ({ ...theirOffer(id), role: 'me' });

describe('offerAvailability: an offer the seller can take', () => {
  it('is selectable and confirmable, with nothing blocking it', () => {
    expect(offerAvailability(SELLER_OPEN, theirOffer('o1'))).toEqual({ block: null, selectable: true, confirmable: true });
  });

  it('does not depend on where the offer sits in the thread: an old offer is as acceptable as the newest', () => {
    const thread = [theirOffer('old'), theirOffer('mid'), theirOffer('new')];
    for (const message of thread) {
      expect(offerAvailability(SELLER_OPEN, message).confirmable).toBe(true);
    }
  });

  it('treats an agreement made in chat, with no offer to name, as acceptable too', () => {
    expect(offerAvailability(SELLER_OPEN)).toEqual({ block: null, selectable: true, confirmable: true });
  });
});

describe('offerAvailability: who may accept (D1)', () => {
  it('lets the buyer open an offer but not confirm it — only the seller locks', () => {
    expect(offerAvailability(BUYER_OPEN, theirOffer('o1'))).toEqual({ block: 'not_seller', selectable: true, confirmable: false });
    expect(offerAvailability(BUYER_OPEN, myOffer('o2'))).toEqual({ block: 'not_seller', selectable: true, confirmable: false });
  });

  it("does not let the seller accept their own offer — lock_trade only takes the buyer's", () => {
    expect(offerAvailability(SELLER_OPEN, myOffer('o1'))).toEqual({ block: 'own_offer', selectable: true, confirmable: false });
  });

  it('still lets the seller accept the buyer’s offer in the same thread as their own', () => {
    expect(offerAvailability(SELLER_OPEN, myOffer('mine')).confirmable).toBe(false);
    expect(offerAvailability(SELLER_OPEN, theirOffer('theirs')).confirmable).toBe(true);
  });

  it('cannot tell senders apart in the mock, which has none, so it accepts either', () => {
    const mock = viewer('open', 'seller', false);
    expect(offerAvailability(mock, { role: 'me' }).confirmable).toBe(true);
    expect(offerAvailability(mock, { role: 'them' }).confirmable).toBe(true);
  });
});

describe('offerAvailability: a trade that is locked or frozen', () => {
  it('keeps the offer readable but never confirmable once this chat holds the lock', () => {
    const locked = viewer('locked', 'seller');
    expect(offerAvailability(locked, theirOffer('o1'))).toEqual({ block: 'locked', selectable: true, confirmable: false });
    expect(offerAvailability(viewer('locked', 'buyer'), theirOffer('o1'))).toEqual({ block: 'locked', selectable: true, confirmable: false });
  });

  it('keeps the offer readable but never confirmable while a competing chat holds the lock', () => {
    for (const role of ['seller', 'buyer'] as const) {
      expect(offerAvailability(viewer('frozen', role), theirOffer('o1'))).toEqual({
        block: 'frozen',
        selectable: true,
        confirmable: false,
      });
    }
  });

  it('blocks acceptance of an agreement made in chat as well', () => {
    expect(offerAvailability(viewer('locked', 'seller')).confirmable).toBe(false);
    expect(offerAvailability(viewer('frozen', 'seller')).confirmable).toBe(false);
  });
});

describe('offerAvailability: a chat that is over', () => {
  it.each([
    ['bailed', 'cancelled'],
    ['closed', 'cancelled'],
    ['completed', 'completed'],
  ] as const)('a %s chat disables its offers as %s', (phase, block) => {
    for (const role of ['seller', 'buyer'] as const) {
      expect(offerAvailability(viewer(phase, role), theirOffer('o1'))).toEqual({ block, selectable: false, confirmable: false });
    }
  });

  it('reads a mock chat that is no longer active as locked, the way the rest of the chat UI does', () => {
    const inactiveMock = viewer('closed', 'seller', false);
    expect(offerAvailability(inactiveMock, theirOffer('o1'))).toEqual({ block: 'locked', selectable: true, confirmable: false });
  });
});

describe('offerAvailability: an offer that was taken back', () => {
  it.each(['withdrawn', 'rejected'] as const)('a %s offer is disabled and cannot be confirmed in an otherwise open chat', (offerResolution) => {
    expect(offerAvailability(SELLER_OPEN, theirOffer('o1', { offerResolution }))).toEqual({
      block: offerResolution,
      selectable: false,
      confirmable: false,
    });
  });

  it('is decided by the offer, not the trade: a withdrawn offer stays withdrawn in a locked, frozen or ended chat', () => {
    for (const phase of ['locked', 'frozen', 'bailed', 'completed'] as const) {
      expect(offerAvailability(viewer(phase, 'seller'), theirOffer('o1', { offerResolution: 'withdrawn' })).block).toBe('withdrawn');
    }
  });

  it('only closes that one offer: its siblings in the same chat stay acceptable', () => {
    const thread = [theirOffer('gone', { offerResolution: 'rejected' }), theirOffer('kept')];
    expect(thread.map((message) => offerAvailability(SELLER_OPEN, message).confirmable)).toEqual([false, true]);
  });
});

describe('offerAvailability: the derived flags cannot disagree with the block', () => {
  const phases: Phase[] = ['open', 'locked', 'frozen', 'closed', 'bailed', 'completed'];

  it('confirmable means no block, and implies selectable', () => {
    for (const phase of phases) {
      for (const role of ['seller', 'buyer'] as const) {
        for (const subject of [theirOffer('a'), myOffer('b'), theirOffer('c', { offerResolution: 'rejected' }), undefined]) {
          const result = offerAvailability(viewer(phase, role), subject);
          expect(result.confirmable).toBe(result.block === null);
          if (result.confirmable) expect(result.selectable).toBe(true);
        }
      }
    }
  });
});

describe('newestAcceptableOffer', () => {
  it('is the latest offer that can be accepted, skipping text and system lines', () => {
    const thread: ChatMessage[] = [
      theirOffer('old'),
      theirOffer('new'),
      { role: 'them', text: 'Is that fair?', time: '10:05' },
      { role: 'system', text: 'Something happened', time: '10:06' },
    ];
    expect(newestAcceptableOffer(thread, SELLER_OPEN)?.id).toBe('new');
  });

  it('falls back to an earlier offer when the newest one is out of reach', () => {
    const thread = [theirOffer('old'), theirOffer('gone', { offerResolution: 'withdrawn' }), myOffer('mine')];
    expect(newestAcceptableOffer(thread, SELLER_OPEN)?.id).toBe('old');
  });

  it('is undefined when no offer can be accepted, so the trade is previewed as agreed in chat', () => {
    expect(newestAcceptableOffer([], SELLER_OPEN)).toBeUndefined();
    expect(newestAcceptableOffer([theirOffer('o1')], BUYER_OPEN)).toBeUndefined();
    expect(newestAcceptableOffer([theirOffer('o1')], viewer('locked', 'seller'))).toBeUndefined();
  });
});
