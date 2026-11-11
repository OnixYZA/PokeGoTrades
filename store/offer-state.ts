/**
 * The one rule for "may this formal offer be opened, and may it be accepted?".
 *
 * Whether an offer card is tappable, whether its Trade Summary can be confirmed, and whether `lockChat` will
 * go through used to be answered separately, each from whatever the caller happened to have at hand — which
 * is how "Accept Trade (Lock)" ended up acting on the latest offer only: nothing could name an earlier one.
 * Every one of those questions is now this function, so the card, the preview and the store cannot disagree.
 *
 * Like `store/lock-state.ts` this is kept free of every runtime dependency (the store reaches `expo-crypto`
 * and a Supabase client that throws at import time) so the rules can be exercised directly
 * (`store/offer-state.test.ts`). Only types are imported.
 *
 * What the server decides, and this mirrors (see `lock_trade` in supabase/migrations/…000500_rpcs.sql): only
 * the seller locks (D1), the chat and listing must be open, and a named offer must be a *buyer's* offer in
 * this chat. Nothing there looks at how recent an offer is, so any of the buyer's offers can be accepted.
 */
import type { ChatMessage } from '@/data/types';

import type { TradeView } from './trade-store';

/**
 * Why an offer cannot be accepted right now, most specific reason first. `null` is "it can".
 *
 * The first four end the offer for good, so its card is disabled outright. The rest are about the moment or
 * the viewer: the card still opens (a trainer may want to read what was proposed) but the preview cannot confirm.
 */
export type OfferBlock =
  /** The sender took the offer back. */
  | 'withdrawn'
  /** The seller turned it down. */
  | 'rejected'
  /** The chat was bailed or closed (including the listing being withdrawn or traded elsewhere). */
  | 'cancelled'
  /** The trade it belonged to is done. */
  | 'completed'
  /** This chat already holds the listing's lock. */
  | 'locked'
  /** A competing chat holds the listing's lock. */
  | 'frozen'
  /** Only the seller accepts offers (D1). */
  | 'not_seller'
  /** The seller accepts the buyer's offers, not the ones they send themselves. */
  | 'own_offer';

/** What the chat UI needs to know about one offer. `selectable` and `confirmable` are both derived from `block`. */
export interface OfferAvailability {
  block: OfferBlock | null;
  /** The card opens the Trade Summary. False only for an offer that has ended. */
  selectable: boolean;
  /** The Trade Summary's "Confirm Trade Agreement" is live, and `lockChat` will accept this offer. */
  confirmable: boolean;
}

/** The viewer's side of the trade: the slice of `selectTradeView` this rule reads. */
export type OfferViewer = Pick<TradeView, 'phase' | 'live' | 'canLock'>;

/** The offer message being asked about. Omit it for an agreement made in chat with no formal offer. */
export type OfferSubject = Partial<Pick<ChatMessage, 'role' | 'offerResolution'>>;

const ENDED: ReadonlySet<OfferBlock> = new Set<OfferBlock>(['withdrawn', 'rejected', 'cancelled', 'completed']);

function offerBlock(view: OfferViewer, subject: OfferSubject): OfferBlock | null {
  // The offer's own fate outranks the trade's: a withdrawn offer in a locked chat is still a withdrawn offer.
  if (subject.offerResolution) return subject.offerResolution;

  // The mock's inactive chats read as locked everywhere else in the chat UI; `closed` only exists live.
  const phase = !view.live && view.phase === 'closed' ? 'locked' : view.phase;
  switch (phase) {
    case 'bailed':
    case 'closed':
      return 'cancelled';
    case 'completed':
      return 'completed';
    case 'locked':
      return 'locked';
    case 'frozen':
      return 'frozen';
    case 'open':
      break;
  }

  // The chat is open, so `canLock` can only fail on the role: it is the buyer looking (D1).
  if (!view.canLock) return 'not_seller';
  // `lock_trade` rejects any offer not sent by the buyer as `invalid_offer_message`. The mock has no senders.
  if (view.live && subject.role === 'me') return 'own_offer';
  return null;
}

export function offerAvailability(view: OfferViewer, subject: OfferSubject = {}): OfferAvailability {
  const block = offerBlock(view, subject);
  return { block, selectable: block === null || !ENDED.has(block), confirmable: block === null };
}

/**
 * The offer the thread's quick "Accept Trade (Lock)" button previews: the newest one that can be accepted.
 * It is only a default. Every other acceptable offer is just as selectable from its own card, and none of
 * the rules above depend on position.
 */
export function newestAcceptableOffer(messages: readonly ChatMessage[], view: OfferViewer): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.offer && offerAvailability(view, message).confirmable) return message;
  }
  return undefined;
}
