import { create } from 'zustand';

import { chats as seedChats, fallbackOffers } from '@/data/chats';
import { listings as seedListings } from '@/data/listings';
import type { Chat, ChatMessage, ChatSeed, FriendshipLabel, Listing } from '@/data/types';

function byId<T extends { id: string }>(records: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const record of records) out[record.id] = record;
  return out;
}

function omit<T extends Record<string, unknown>>(record: T, key: string): T {
  const { [key]: _dropped, ...rest } = record;
  return rest as T;
}

/** Splits seed chats into their normalized `chats` + `messages` slices, filling in the default
 *  opener thread for any chat seeded without scripted `offers` of its own. */
function splitChatSeeds(
  seeds: ChatSeed[],
  listingsById: Record<string, Listing>,
): { chats: Record<string, Chat>; messages: Record<string, ChatMessage[]> } {
  const chats: Record<string, Chat> = {};
  const messages: Record<string, ChatMessage[]> = {};
  for (const { offers, ...chat } of seeds) {
    chats[chat.id] = chat;
    messages[chat.id] = offers.length ? offers : fallbackOffers(listingsById[chat.listingId]?.name ?? '');
  }
  return { chats, messages };
}

/**
 * A chat's negotiation state, derived purely from `lockByListing` and `chat.active` — never
 * stored directly. Because at most one chat can ever occupy `lockByListing[listingId]`, two
 * chats competing for the same listing can't both end up "locked": the map structurally allows
 * only one holder, so there's nothing here to drift out of sync.
 */
export type ChatPhase = 'open' | 'locked' | 'frozen' | 'closed';

export function selectChatPhase(state: Pick<TradeState, 'chats' | 'lockByListing'>, chatId: string): ChatPhase {
  const chat = state.chats[chatId];
  if (!chat) return 'closed';
  const lockHolder = state.lockByListing[chat.listingId];
  if (lockHolder === chatId) return 'locked';
  if (lockHolder) return 'frozen';
  if (!chat.active) return 'closed';
  return 'open';
}

interface TradeState {
  // ——— normalized entities ———
  listings: Record<string, Listing>;
  chats: Record<string, Chat>;
  /** Chat messages, keyed by chat id — kept out of the `Chat` record itself so there's a single
   *  place a chat's thread lives, instead of drifting between store state and local screen state. */
  messages: Record<string, ChatMessage[]>;
  /** listingId -> the one chat currently holding that listing's trade lock, if any. */
  lockByListing: Record<string, string>;

  // ——— filters / prefs ———
  filterLocation: string;
  setFilterLocation: (loc: string) => void;
  friendship: FriendshipLabel;
  setFriendship: (level: FriendshipLabel) => void;

  // ——— listings ———
  /** Appends a fully-formed listing — including its `screenshots` (multi-image proof) and
   *  `tags` picked during creation — to the feed. */
  addListing: (listing: Listing) => void;
  /** Merges Supabase-loaded listings into the cache, replacing entries with the same id, so screens
   *  that resolve `listings[id]` (the detail sheet, chat headers) can find them. Feed *membership*
   *  stays with `useFeed`; this only makes the records reachable. */
  upsertListings: (listings: Listing[]) => void;
  /** Removes a listing entirely — used once its trade is marked completed. */
  removeListing: (listingId: string) => void;

  // ——— chats & messages ———
  addChat: (chat: ChatSeed) => void;
  /** Bail & Block: drops the chat from the store outright and thaws the listing's lock if it held it. */
  removeChat: (chatId: string) => void;
  /** Trade Completed: hides the chat from the active inbox instead of deleting it. */
  archiveChat: (chatId: string) => void;
  sendMessage: (chatId: string, message: ChatMessage) => void;

  // ——— trade lock ———
  /** Locks this chat's trade for its listing, freezing every sibling chat competing for it. */
  lockChat: (chatId: string) => void;
  /** Unlocks this chat's trade, thawing its siblings so they can compete again. Only the current
   *  lock holder can unlock — a stale call from a chat that never held the lock is a no-op. */
  unlockChat: (chatId: string) => void;
}

const seededListings = byId(seedListings);
const seededChats = splitChatSeeds(seedChats, seededListings);

export const useTradeStore = create<TradeState>((set) => ({
  listings: seededListings,
  chats: seededChats.chats,
  messages: seededChats.messages,
  lockByListing: {},

  filterLocation: 'Adyar',
  setFilterLocation: (loc) => set({ filterLocation: loc }),
  friendship: 'Great',
  setFriendship: (level) => set({ friendship: level }),

  addListing: (listing) => set((state) => ({ listings: { [listing.id]: listing, ...state.listings } })),
  upsertListings: (incoming) => set((state) => ({ listings: { ...state.listings, ...byId(incoming) } })),
  removeListing: (listingId) => set((state) => ({ listings: omit(state.listings, listingId) })),

  addChat: (chatSeed) =>
    set((state) => {
      const { offers, ...chat } = chatSeed;
      return {
        chats: { [chat.id]: chat, ...state.chats },
        messages: { ...state.messages, [chat.id]: offers },
      };
    }),

  removeChat: (chatId) =>
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat) return state;
      const lockByListing =
        state.lockByListing[chat.listingId] === chatId ? omit(state.lockByListing, chat.listingId) : state.lockByListing;
      return {
        chats: omit(state.chats, chatId),
        messages: omit(state.messages, chatId),
        lockByListing,
      };
    }),

  archiveChat: (chatId) =>
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat) return state;
      return { chats: { ...state.chats, [chatId]: { ...chat, archived: true } } };
    }),

  sendMessage: (chatId, message) =>
    set((state) => ({
      messages: { ...state.messages, [chatId]: [...(state.messages[chatId] ?? []), message] },
    })),

  lockChat: (chatId) =>
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat) return state;
      return { lockByListing: { ...state.lockByListing, [chat.listingId]: chatId } };
    }),

  unlockChat: (chatId) =>
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat || state.lockByListing[chat.listingId] !== chatId) return state;
      return { lockByListing: omit(state.lockByListing, chat.listingId) };
    }),
}));
