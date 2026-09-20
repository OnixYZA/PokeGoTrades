import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { chats as seedChats, fallbackOffers } from '@/data/chats';
import { listings as seedListings } from '@/data/listings';
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
import { fetchListingsByIds } from '@/lib/api/listings';
import { USE_SUPABASE } from '@/lib/data-source';
import { openPrivateChannel } from '@/lib/realtime';
import { describeError, type ErrorInfo } from '@/lib/rpc-errors';
import { toast } from '@/lib/toast';

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

/** `lockByListing` value when the listing is locked but the lock is not visible to me: a competing
 *  buyer only ever learns "frozen", never who won (SUPABASE_PLAN.md §4.2). */
export const LOCK_HELD_ELSEWHERE = '__elsewhere__' as const;

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

/** Each side's confirmation timestamp for the chat that holds a listing's lock (D2). */
export interface LockConfirmations {
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
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
export type OutgoingMessage = { text: string } | { offer: FormalOffer };

const CUSTOM_OFFER_BODY = "Custom offer — let's work out the details here.";

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
  lockEventVersion: Record<string, string>;
  /** chatId -> each side's confirmation of the trade that chat holds. Live chats only. */
  lockConfirmations: Record<string, LockConfirmations>;
  /** The signed-in trainer. Set by `LiveSync`; message roles are derived against it. */
  me: { id: string } | null;
  /** A chat whose Handshake should open by itself: the buyer's, when the seller locks (D1). */
  handshakeRequest: string | null;
  clearHandshakeRequest: () => void;

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
  /** Seller only (D1). Locks this chat's trade, freezing every sibling chat competing for the listing. */
  lockChat: (chatId: string) => Promise<ActionResult>;
  /** Seller only (D1). Unlocks, thawing the siblings; only the current lock holder can. */
  unlockChat: (chatId: string) => Promise<ActionResult>;
  /** Either party (D2). The second confirmation completes the trade. */
  confirmTrade: (chatId: string) => Promise<ActionResult<'awaiting_partner' | 'completed'>>;
  withdrawConfirmation: (chatId: string) => Promise<ActionResult>;
  /** Bail & Block: closes the chat (and every open chat with that trainer), releases the lock, blocks. */
  bailChat: (chatId: string, reason: chatsApi.BailReason, note?: string) => Promise<ActionResult>;

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
    else merged[index] = message;
  }
  return sortMessages(merged);
}

function newestServerTimestamp(list: ChatMessage[] | undefined): string | undefined {
  return list ? [...list].reverse().find((m) => m.createdAt && !m.delivery)?.createdAt : undefined;
}

// ——— lock reconciliation ———

/**
 * Rebuilds lock state from a fresh read (SUPABASE_PLAN.md §4.2): for each listing whose status is known,
 * `locked` maps to the visible lock's chat, or to `LOCK_HELD_ELSEWHERE` when its holder is hidden from me,
 * and anything else clears it. Confirmations come from the locks I am a party to.
 */
