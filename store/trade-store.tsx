import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { ALL_LOCATIONS, locationKey, sanitizeFilterLocation, sanitizeLocationLabel, type LocationName } from '@/constants/locations';
import { chats as seedChats, fallbackOffers } from '@/data/chats';
import { listings as seedListings } from '@/data/listings';
import { trainer as mockTrainer } from '@/data/trainer';
import type {
  Chat,
  ChatMessage,
  ChatRole,
  ChatSeed,
  FormalOffer,
  FriendshipLabel,
  Listing,
  ListingStatus,
} from '@/data/types';
import * as chatsApi from '@/lib/api/chats';
import { fetchListingsByIds, withdrawListing as withdrawListingApi } from '@/lib/api/listings';
import { fetchHomeLocation, saveHomeLocation as saveHomeLocationApi } from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';
import { creatureDisplayName } from '@/lib/format';
import { readProofBytes, type PickedProof } from '@/lib/proof-image';
import { openPrivateChannel } from '@/lib/realtime';
import { computeRepAfterTrade, computeStreakAfterTrade, evaluateBailOutcome, evaluateUnlockOutcome, MAX_REP, MIN_REP } from '@/lib/reputation';
import { describeError, type ErrorInfo } from '@/lib/rpc-errors';
import { toast } from '@/lib/toast';
import {
  applyListingStatus,
  applyLockEvent,
  lockSnapshot,
  LOCK_HELD_ELSEWHERE,
  type LockConfirmations,
  type LockVersion,
} from './lock-state';
import { applyListingWithdrawn, withdrawRefusal } from './listing-lifecycle';
import { cycleFilter, setFilterMode, type FilterKey, type FilterMode, type FilterState } from './listing-filters';
import { offerAvailability } from './offer-state';

// The lock rules live in ./lock-state so they can be tested without the Expo/Supabase module graph.
// Re-exported here because this is where the rest of the app already imports them from.
export { LOCK_HELD_ELSEWHERE, type LockConfirmations, type LockVersion };

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
    const listing = listingsById[chat.listingId];
    messages[chat.id] = offers.length ? offers : fallbackOffers(listing ? creatureDisplayName(listing) : '');
  }
  return { chats, messages };
}


/**
 * A chat's negotiation state, derived purely from the chat's server status and `lockByListing` —
 * never stored directly. Because at most one chat can ever occupy `lockByListing[listingId]`, two
 * chats competing for the same listing can't both end up "locked": the map structurally allows
 * only one holder, so there's nothing here to drift out of sync.
 */
export type ChatPhase = 'open' | 'locked' | 'frozen' | 'closed' | 'bailed' | 'completed';

export function selectChatPhase(
  state: Pick<TradeState, 'chats' | 'lockByListing'>,
  chatId: string,
): ChatPhase {
  const chat = state.chats[chatId];
  if (!chat) return 'closed';
  // Terminal server states first, so a completed or bailed chat can never render as locked.
  if (chat.status === 'bailed') return 'bailed';
  if (chat.status === 'completed') return 'completed';
  if (chat.status === 'closed') return 'closed';
  const lockHolder = state.lockByListing[chat.listingId];
  if (lockHolder === chatId) return 'locked';
  if (lockHolder) return 'frozen';
  if (!chat.active) return 'closed'; // mock chats have no `status`, only `active`
  return 'open';
}


export type Confirmation = 'none' | 'awaiting_partner' | 'awaiting_me';

/** Everything the chat UI needs to know about what the signed-in trainer may do right now. */
export interface TradeView {
  phase: ChatPhase;
  /** The mock has no roles and treats the local trainer as the seller, so that is the default. */
  role: ChatRole;
  /** True for a Supabase-backed chat, false for the local mock. */
  live: boolean;
  confirmation: Confirmation;
  canLock: boolean;
  canUnlock: boolean;
  canConfirm: boolean;
  canWithdrawConfirmation: boolean;
  canCompose: boolean;
  canBail: boolean;
  canOpenHandshake: boolean;
}

export function selectTradeView(
  state: Pick<TradeState, 'chats' | 'lockByListing' | 'lockConfirmations'>,
  chatId: string,
): TradeView {
  const chat = state.chats[chatId];
  const phase = selectChatPhase(state, chatId);
  const live = chat?.myRole !== undefined;
  const role: ChatRole = chat?.myRole ?? 'seller';
  const confirmations = state.lockConfirmations[chatId];
  const mine = role === 'seller' ? confirmations?.sellerConfirmedAt : confirmations?.buyerConfirmedAt;
  const theirs = role === 'seller' ? confirmations?.buyerConfirmedAt : confirmations?.sellerConfirmedAt;
  const confirmation: Confirmation =
    phase !== 'locked' ? 'none' : mine ? 'awaiting_partner' : theirs ? 'awaiting_me' : 'none';
  const active = phase === 'open' || phase === 'locked';
  return {
    phase,
    role,
    live,
    confirmation,
    canLock: role === 'seller' && phase === 'open', // D1: only the seller locks
    canUnlock: role === 'seller' && phase === 'locked',
    canConfirm: phase === 'locked' && !mine, // D2: either party, once each
    canWithdrawConfirmation: phase === 'locked' && !!mine && !theirs,
    canCompose: live ? active : phase !== 'frozen',
    canBail: live ? active || phase === 'frozen' : true,
    canOpenHandshake: phase === 'locked',
  };
}

/**
 * Why `lockChat` would be refused before it reaches the server, as the RPC's own error code (so the sentence
 * comes from `lib/rpc-errors.ts`). It is the same rule the chat UI disables its buttons by — `canLock` and
 * `offerAvailability` — checked again at the one place a lock is actually taken, so a stale button, a
 * competing lock that landed while a preview was open, or a message that was never the buyer's cannot slip through.
 */