function lockSnapshot(
  state: Pick<TradeState, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion'>,
  locks: chatsApi.TradeLockRow[],
  listings: Listing[],
  /** When this read left the client. Anything learned since is newer than the read, by construction. */
  readAt: string,
): Pick<TradeState, 'lockByListing' | 'lockConfirmations' | 'lockEventVersion'> {
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

/**
 * True when this observation of a lock is older than what we already applied for that chat.
 *
 * A release is never stale: the row is gone, and `updated_at` on a DELETE is the value the row held before
 * it was removed, so it can legitimately look older than a confirmation that preceded it. Ignoring a
 * release would strand the UI on a lock that no longer exists, which is far worse than replaying one.
 */
function isStaleLock(state: TradeState, chatId: string, updatedAt: string | null, released: boolean): boolean {
  if (released || !updatedAt) return false; // unordered payload (pre-migration server): apply it
  const seen = state.lockEventVersion[chatId];
  return seen !== undefined && updatedAt < seen;
}

function applyLockEvent(state: TradeState, event: chatsApi.LockEvent): Partial<TradeState> {
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

function applyListingStatus(state: TradeState, listingId: string, status: ListingStatus): Partial<TradeState> {
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

function dropChat(state: TradeState, chatId: string): Partial<TradeState> {
  const chat = state.chats[chatId];
  if (!chat) return {};
  return {
    chats: omit(state.chats, chatId),
    messages: omit(state.messages, chatId),
    lockConfirmations: omit(state.lockConfirmations, chatId),
    lockEventVersion: omit(state.lockEventVersion, chatId),
    lockByListing: state.lockByListing[chat.listingId] === chatId ? omit(state.lockByListing, chat.listingId) : state.lockByListing,
  };
}

// ——— module state for the live layer ———

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

function beginChatRead(chatId: string): number {
  const seq = (chatReads.get(chatId) ?? 0) + 1;
  chatReads.set(chatId, seq);
  return seq;
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
      const row = await chatsApi.sendChatMessage(
        chatId,
        { clientId, kind: bubble.offer ? 'offer' : 'text', body: bubble.text, offer: bubble.offer },
        meId,
      );
      set((state) => ({ messages: { ...state.messages, [chatId]: mergeMessages(state.messages[chatId] ?? [], [row]) } }));
      return { ok: true, value: undefined };
    } catch (error) {
      const info = describeError(error);
      if (info.sqlState === '23505') {
        // Duplicate client_id: an earlier attempt already landed. Fetch it and reconcile.
        try {
          const landed = await chatsApi.fetchMessageByClientId(chatId, meId, clientId);
          if (landed) {
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
    me: null,
    handshakeRequest: null,
    clearHandshakeRequest: () => set({ handshakeRequest: null }),

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

    openOffer: async (listingId, selection) => {
      if (!USE_SUPABASE) {
        const listing = get().listings[listingId];
        if (!listing) return { ok: false, error: { code: 'unknown', message: 'That listing is gone.', followUp: 'none' } };
        const offer: FormalOffer =
          selection.kind === 'creature'
            ? selection.offer
            : { name: 'Custom Offer', pokemonId: listing.pokemonId, hue: listing.hue };
        const chatId = `c-${Date.now()}`;
        get().addChat({
          id: chatId,
          listingId,
          partner: listing.seller,
          preview: `Formal offer sent · ${offer.name}`,
          unread: 0,
          active: true,
          offers: [{ role: 'me', text: '', time: timeNow(), offer }],
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
      const clientId = randomUUID();
      const createdAt = new Date().toISOString();
      const bubble: ChatMessage = {
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

    lockChat: async (chatId) => {
      if (!USE_SUPABASE) {
        const chat = get().chats[chatId];
        if (chat) set((state) => ({ lockByListing: { ...state.lockByListing, [chat.listingId]: chatId } }));
        return ok(undefined);
      }
      return attempt(async () => {
        const lock = await chatsApi.lockTrade(chatId);
        // Do not wait for the Realtime echo: freeze the siblings right away. 'update', not 'insert':
        // the buyer's Handshake auto-opens on the *other* party's device, never on the seller's.
        set((state) =>
          applyLockEvent(state, {
            op: 'update',
            released: false,
            listingId: lock.listing_id,
            chatId: lock.chat_id,
            sellerConfirmedAt: lock.seller_confirmed_at,
            buyerConfirmedAt: lock.buyer_confirmed_at,
            updatedAt: lock.updated_at,
          }),
        );
        void syncMessages(chatId);
      });
    },

    unlockChat: async (chatId) => {
      if (!USE_SUPABASE) {
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat || state.lockByListing[chat.listingId] !== chatId) return state;
          return { lockByListing: omit(state.lockByListing, chat.listingId) };
        });
        return ok(undefined);
      }
      return attempt(async () => {
        await chatsApi.unlockTrade(chatId);
        const chat = get().chats[chatId];
        if (chat) {
          set((state) =>
            applyLockEvent(state, {
              op: 'delete',
              released: true,
              listingId: chat.listingId,
              chatId,
              sellerConfirmedAt: null,
              buyerConfirmedAt: null,
              updatedAt: null, // a release always applies; see isStaleLock
            }),
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
        return ok('completed' as const);
      }
      return attempt(async () => {
        const result = await chatsApi.confirmTrade(chatId);
        if (result.state === 'awaiting_partner') {
          const chat = get().chats[chatId];
          const now = new Date().toISOString();
          set((state) => {
            const current = state.lockConfirmations[chatId] ?? { sellerConfirmedAt: null, buyerConfirmedAt: null };
            return {
              lockConfirmations: {
                ...state.lockConfirmations,
                [chatId]: chat?.myRole === 'seller' ? { ...current, sellerConfirmedAt: now } : { ...current, buyerConfirmedAt: now },
              },
              // Stamped with the client clock so an older in-flight read cannot undo it: `lockSnapshot`
              // compares this against its own `readAt`, and both come from this same clock. The server
              // cannot contradict it either — `trade_locks_not_both_confirmed` means the only lock event
              // that can follow my confirmation is my own withdrawal or a release, and a release always
              // applies regardless of version.
              lockEventVersion: { ...state.lockEventVersion, [chatId]: now },
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
        await chatsApi.withdrawTradeConfirmation(chatId);
        const chat = get().chats[chatId];
        set((state) => {
          const current = state.lockConfirmations[chatId];
          if (!current) return state;
          return {
            lockConfirmations: {
              ...state.lockConfirmations,
              [chatId]: chat?.myRole === 'seller' ? { ...current, sellerConfirmedAt: null } : { ...current, buyerConfirmedAt: null },
            },
            lockEventVersion: { ...state.lockEventVersion, [chatId]: new Date().toISOString() },
          };
        });
        void syncMessages(chatId);
      });
    },

    bailChat: async (chatId, reason, note) => {
      if (!USE_SUPABASE) {
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
      const readAt = new Date().toISOString();
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
            ...lockSnapshot(state, locks, listings, readAt),
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
      const readAt = new Date().toISOString();
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
          ...lockSnapshot(state, locks, listings, readAt),
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
            if (event) set((state) => applyLockEvent(state, event));
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
      inboxRead++; // invalidate anything already in flight
      set({ chats: {}, messages: {}, lockByListing: {}, lockConfirmations: {}, lockEventVersion: {}, handshakeRequest: null, me: null });
    },
  };
});