function lockRefusal(
  state: Pick<TradeState, 'chats' | 'lockByListing' | 'lockConfirmations' | 'messages'>,
  chatId: string,
  offerMessageId: string | undefined,
): 'not_seller' | 'not_lockable' | 'invalid_offer_message' | null {
  const view = selectTradeView(state, chatId);
  if (!view.canLock) return view.role === 'seller' ? 'not_lockable' : 'not_seller';
  if (offerMessageId === undefined) return null;
  const message = state.messages[chatId]?.find((m) => m.id === offerMessageId);
  return message?.offer && offerAvailability(view, message).confirmable ? null : 'invalid_offer_message';
}

/** Sum of unread messages across visible chats, for the tab badge. */
export function selectTotalUnread(state: Pick<TradeState, 'chats'>): number {
  let total = 0;
  for (const chat of Object.values(state.chats)) if (!chat.archived) total += chat.unread;
  return total;
}

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; error: ErrorInfo };

/** What the buyer picked in the "Make Offer" sheet. */
export type OfferSelection = { kind: 'creature'; offer: FormalOffer } | { kind: 'custom' };

/** What the trainer is sending from the composer. */
export type OutgoingMessage = { text: string } | { offer: FormalOffer } | { image: PickedProof; caption?: string };

const CUSTOM_OFFER_BODY = "Custom offer — let's work out the details here.";

/**
 * The inbox preview of a chat whose last message is a formal offer. In Supabase mode the server writes it
 * (`private.on_message_inserted`, migration 20261017000100) and the client shows whatever was stored; the server
 * has no Pokédex, so it cannot name the species and says only this. The mock builds the same string so a demo
 * inbox reads like the real one. Keep the two in step.
 */
const FORMAL_OFFER_PREVIEW = 'Formal offer';

interface TradeState {
  // ——— normalized entities ———
  listings: Record<string, Listing>;
  chats: Record<string, Chat>;
  /** Chat messages, keyed by chat id — kept out of the `Chat` record itself so there's a single
   *  place a chat's thread lives, instead of drifting between store state and local screen state. */
  messages: Record<string, ChatMessage[]>;
  /** listingId -> the one chat currently holding that listing's trade lock, if any
   *  (or `LOCK_HELD_ELSEWHERE` when it is locked but the holder is not visible to me). */
  lockByListing: Record<string, string>;
  /**
   * Per chat, the `trade_locks.updated_at` of the newest lock state applied. Any frame or snapshot row
   * older than this is stale and is dropped, which is what stops a slow `hydrate()` from un-confirming a
   * trade the server still holds as confirmed. Optimistic local writes stamp it with the client clock —
   * see `applyLockEvent`, which also explains why a release ignores it.
   */
  lockEventVersion: Record<string, LockVersion>;
  /** chatId -> each side's confirmation of the trade that chat holds. Live chats only. */
  lockConfirmations: Record<string, LockConfirmations>;
  /**
   * Mock mode only (no backend): the local trainer's reputation stats, moved by `confirmTrade` / `bailChat`
   * with the same rules the server applies (lib/reputation.ts). In live mode the server owns these
   * (`profiles.rep` etc., see `fetchMyProfile`) and this stays at its seed. Partner penalties are not
   * representable: mock partners have no profile records.
   */
  mockStats: MockTrainerStats;
  /** The signed-in trainer. Set by `LiveSync`; message roles are derived against it. */
  me: { id: string } | null;
  /** A chat whose Handshake should open by itself: the buyer's, when the seller locks (D1). */
  handshakeRequest: string | null;
  clearHandshakeRequest: () => void;

  // ——— filters / prefs ———
  filterLocation: LocationName;
  setFilterLocation: (loc: LocationName) => void;
  recentLocations: LocationName[];
  addRecentLocation: (loc: LocationName) => void;
  /** The trainer's own home location (`profile_private.safe_loc`), or null when unset. Offered as a one-tap row
   *  in the location picker. Mock mode starts from the mock trainer's; live mode loads it in `hydrate`. */
  homeLocation: LocationName | null;
  /** Local-only set (the profile screen seeds it from `fetchMyProfile`). */
  setHomeLocation: (loc: LocationName | null) => void;
  /** Sanitizes and persists the home location (live) or sets it locally (mock). Null clears it. */
  saveHomeLocation: (loc: LocationName | null) => Promise<ActionResult>;
  friendship: FriendshipLabel;
  setFriendship: (level: FriendshipLabel) => void;
  /** Tristate feed-attribute filters (constants/listing-attributes.ts / store/listing-filters.ts).
   *  Not persisted — a fresh app open starts with every chip neutral. */
  listingFilters: FilterState;
  cycleListingFilter: (key: FilterKey) => void;
  /** Sets one chip directly to include / exclude / neutral (`'none'`); idempotent, unlike the cycle. */
  setListingFilter: (key: FilterKey, mode: FilterMode | 'none') => void;
  clearListingFilters: () => void;
  /** Feed species filter set by the search: only listings of this `pokemonId` (all forms). Not persisted;
   *  `clearListingFilters` resets it too. */
  searchPokemonId: number | null;
  setSearchPokemonId: (id: number | null) => void;

  // ——— listings ———
  /** Appends a fully-formed listing — including its `screenshots` (multi-image proof) and
   *  `tags` picked during creation — to the feed. */
  addListing: (listing: Listing) => void;
  /** Merges Supabase-loaded listings into the cache, replacing entries with the same id, so screens
   *  that resolve `listings[id]` (the detail sheet, chat headers) can find them. Feed *membership*
   *  stays with `useFeed`; this only makes the records reachable. */
  upsertListings: (listings: Listing[]) => void;
  /** Removes a listing entirely — mock only. With Supabase nothing is deleted (D6): a listing reaches
   *  `completed` or `withdrawn` and the feed simply stops showing it. */
  removeListing: (listingId: string) => void;

  // ——— chats & messages ———
  /** Mock only: appends a locally-created chat. Supabase chats come from `openOffer` and the inbox. */
  addChat: (chat: ChatSeed) => void;
  /** Mock only: Bail & Block drops the chat from the store outright and thaws the listing's lock. */
  removeChat: (chatId: string) => void;
  /** Mock only: Trade Completed hides the chat from the active inbox instead of deleting it. */
  archiveChat: (chatId: string) => void;
  /**
   * Buyer opens a chat with a first offer. With Supabase this is the `open_offer` RPC (not optimistic:
   * the server may refuse and returns the real chat id); with the mock it appends a local chat.
   */
  openOffer: (listingId: string, selection: OfferSelection) => Promise<ActionResult<string>>;
  /** Optimistic with Supabase: the bubble appears at once as `pending` and reconciles by `clientId`. */
  sendMessage: (chatId: string, message: OutgoingMessage) => Promise<ActionResult>;
  /** Re-sends a `failed` bubble under the same `clientId`, so it cannot double-post. */
  retryMessage: (chatId: string, clientId: string) => Promise<ActionResult>;
  /** Read receipt: zeroes the unread count now and records it server-side. No-op for the mock. */
  markRead: (chatId: string) => void;

  // ——— trade lock ———
  /**
   * Seller only (D1). Locks this chat's trade, freezing every sibling chat competing for the listing.
   * `offerMessageId` names the buyer's offer being accepted — any of them, not just the newest; left out, the
   * server takes the newest (or none, for a trade agreed in chat). Refused up front, without a request, when
   * the trade or that offer cannot be accepted (`lockRefusal`).
   */
  lockChat: (chatId: string, offerMessageId?: string) => Promise<ActionResult>;
  /** Seller only (D1). Unlocks, thawing the siblings; only the current lock holder can. */
  unlockChat: (chatId: string) => Promise<ActionResult>;
  /** Either party (D2). The second confirmation completes the trade. */
  confirmTrade: (chatId: string) => Promise<ActionResult<'awaiting_partner' | 'completed'>>;
  withdrawConfirmation: (chatId: string) => Promise<ActionResult>;
  /** Bail & Block: closes the chat (and every open chat with that trainer), releases the lock, blocks. */
  bailChat: (chatId: string, reason: chatsApi.BailReason, note?: string) => Promise<ActionResult>;
  /**
   * Seller only: takes a listing off the market and closes every open chat on it (`withdraw_listing`).
   * Refused while a buyer's offer is locked ('unlock_first'): the seller must unlock in the chat first. The
   * state change (listing `withdrawn`, chats `closed`) is applied once the server confirms, without waiting
   * for the realtime echo, so the feed and the open threads update at once.
   */
  withdrawListing: (listingId: string) => Promise<ActionResult>;

  // ——— live sync (Supabase only) ———
  setMe: (me: { id: string } | null) => void;
  /** Loads the inbox, my locks and the listings my chats reference, replacing what was cached. */
  hydrate: () => Promise<void>;
  /** After a reconnect or foregrounding: refetch everything a dropped socket may have missed. */
  resync: () => Promise<void>;
  /** Loads one chat by id (deep links, a chat just created). 'missing' means it does not exist or RLS hides it. */
  loadChat: (chatId: string) => Promise<'found' | 'missing' | 'error'>;
  /** Opens the trainer's `user:<uid>` channel. Returns its cleanup. */
  connectRealtime: (userId: string) => () => void;
  /** `chat:<id>` for the focused chat screen. Only call for a chat that is in my inbox. Returns its cleanup. */
  subscribeToChat: (chatId: string) => () => void;
  /** `listing:<id>` for the focused detail sheet. Returns its cleanup. */
  subscribeToListing: (listingId: string) => () => void;
  /** Sign-out: drops everything user-specific. */
  reset: () => void;
}

const seededListings = byId(seedListings);
// With Supabase the mock chats must not leak into the real inbox.
const seededChats = USE_SUPABASE ? { chats: {}, messages: {} } : splitChatSeeds(seedChats, seededListings);

// ——— message reconciliation ———

/** Confirmed messages in (created_at, id) order — the same order the server returns — then any
 *  unconfirmed sends in the order they were made. A pending bubble therefore never jumps around when a
 *  message with a slightly different server clock lands, and it settles into place once confirmed. */
function sortMessages(list: ChatMessage[]): ChatMessage[] {
  const confirmed = list.filter((m) => !m.delivery);
  const unconfirmed = list.filter((m) => m.delivery);
  confirmed.sort((a, b) => {
    const delta = (a.createdAt ? chatsApi.timeKey(a.createdAt) : 0) - (b.createdAt ? chatsApi.timeKey(b.createdAt) : 0);
    return delta !== 0 ? delta : (a.id ?? '').localeCompare(b.id ?? '');
  });
  return [...confirmed, ...unconfirmed];
}

/**
 * Idempotent: an incoming row replaces whatever it matches — the same server id, or my own optimistic
 * bubble with the same `clientId` — and is appended otherwise. So the RPC/insert response and the
 * Realtime echo of it can arrive in either order, and a gap fill can safely overlap what is cached.
 */
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const merged = [...existing];
  for (const message of incoming) {
    const index = merged.findIndex(
      (m) =>
        (message.id !== undefined && m.id === message.id) ||
        (message.clientId !== undefined && m.clientId === message.clientId && m.senderId === message.senderId),
    );
    if (index === -1) merged.push(message);
    else {
      const existingMsg = merged[index];
      merged[index] = existingMsg.imageUri && !message.imageUri ? { ...message, imageUri: existingMsg.imageUri } : message;
    }
  }
  return sortMessages(merged);
}

function newestServerTimestamp(list: ChatMessage[] | undefined): string | undefined {
  return list ? [...list].reverse().find((m) => m.createdAt && !m.delivery)?.createdAt : undefined;
}

export interface MockTrainerStats {
  trades: number;
  rep: number;
  streak: number;
  bailsCount: number;
  lastTradeAt: string | null;
}

function seedMockStats(): MockTrainerStats {
  return { trades: mockTrainer.trades, rep: mockTrainer.rep, streak: mockTrainer.streak, bailsCount: mockTrainer.bailsCount ?? 0, lastTradeAt: null };
}

function dropChat(state: TradeState, chatId: string): Partial<TradeState> {
  const chat = state.chats[chatId];
  if (!chat) return {};
  for (const msg of state.messages[chatId] ?? []) {
    if (msg.clientId) {
      pendingImageProofs.delete(msg.clientId);
      uploadedImageClients.delete(msg.clientId);
    }
  }
  return {
    chats: omit(state.chats, chatId),
    messages: omit(state.messages, chatId),
    lockConfirmations: omit(state.lockConfirmations, chatId),
    lockEventVersion: omit(state.lockEventVersion, chatId),
    lockByListing: state.lockByListing[chat.listingId] === chatId ? omit(state.lockByListing, chat.listingId) : state.lockByListing,
  };
}

// ——— module state for the live layer ———

/** Pending image proofs awaiting upload/retry, keyed by `clientId`. */
const pendingImageProofs = new Map<string, PickedProof>();
/** `clientId`s whose image object has already been uploaded to Storage so retries skip re-uploading. */
const uploadedImageClients = new Set<string>();

/** Chats whose `chat:<id>` channel is open right now, so `resync` knows which threads to gap-fill. */
const focusedChats = new Set<string>();
let inboxRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Request sequencing for the reads that replace a whole slice of state, so a slow one landing after a
 * newer one cannot put the older answer back (the same guard `lib/use-feed.ts` uses for the feed).
 *
 * `hydrate` and `refreshInbox` share a counter because both replace the inbox wholesale; `loadChat` is
 * counted per chat, so opening one chat never invalidates a load already running for another.
 */
let inboxRead = 0;
const chatReads = new Map<string, number>();

/**
 * The device's own clock-free ordering. Every read and every lock observation takes the next number, so
 * "did this happen after that read was issued?" is answered by comparing two integers produced here —
 * never by comparing a `new Date()` against a server timestamp, which are two unrelated clocks.
 */
let lockSeq = 0;
function nextLockSeq(): number {
  return ++lockSeq;
}

function beginChatRead(chatId: string): number {
  const seq = (chatReads.get(chatId) ?? 0) + 1;
  chatReads.set(chatId, seq);
  return seq;
}

const FILTER_LOCATION_STORAGE_KEY = 'pokegotrades.filterLocation';
const RECENT_LOCATIONS_STORAGE_KEY = 'pokegotrades.recentLocations';
const MAX_RECENT_LOCATIONS = 5;

function readStoredFilterLocation(): LocationName {
  if (typeof localStorage === 'undefined') return ALL_LOCATIONS;
  try {
    const raw = localStorage.getItem(FILTER_LOCATION_STORAGE_KEY);
    if (!raw) return ALL_LOCATIONS;
    return sanitizeFilterLocation(raw) ?? ALL_LOCATIONS;
  } catch {
    return ALL_LOCATIONS;
  }
}

function writeStoredFilterLocation(loc: LocationName): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FILTER_LOCATION_STORAGE_KEY, loc);
  } catch {
    /* ignore storage quota / private mode errors */
  }
}

function readStoredRecentLocations(): LocationName[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_LOCATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: LocationName[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const clean = sanitizeLocationLabel(item);
      if (!clean) continue;
      const key = locationKey(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
      if (result.length >= MAX_RECENT_LOCATIONS) break;
    }
    return result;
  } catch {
    return [];
  }
}

function writeStoredRecentLocations(locs: LocationName[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECENT_LOCATIONS_STORAGE_KEY, JSON.stringify(locs));
  } catch {
    /* ignore storage quota / private mode errors */
  }
}

function prependRecentLocation(existing: LocationName[], loc: string): LocationName[] {
  const clean = sanitizeLocationLabel(loc);
  if (!clean) return existing;
  const key = locationKey(clean);
  return [clean, ...existing.filter((item) => locationKey(item) !== key)].slice(0, MAX_RECENT_LOCATIONS);
}

const NOT_SIGNED_IN: ErrorInfo = {
  code: 'no_session',
  message: 'You are signed out. Reopen the app and try again.',
  followUp: 'none',
};

export const useTradeStore = create<TradeState>((set, get) => {
  /** Runs one server action: a friendly toast on failure, and a resync when local state is probably stale. */
  async function attempt<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      const info = describeError(error);
      toast(info.message);
      if (info.followUp === 'resync') void get().resync();
      return { ok: false, error: info };
    }
  }

  /** Refetches one inbox row (dropping the chat if RLS now hides it) and makes sure its listing is cached. */
  async function refreshChat(chatId: string): Promise<void> {
    try {
      const row = await chatsApi.fetchInboxRow(chatId);
      if (!row) {
        set((state) => dropChat(state, chatId));
        return;
      }
      const listings = get().listings[row.listingId] ? [] : await fetchListingsByIds([row.listingId]);
      set((state) => ({ chats: { ...state.chats, [chatId]: row }, listings: { ...state.listings, ...byId(listings) } }));
    } catch (error) {
      console.warn('[trade-store] refreshChat failed', error);
    }
  }

  /** Cheaper than `hydrate`: just the inbox (preview / unread / status), for the frequent `chat_updated`. */
  async function refreshInbox(): Promise<void> {
    if (!get().me) return;
    const seq = ++inboxRead;
    try {
      const inbox = await chatsApi.fetchInbox();
      const missing = [...new Set(inbox.map((c) => c.listingId))].filter((id) => !get().listings[id]);
      const listings = await fetchListingsByIds(missing);
      if (seq !== inboxRead) return; // a newer inbox read started while this one was in flight
      set((state) => {
        const chats = byId(inbox);
        return {
          chats,
          listings: { ...state.listings, ...byId(listings) },
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id in chats)),
        };
      });
    } catch (error) {
      console.warn('[trade-store] refreshInbox failed', error);
    }
  }

  function scheduleInboxRefresh(): void {
    if (inboxRefreshTimer) clearTimeout(inboxRefreshTimer);
    inboxRefreshTimer = setTimeout(() => {
      inboxRefreshTimer = null;
      void refreshInbox();
    }, 350);
  }

  async function syncMessages(chatId: string): Promise<void> {
    const me = get().me;
    if (!me) return;
    try {
      const since = newestServerTimestamp(get().messages[chatId]);
      const rows = await chatsApi.fetchMessages(chatId, me.id, since ? { since } : {});
      const known = new Set((get().messages[chatId] ?? []).map((m) => m.id));
      set((state) => ({ messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], rows) } }));
      // A gap fill (reconnect, or a channel that finished joining after the message was sent) must mark
      // the chat read just like a live message does, if it is the one on screen.
      if (focusedChats.has(chatId) && rows.some((row) => row.role !== 'me' && row.id && !known.has(row.id))) {
        get().markRead(chatId);
      }
    } catch (error) {
      console.warn('[trade-store] syncMessages failed', error);
    }
  }

  function markFailed(chatId: string, clientId: string): void {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] ?? []).map((m) =>
          m.clientId === clientId && m.delivery === 'pending' ? { ...m, delivery: 'failed' as const } : m,
        ),
      },
    }));
  }

  /** Sends an already-appended optimistic bubble and reconciles it (SUPABASE_PLAN.md §4.3). */
  async function deliver(chatId: string, bubble: ChatMessage, meId: string): Promise<ActionResult> {
    const clientId = bubble.clientId as string;
    try {
      if (bubble.kind === 'image') {
        if (!uploadedImageClients.has(clientId)) {
          const proof = pendingImageProofs.get(clientId);
          if (proof) {
            const { data, contentType } = await readProofBytes(proof);
            await chatsApi.uploadChatImage({ chatId, senderId: meId, clientId, data, contentType });
            uploadedImageClients.add(clientId);
          }
        }
      }
      const row = await chatsApi.sendChatMessage(
        chatId,
        {
          clientId,
          kind: bubble.kind === 'image' ? 'image' : bubble.offer ? 'offer' : 'text',
          body: bubble.text,
          offer: bubble.offer,
          imagePath: bubble.imagePath,
        },
        meId,
      );
      pendingImageProofs.delete(clientId);
      uploadedImageClients.delete(clientId);
      set((state) => ({ messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], [row]) } }));
      return { ok: true, value: undefined };
    } catch (error) {
      const info = describeError(error);
      if (info.sqlState === '23505') {
        // Duplicate client_id: an earlier attempt already landed. Fetch it and reconcile.
        try {
          const landed = await chatsApi.fetchMessageByClientId(chatId, meId, clientId);
          if (landed) {
            pendingImageProofs.delete(clientId);
            uploadedImageClients.delete(clientId);
            set((state) => ({
              messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], [landed]) },
            }));
            return { ok: true, value: undefined };
          }
        } catch {
          /* fall through to failed */
        }
      }
      markFailed(chatId, clientId);
      if (info.followUp === 'resync') {
        // RLS refused (frozen, closed, bailed, blocked): refetch so the composer disables itself.
        toast(info.message);
        void get().resync();
      } else if (bubble.kind === 'image') {
        toast(info.message);
      }
      return { ok: false, error: info };
    }
  }

  const ok = <T,>(value: T): ActionResult<T> => ({ ok: true, value });
  const timeNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return {
    listings: seededListings,
    chats: seededChats.chats,
    messages: seededChats.messages,
    lockByListing: {},
    lockConfirmations: {},
    lockEventVersion: {},
    mockStats: seedMockStats(),
    me: null,
    handshakeRequest: null,
    clearHandshakeRequest: () => set({ handshakeRequest: null }),

    filterLocation: readStoredFilterLocation(),
    recentLocations: readStoredRecentLocations(),
    addRecentLocation: (loc) =>
      set((state) => {
        const next = prependRecentLocation(state.recentLocations, loc);
        if (next === state.recentLocations) return state;
        writeStoredRecentLocations(next);
        return { recentLocations: next };
      }),
    // Sanitized here too, not only in the picker: this value becomes the feed's location query, so nothing
    // coordinate-like may reach it whichever caller sets it. An unusable label keeps the current location.
    setFilterLocation: (loc) =>
      set((state) => {
        const next = sanitizeFilterLocation(loc) ?? state.filterLocation;
        writeStoredFilterLocation(next);
        const nextRecent = prependRecentLocation(state.recentLocations, next);
        if (nextRecent !== state.recentLocations) writeStoredRecentLocations(nextRecent);
        return { filterLocation: next, recentLocations: nextRecent };
      }),
    homeLocation: USE_SUPABASE ? null : sanitizeLocationLabel(mockTrainer.safeLoc),
    setHomeLocation: (loc) =>
      set((state) => {
        const clean = loc === null ? null : sanitizeLocationLabel(loc);
        if (!clean) return { homeLocation: null };
        const nextRecent = prependRecentLocation(state.recentLocations, clean);
        if (nextRecent !== state.recentLocations) writeStoredRecentLocations(nextRecent);
        return { homeLocation: clean, recentLocations: nextRecent };
      }),
    saveHomeLocation: async (loc) => {
      const value = loc === null ? null : sanitizeLocationLabel(loc);
      if (loc !== null && value === null) {
        const error = describeError({ message: 'invalid_location' });
        toast(error.message);
        return { ok: false, error };
      }
      const applyHome = (state: TradeState): Partial<TradeState> => {
        const nextRecent = value ? prependRecentLocation(state.recentLocations, value) : state.recentLocations;
        if (nextRecent !== state.recentLocations) writeStoredRecentLocations(nextRecent);
        const shouldSyncFilter =
          state.homeLocation !== null &&
          value !== null &&
          locationKey(state.filterLocation) === locationKey(state.homeLocation);
        if (shouldSyncFilter) writeStoredFilterLocation(value);
        return {
          homeLocation: value,
          recentLocations: nextRecent,
          ...(shouldSyncFilter ? { filterLocation: value } : {}),
        };
      };
      if (!USE_SUPABASE || !get().me) {
        set(applyHome);
        return ok(undefined);
      }
      const result = await attempt(() => saveHomeLocationApi(value));
      if (result.ok) set(applyHome);
      return result;
    },
    friendship: 'Great',
    setFriendship: (level) => set({ friendship: level }),
    listingFilters: {},
    cycleListingFilter: (key) => set((state) => ({ listingFilters: cycleFilter(state.listingFilters, key) })),
    setListingFilter: (key, mode) => set((state) => ({ listingFilters: setFilterMode(state.listingFilters, key, mode) })),
    clearListingFilters: () => set({ listingFilters: {}, searchPokemonId: null }),
    searchPokemonId: null,
    setSearchPokemonId: (id) => set({ searchPokemonId: id }),

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

    openOffer: async (listingId, selection) => {
      if (!USE_SUPABASE) {
        const listing = get().listings[listingId];
        if (!listing) return { ok: false, error: { code: 'unknown', message: 'That listing is gone.', followUp: 'none' } };
        // A custom offer opens with plain text, exactly as the Supabase branch below sends it. It used to be
        // faked as a `FormalOffer` named 'Custom Offer' wearing the LISTING's `pokemonId` — but a formal offer is
        // a creature, and its name is derived from that id (`creatureDisplayName`), so the card would have read
        // as the listing's own species. There is no creature in a custom offer, so there is no card.
        const opener: ChatMessage =
          selection.kind === 'creature'
            ? { role: 'me', text: '', time: timeNow(), offer: selection.offer }
            : { role: 'me', text: CUSTOM_OFFER_BODY, time: timeNow() };
        const chatId = `c-${Date.now()}`;
        get().addChat({
          id: chatId,
          listingId,
          partner: listing.seller,
          preview: selection.kind === 'creature' ? FORMAL_OFFER_PREVIEW : CUSTOM_OFFER_BODY,
          unread: 0,
          active: true,
          offers: [opener],
        });
        return ok(chatId);
      }

      return attempt(async () => {
        const chatId = await chatsApi.openOffer({
          listingId,
          clientMessageId: randomUUID(),
          ...(selection.kind === 'creature' ? { offer: selection.offer } : { body: CUSTOM_OFFER_BODY }),
        });
        // Load it now so the chat screen renders immediately instead of waiting for the inbox.
        await get().loadChat(chatId);
        return chatId;
      });
    },

    sendMessage: async (chatId, message) => {
      if (!USE_SUPABASE) {
        if ('image' in message) {
          const caption = message.caption?.trim() ?? '';
          const preview = chatsApi.chatImagePreviewText(message.caption);
          set((state) => ({
            ...(state.chats[chatId]
              ? { chats: { ...state.chats, [chatId]: { ...state.chats[chatId], preview } } }
              : {}),
            messages: {
              ...state.messages,
              [chatId]: [
                ...(state.messages[chatId] ?? []),
                { role: 'me', kind: 'image', text: caption, imageUri: message.image.uri, time: timeNow() },
              ],
            },
          }));
          return ok(undefined);
        }
        const offer = 'offer' in message ? message.offer : undefined;
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: [...(state.messages[chatId] ?? []), { role: 'me', text: 'text' in message ? message.text : '', time: timeNow(), offer }],
          },
        }));
        return ok(undefined);
      }

      const me = get().me;
      if (!me) return { ok: false, error: NOT_SIGNED_IN };
      const clientId = randomUUID().toLowerCase();
      const createdAt = new Date().toISOString();
      let bubble: ChatMessage;
      if ('image' in message) {
        const imagePath = chatsApi.chatImageStoragePath(chatId, me.id, clientId);
        pendingImageProofs.set(clientId, message.image);
        bubble = {
          id: clientId,
          clientId,
          senderId: me.id,
          role: 'me',
          kind: 'image',
          text: message.caption?.trim() ?? '',
          imagePath,
          imageUri: message.image.uri,
          createdAt,
          time: chatsApi.formatMessageTime(createdAt),
          delivery: 'pending',
        };
      } else {
        bubble = {
          id: clientId,
          clientId,
          senderId: me.id,
          role: 'me',
          kind: 'offer' in message ? 'offer' : 'text',
          text: 'text' in message ? message.text : '',
          offer: 'offer' in message ? message.offer : undefined,
          createdAt,
          time: chatsApi.formatMessageTime(createdAt),
          delivery: 'pending',
        };
      }
      set((state) => ({ messages: { ...state.messages, [chatId]: [...(state.messages[chatId] ?? []), bubble] } }));
      return deliver(chatId, bubble, me.id);
    },

    retryMessage: async (chatId, clientId) => {
      const me = get().me;
      const bubble = get().messages[chatId]?.find((m) => m.clientId === clientId && m.delivery === 'failed');
      if (!USE_SUPABASE || !me || !bubble) return { ok: false, error: NOT_SIGNED_IN };
      const pending: ChatMessage = { ...bubble, delivery: 'pending' };
      set((state) => ({
        messages: { ...state.messages, [chatId]: (state.messages[chatId] ?? []).map((m) => (m.clientId === clientId ? pending : m)) },
      }));
      return deliver(chatId, pending, me.id);
    },

    markRead: (chatId) => {
      const me = get().me;
      const chat = get().chats[chatId];
      if (!USE_SUPABASE || !me || !chat) return;
      const readUpTo = newestServerTimestamp(get().messages[chatId]) ?? chat.lastMessageAt ?? undefined;
      if (chat.unread > 0) {
        set((state) => ({ chats: { ...state.chats, [chatId]: { ...chat, unread: 0 } } }));
      }
      if (readUpTo) void chatsApi.markChatRead(chatId, me.id, readUpTo).catch((e) => console.warn('[trade-store] markRead failed', e));
    },

    lockChat: async (chatId, offerMessageId) => {
      const refusal = lockRefusal(get(), chatId, offerMessageId);
      if (refusal) return { ok: false, error: describeError({ message: refusal }) };
      if (!USE_SUPABASE) {
        const chat = get().chats[chatId];
        if (chat) {
          set((state) => ({
            lockByListing: { ...state.lockByListing, [chat.listingId]: chatId },
            lockConfirmations: {
              ...state.lockConfirmations,
              [chatId]: { lockedAt: new Date().toISOString(), sellerConfirmedAt: null, buyerConfirmedAt: null },
            },
          }));
        }
        return ok(undefined);
      }
      return attempt(async () => {
        const lock = await chatsApi.lockTrade(chatId, offerMessageId);
        // Do not wait for the Realtime echo: freeze the siblings right away. 'update', not 'insert':
        // the buyer's Handshake auto-opens on the *other* party's device, never on the seller's.
        set((state) =>
          applyLockEvent(
            state,
            {
              op: 'update',
              released: false,
              listingId: lock.listing_id,
              chatId: lock.chat_id,
              sellerConfirmedAt: lock.seller_confirmed_at,
              buyerConfirmedAt: lock.buyer_confirmed_at,
              lockedAt: lock.locked_at,
              updatedAt: lock.updated_at,
            },
            nextLockSeq(),
          ),
        );
        void syncMessages(chatId);
      });
    },

    unlockChat: async (chatId) => {
      if (!USE_SUPABASE) {
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat || state.lockByListing[chat.listingId] !== chatId) return state;
          // Caller = seller (D1). Read the lock confirmations BEFORE they are omitted, like the RPC does.
          const lock = state.lockConfirmations[chatId];
          const outcome = evaluateUnlockOutcome({
            lockedAtIso: lock?.lockedAt ?? null,
            sellerConfirmed: Boolean(lock?.sellerConfirmedAt),
            buyerConfirmed: Boolean(lock?.buyerConfirmedAt),
          });
          return {
            ...(outcome.sellerPenalty > 0
              ? {
                  mockStats: {
                    ...state.mockStats,
                    rep: Math.max(MIN_REP, Math.min(MAX_REP, Math.round((state.mockStats.rep - outcome.sellerPenalty) * 10) / 10)),
                    bailsCount: state.mockStats.bailsCount + 1,
                  },
                }
              : {}),
            lockByListing: omit(state.lockByListing, chat.listingId),
            lockConfirmations: omit(state.lockConfirmations, chatId),
          };
        });
        return ok(undefined);
      }
      return attempt(async () => {
        await chatsApi.unlockTrade(chatId);
        const chat = get().chats[chatId];
        if (chat) {
          set((state) =>
            applyLockEvent(
              state,
              {
                op: 'delete',
                released: true,
                listingId: chat.listingId,
                chatId,
                sellerConfirmedAt: null,
                buyerConfirmedAt: null,
                lockedAt: null,
                updatedAt: null, // a release always applies; see isStaleLock
              },
              nextLockSeq(),
            ),
          );
        }
        void syncMessages(chatId);
      });
    },

    confirmTrade: async (chatId) => {
      if (!USE_SUPABASE) {
        // The mock has one party: marking the trade completed archives the chat and retires the listing.
        const chat = get().chats[chatId];
        get().archiveChat(chatId);
        if (chat) get().removeListing(chat.listingId);
        const nowIso = new Date().toISOString();
        set((state) => ({
          mockStats: {
            ...state.mockStats,
            trades: state.mockStats.trades + 1,
            rep: computeRepAfterTrade(state.mockStats.rep),
            streak: computeStreakAfterTrade(state.mockStats.streak, state.mockStats.lastTradeAt, nowIso),
            lastTradeAt: nowIso,
          },
        }));
        return ok('completed' as const);
      }
      return attempt(async () => {
        const result = await chatsApi.confirmTrade(chatId);
        if (result.state === 'awaiting_partner') {
          const chat = get().chats[chatId];
          const now = new Date().toISOString();
          set((state) => {
            const current = state.lockConfirmations[chatId] ?? { lockedAt: null, sellerConfirmedAt: null, buyerConfirmedAt: null };
            return {
              lockConfirmations: {
                ...state.lockConfirmations,
                [chatId]: chat?.myRole === 'seller' ? { ...current, sellerConfirmedAt: now } : { ...current, buyerConfirmedAt: now },
              },
              // `confirm_trade` reports the resulting state, not the row, so there is no server timestamp
              // to record here — `updatedAt` stays whatever we already held. What protects this write is
              // the local sequence: an in-flight read carries a lower one and cannot overrule it. The
              // server cannot contradict it either — `trade_locks_not_both_confirmed` means the only lock
              // event that can follow my confirmation is my own withdrawal or a release.
              lockEventVersion: {
                ...state.lockEventVersion,
                [chatId]: { updatedAt: state.lockEventVersion[chatId]?.updatedAt ?? null, seq: nextLockSeq() },
              },
            };
          });
        } else {
          // Completed: the lock, listing, this chat and its siblings all changed in one transaction.
          await get().hydrate();
        }
        void syncMessages(chatId);
        return result.state;
      });
    },

    withdrawConfirmation: async (chatId) => {
      if (!USE_SUPABASE) return ok(undefined);
      return attempt(async () => {
        const updatedAt = await chatsApi.withdrawTradeConfirmation(chatId);
        const chat = get().chats[chatId];
        set((state) => {
          const current = state.lockConfirmations[chatId];
          if (!current) return state;
          return {
            lockConfirmations: {
              ...state.lockConfirmations,
              [chatId]: chat?.myRole === 'seller' ? { ...current, sellerConfirmedAt: null } : { ...current, buyerConfirmedAt: null },
            },
            // Stamped with the server's own `trade_locks.updated_at` (the RPC now returns it), not the
            // client clock: `lockSnapshot` and `isStaleLock` compare this against other server timestamps,
            // and a client clock running ahead of the server could make a partner's later, genuinely newer
            // confirmation frame look older and get dropped. The local sequence rides alongside it so an
            // in-flight read cannot overrule this write either.
            lockEventVersion: { ...state.lockEventVersion, [chatId]: { updatedAt, seq: nextLockSeq() } },
          };
        });
        void syncMessages(chatId);
      });
    },

    withdrawListing: async (listingId) => {
      // Same rule the detail screen disables its button by (`withdrawRefusal`), checked again here. Toasted, so a
      // refusal is never silent even if a screen ever shows the button live.
      const refusal = withdrawRefusal(get().listings[listingId], get().lockByListing[listingId] !== undefined);
      if (refusal) {
        const info = describeError({ message: refusal });
        toast(info.message);
        return { ok: false, error: info };
      }
      if (!USE_SUPABASE) {
        set((state) => applyListingWithdrawn(state, listingId));
        return ok(undefined);
      }
      return attempt(async () => {
        await withdrawListingApi(listingId);
        set((state) => applyListingWithdrawn(state, listingId));
      });
    },

    bailChat: async (chatId, reason, note) => {
      if (!USE_SUPABASE) {
        // Read the lock BEFORE removeChat drops it, like the RPC reads trade_locks before deleting it.
        const state = get();
        const lock = state.lockConfirmations[chatId];
        const outcome = evaluateBailOutcome({
          reason,
          lockedAtIso: lock?.lockedAt ?? null,
          callerConfirmed: Boolean(state.chats[chatId]?.myRole === 'buyer' ? lock?.buyerConfirmedAt : lock?.sellerConfirmedAt),
          partnerConfirmed: Boolean(state.chats[chatId]?.myRole === 'buyer' ? lock?.sellerConfirmedAt : lock?.buyerConfirmedAt),
        });
        if (outcome.callerPenalty > 0) {
          set((s) => ({
            mockStats: {
              ...s.mockStats,
              rep: Math.max(MIN_REP, Math.min(MAX_REP, Math.round((s.mockStats.rep - outcome.callerPenalty) * 10) / 10)),
              bailsCount: s.mockStats.bailsCount + 1,
            },
          }));
        }
        get().removeChat(chatId);
        return ok(undefined);
      }
      return attempt(async () => {
        await chatsApi.bailAndBlock(chatId, reason, note);
        // The RPC closes every open chat with that trainer and may relist: refetch rather than patch.
        await get().hydrate();
      });
    },

    // ——— live sync ———

    setMe: (me) => set({ me }),

    hydrate: async () => {
      if (!USE_SUPABASE || !get().me) return;
      const seq = ++inboxRead;
      const readSeq = nextLockSeq();
      // Best effort and in its own try/catch: a failed home-location read must never break the inbox.
      void (async () => {
        try {
          set({ homeLocation: await fetchHomeLocation() });
        } catch (error) {
          console.warn('[trade-store] home location read failed', error);
        }
      })();
      try {
        const [inbox, locks] = await Promise.all([chatsApi.fetchInbox(), chatsApi.fetchMyLocks()]);
        const listings = await fetchListingsByIds([...new Set(inbox.map((chat) => chat.listingId))]);
        if (seq !== inboxRead) return; // a newer inbox read started while this one was in flight
        set((state) => {
          const chats = byId(inbox);
          return {
            chats, // replaces: a chat RLS no longer shows must vanish locally too
            messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id in chats)),
            listings: { ...state.listings, ...byId(listings) },
            ...lockSnapshot(state, locks, listings, readSeq),
          };
        });
      } catch (error) {
        console.warn('[trade-store] hydrate failed', error);
      }
    },

    resync: async () => {
      await get().hydrate();
      await Promise.all([...focusedChats].map((chatId) => syncMessages(chatId)));
    },

    loadChat: async (chatId) => {
      const me = get().me;
      if (!USE_SUPABASE || !me) return 'missing';
      const seq = beginChatRead(chatId);
      const readSeq = nextLockSeq();
      try {
        const row = await chatsApi.fetchInboxRow(chatId);
        if (!row) {
          if (seq === chatReads.get(chatId)) set((state) => dropChat(state, chatId));
          return 'missing';
        }
        const [listings, messages, locks] = await Promise.all([
          fetchListingsByIds([row.listingId]),
          chatsApi.fetchMessages(chatId, me.id),
          chatsApi.fetchMyLocks(),
        ]);
        if (seq !== chatReads.get(chatId)) return 'found'; // superseded by a newer load of this chat
        set((state) => ({
          chats: { ...state.chats, [chatId]: row },
          listings: { ...state.listings, ...byId(listings) },
          messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], messages) },
          ...lockSnapshot(state, locks, listings, readSeq),
        }));
        return 'found';
      } catch (error) {
        console.warn('[trade-store] loadChat failed', error);
        return 'error';
      }
    },

    connectRealtime: (userId) =>
      openPrivateChannel(
        `user:${userId}`,
        {
          // A new parallel offer on my listing (insert) or a status change (update).
          chat: (payload) => {
            const event = chatsApi.parseChatEvent(payload);
            if (event) void refreshChat(event.chatId);
          },
          // Preview / unread moved: coalesce a burst into one inbox read.
          chat_updated: () => scheduleInboxRefresh(),
          lock: (payload) => {
            const event = chatsApi.parseLockEvent(payload);
            if (event) set((state) => applyLockEvent(state, event, nextLockSeq()));
          },
          listing_status: (payload) => {
            const event = chatsApi.parseListingStatusEvent(payload);
            if (event) set((state) => applyListingStatus(state, event.listingId, event.status));
          },
        },
        // Every SUBSCRIBED, including the re-subscribe after a dropped socket: fill the gap.
        () => void get().hydrate(),
      ),

    subscribeToChat: (chatId) => {
      focusedChats.add(chatId);
      const close = openPrivateChannel(
        `chat:${chatId}`,
        {
          message: (payload) => {
            const message = chatsApi.parseMessageEvent(payload, get().me?.id ?? null);
            if (!message) return;
            set((state) => ({ messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], [message]) } }));
            // The chat is on screen, so anything from the other side is read the moment it lands.
            if (message.role !== 'me') get().markRead(chatId);
          },
        },
        () => void syncMessages(chatId),
      );
      return () => {
        focusedChats.delete(chatId);
        close();
      };
    },

    subscribeToListing: (listingId) =>
      openPrivateChannel(
        `listing:${listingId}`,
        {
          listing_status: (payload) => {
            const event = chatsApi.parseListingStatusEvent(payload);
            if (event) set((state) => applyListingStatus(state, event.listingId, event.status));
          },
        },
        () => {},
      ),

    reset: () => {
      if (inboxRefreshTimer) clearTimeout(inboxRefreshTimer);
      inboxRefreshTimer = null;
      focusedChats.clear();
      chatReads.clear();
      pendingImageProofs.clear();
      uploadedImageClients.clear();
      chatsApi.clearChatImageUrlCache();
      inboxRead++; // invalidate anything already in flight
      set({ chats: {}, messages: {}, lockByListing: {}, lockConfirmations: {}, lockEventVersion: {}, handshakeRequest: null, homeLocation: null, me: null });
    },
  };
});
