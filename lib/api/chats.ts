import type { Chat, ChatMessage, ChatRole, ChatStatus, CreatureRef, FormalOffer, ListingStatus } from '@/data/types';
import type { Database, Json } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

// ——— DB-derived types ———

type Tables = Database['public']['Tables'];

export type BailReason = Database['public']['Enums']['bail_reason'];
export type TradeLockRow = Tables['trade_locks']['Row'];
export type MessageRow = Tables['chat_messages']['Row'];
type InboxRow = Database['public']['Views']['my_inbox']['Row'];

/** A failed request. For RPCs `message` is the stable code ('already_locked') and `sqlState` the class
 *  ('PT409'); see `describeError` in lib/rpc-errors.ts, which is what turns this into a sentence. */
export class ChatApiError extends Error {
  readonly sqlState?: string;

  constructor(message: string, sqlState?: string) {
    super(message);
    this.name = 'ChatApiError';
    this.sqlState = sqlState;
  }
}

function apiError(error: { message: string; code?: string }): ChatApiError {
  return new ChatApiError(error.message, error.code);
}

// ——— mapping ———

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Sortable key for a timestamp: milliseconds * 1000 plus the microseconds Postgres keeps. Optimistic
 * messages use `Date#toISOString()` (`…45.123Z`) and server rows use `…45.123456+00:00`; comparing
 * those as strings, or as `Date` alone, misorders messages that land in the same millisecond.
 */
export function timeKey(iso: string): number {
  const micros = /\.\d{3}(\d{1,3})/.exec(iso)?.[1]?.padEnd(3, '0') ?? '000';
  const ms = Date.parse(iso.replace(/(\.\d{3})\d*/, '$1'));
  return (Number.isNaN(ms) ? 0 : ms) * 1000 + Number(micros);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFormalOffer(value: Json | null | undefined): FormalOffer | undefined {
  if (!isRecord(value)) return undefined;
  const { name, pokemonId, hue, iv, move, shiny, lucky } = value;
  if (typeof name !== 'string' || typeof pokemonId !== 'number' || typeof hue !== 'number') return undefined;
  return {
    name,
    pokemonId,
    hue,
    ...(typeof iv === 'string' ? { iv } : {}),
    ...(typeof move === 'string' ? { move } : {}),
    ...(shiny === true ? { shiny } : {}),
    ...(lucky === true ? { lucky } : {}),
  };
}

/** A creature as the `offer` jsonb `formal_offer_is_valid()` accepts. Only the allowed keys, so nothing else leaks in. */
export function offerToJson(offer: FormalOffer): Json {
  return {
    name: offer.name,
    pokemonId: offer.pokemonId,
    hue: offer.hue,
    ...(offer.shiny ? { shiny: true } : {}),
    ...(offer.lucky ? { lucky: true } : {}),
    ...(offer.iv ? { iv: offer.iv } : {}),
    ...(offer.move ? { move: offer.move } : {}),
  };
}

export function creatureToOffer(creature: CreatureRef): FormalOffer {
  return {
    name: creature.name,
    pokemonId: creature.pokemonId,
    hue: creature.hue,
    ...(creature.shiny ? { shiny: true } : {}),
    ...(creature.lucky ? { lucky: true } : {}),
  };
}

/** `role` has no meaning on the wire ('me' is a different person on the other device), so it is derived here. */
export function toChatMessage(row: MessageRow, meId: string | null): ChatMessage {
  const role: ChatMessage['role'] = row.sender_id === null ? 'system' : row.sender_id === meId ? 'me' : 'them';
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    senderId: row.sender_id,
    role,
    kind: row.kind,
    text: row.body,
    offer: row.kind === 'offer' ? toFormalOffer(row.offer) : undefined,
    systemEvent: row.system_event ?? undefined,
    createdAt: row.created_at,
    time: formatMessageTime(row.created_at),
  };
}

export function toChat(row: InboxRow): Chat | null {
  if (!row.id || !row.listing_id || !row.status || !row.my_role || !row.partner_id) return null;
  return {
    id: row.id,
    listingId: row.listing_id,
    partner: row.partner_handle ?? 'Unknown trainer',
    preview: row.last_message_preview ?? '',
    unread: row.unread ?? 0,
    active: row.status === 'open',
    archived: row.archived_at !== null,
    partnerId: row.partner_id,
    sellerId: row.seller_id ?? undefined,
    buyerId: row.buyer_id ?? undefined,
    myRole: row.my_role,
    status: row.status,
    closedBy: row.closed_by,
    lastMessageAt: row.last_message_at,
  };
}

// ——— RPCs (SUPABASE_PLAN.md §2.4) ———

/**
 * Opens (or reuses) a chat on a listing with a first message and returns its id. Idempotent for a
 * given `clientMessageId`. Pass a formal `offer`, a text `body`, or both.
 */
export async function openOffer(input: {
  listingId: string;
  clientMessageId: string;
  offer?: FormalOffer | null;
  body?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('open_offer', {
    p_listing_id: input.listingId,
    p_client_message_id: input.clientMessageId,
    ...(input.offer ? { p_offer: offerToJson(input.offer) } : {}),
    ...(input.body ? { p_body: input.body } : {}),
  });
  if (error) throw apiError(error);
  return data;
}

/** Seller only (D1): accepts this chat's offer and freezes every competing chat on the listing. */
export async function lockTrade(chatId: string, offerMessageId?: string): Promise<TradeLockRow> {
  const { data, error } = await supabase.rpc('lock_trade', {
    p_chat_id: chatId,
    ...(offerMessageId ? { p_offer_message_id: offerMessageId } : {}),
  });
  if (error) throw apiError(error);
  return data;
}

/** Seller only (D1): re-opens competing offers and clears any confirmation (D2). */
export async function unlockTrade(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('unlock_trade', { p_chat_id: chatId });
  if (error) throw apiError(error);
}

export type ConfirmResult = { state: 'awaiting_partner' } | { state: 'completed'; tradeId: string };

/** Either party of the lock-holder chat (D2). The second confirmation finalizes the trade. */
export async function confirmTrade(chatId: string): Promise<ConfirmResult> {
  const { data, error } = await supabase.rpc('confirm_trade', { p_chat_id: chatId });
  if (error) throw apiError(error);
  if (isRecord(data) && data.state === 'completed') {
    return { state: 'completed', tradeId: typeof data.trade_id === 'string' ? data.trade_id : '' };
  }
  return { state: 'awaiting_partner' };
}

/** Allowed until the partner confirms. Returns the lock row's new server `updated_at`, so the caller can
 *  version `lockEventVersion` with the server clock instead of its own (clock-skew safety; see the stale-
 *  frame guard in store/lock-state.ts). */
export async function withdrawTradeConfirmation(chatId: string): Promise<string> {
  const { data, error } = await supabase.rpc('withdraw_trade_confirmation', { p_chat_id: chatId });
  if (error) throw apiError(error);
  return data;
}

/** Closes every open chat between the pair, releases any lock, blocks, and files a report for 'spoofer' or a note. */
export async function bailAndBlock(chatId: string, reason: BailReason, note?: string): Promise<void> {
  const { error } = await supabase.rpc('bail_and_block', {
    p_chat_id: chatId,
    p_reason: reason,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw apiError(error);
}

export interface Handshake {
  myRole: ChatRole;
  myHandle: string;
  /** Raw 12 digits. */
  myFriendCode: string | null;
  partnerId: string;
  partnerHandle: string;
  partnerFriendCode: string | null;
  partnerSafeLoc: string | null;
  partnerTradesCount: number;
  lockedAt: string;
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
}

/** The only path through which a partner's friend code is revealed, and only while the lock holds. */
export async function getHandshake(chatId: string): Promise<Handshake> {
  const { data, error } = await supabase.rpc('get_handshake', { p_chat_id: chatId });
  if (error) throw apiError(error);
  const row = data[0];
  if (!row) throw new ChatApiError('handshake_unavailable', 'PT403');
  // The generated return type says non-null, but these columns are null until someone confirms.
  const nullable = (value: string | null | undefined) => value ?? null;
  return {
    myRole: row.my_role,
    myHandle: row.my_handle,
    myFriendCode: nullable(row.my_friend_code),
    partnerId: row.partner_id,
    partnerHandle: row.partner_handle,
    partnerFriendCode: nullable(row.partner_friend_code),
    partnerSafeLoc: nullable(row.partner_safe_loc),
    partnerTradesCount: row.partner_trades_count,
    lockedAt: row.lock_locked_at,
    sellerConfirmedAt: nullable(row.lock_seller_confirmed_at),
    buyerConfirmedAt: nullable(row.lock_buyer_confirmed_at),
  };
}

// ——— initial state ———

/**
 * The newest `INBOX_PAGE_SIZE` chats, most recently active first. This runs on every mount, every resync
 * and every realtime reconnect, so it is bounded: an unbounded read grows with the trainer's whole history
 * and is refetched on each of those. Ordering is by activity, so the cut is at the quiet end — the chats a
 * trainer is actually trading in are always in the page. A trainer past this many active chats would need
 * inbox paging to see the rest, which the UI does not offer yet.
 */
export const INBOX_PAGE_SIZE = 50;

/** Every chat the signed-in trainer is in, with the server-computed preview and unread count. */
export async function fetchInbox(): Promise<Chat[]> {
  const { data, error } = await supabase
    .from('my_inbox')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(INBOX_PAGE_SIZE);
  if (error) throw apiError(error);
  return data.map(toChat).filter((chat): chat is Chat => chat !== null);
}

/** One inbox row, or null when the chat does not exist or RLS hides it (so the caller can drop it locally). */
export async function fetchInboxRow(chatId: string): Promise<Chat | null> {
  const { data, error } = await supabase.from('my_inbox').select('*').eq('id', chatId).maybeSingle();
  if (error) throw apiError(error);
  return data ? toChat(data) : null;
}

export const MESSAGE_PAGE_SIZE = 100;

/**
 * A chat's messages, oldest first. With `since` this is the gap fill after a reconnect: every row at or
 * after that timestamp — `>=`, not `>`, so rows sharing the timestamp are not skipped; the store
 * de-duplicates by id. Without it, the latest page.
 */
export async function fetchMessages(
  chatId: string,
  meId: string | null,
  options: { since?: string; limit?: number } = {}
): Promise<ChatMessage[]> {
  if (options.since !== undefined) return gapFill(chatId, meId, options.since);
  return latestPage(chatId, meId, options.limit ?? MESSAGE_PAGE_SIZE);
}

/** The newest `limit` messages, returned oldest-first like every other read here. */
async function latestPage(chatId: string, meId: string | null, limit: number): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw apiError(error);
  return data.reverse().map((row) => toChatMessage(row, meId));
}

/**
 * How much of a backlog a reconnect will walk before it gives up on filling the gap message by message.
 * Reached only after a very long absence from a very busy chat.
 */
export const GAP_FILL_MAX_MESSAGES = 500;

/**
 * The reconnect gap fill: every row at or after `since`, walked a page at a time.
 *
 * This used to be one unbounded request, which after a long offline spell could pull thousands of rows
 * into one render. A plain `.limit()` would bound it but silently drop everything past the first page —
 * the trainer would reconnect and never see the rest — so the fill pages instead and stops only when the
 * gap is genuinely drained.
 *
 * Paging is keyset, on the same `(created_at, id)` the query orders by, because `created_at` alone is not
 * unique: messages written in the same transaction share a timestamp, and a cursor of `created_at > last`
 * would step straight over any that straddle a page boundary. The first page keeps the inclusive `>=` of
 * the original (rows sharing `since` must not be skipped); the store de-duplicates by id.
 */
async function gapFill(chatId: string, meId: string | null, since: string): Promise<ChatMessage[]> {
  const rows: MessageRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;

  for (;;) {
    const page = await gapFillPage(chatId, since, cursor);
    rows.push(...page);
    if (page.length < MESSAGE_PAGE_SIZE) break; // drained: the last page was short

    if (rows.length >= GAP_FILL_MAX_MESSAGES) {
      // The gap is bigger than we are willing to walk. Returning what we have would leave the thread
      // ending hundreds of messages in the past, which reads as a broken chat; the newest page at least
      // shows the conversation as it stands now. The hole is above it, where the UI does not look yet.
      return latestPage(chatId, meId, MESSAGE_PAGE_SIZE);
    }
    const last = page[page.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }
  return rows.map((row) => toChatMessage(row, meId));
}

/** One page of the gap fill: from `since` inclusive, or strictly after `cursor` in `(created_at, id)`. */
async function gapFillPage(
  chatId: string,
  since: string,
  cursor: { createdAt: string; id: string } | null,
): Promise<MessageRow[]> {
  const base = supabase.from('chat_messages').select('*').eq('chat_id', chatId);
  const filtered = cursor
    ? base.or(`created_at.gt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.gt.${cursor.id})`)
    : base.gte('created_at', since);
  const { data, error } = await filtered
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);
  if (error) throw apiError(error);
  return data;
}

/** Every trade lock the signed-in trainer is a party to (RLS hides all others). */
export async function fetchMyLocks(): Promise<TradeLockRow[]> {
  const { data, error } = await supabase.from('trade_locks').select('*');
  if (error) throw apiError(error);
  return data;
}

// ——— messages and read state ———

export interface OutgoingChatMessage {
  /** Idempotency key: `chat_messages` is unique on (sender_id, client_id), so a retry cannot double-post. */
  clientId: string;
  kind: 'text' | 'offer';
  body?: string;
  offer?: FormalOffer;
}

/** Inserts a message as the caller (`sender_id` defaults to `auth.uid()`; RLS checks the chat is postable). */
export async function sendChatMessage(chatId: string, message: OutgoingChatMessage, meId: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      chat_id: chatId,
      client_id: message.clientId,
      kind: message.kind,
      body: message.body ?? '',
      offer: message.offer ? offerToJson(message.offer) : null,
    })
    .select()
    .single();
  if (error) throw apiError(error);
  return toChatMessage(data, meId);
}

/** After a duplicate-key error the message already landed; this fetches it so the bubble can reconcile. */
export async function fetchMessageByClientId(chatId: string, meId: string, clientId: string): Promise<ChatMessage | null> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .eq('sender_id', meId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw apiError(error);
  return data ? toChatMessage(data, meId) : null;
}

/** Read receipt: everything up to `readUpTo` (a server `created_at`) counts as read. Server time, not the device clock. */
export async function markChatRead(chatId: string, meId: string, readUpTo: string): Promise<void> {
  const { error } = await supabase
    .from('chat_members')
    .update({ last_read_at: readUpTo })
    .eq('chat_id', chatId)
    .eq('user_id', meId);
  if (error) throw apiError(error);
}

// ——— realtime payloads (SUPABASE_PLAN.md §1.10). Validated: they arrive over the network. ———

const isString = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown): string | null => (isString(value) ? value : null);

const CHAT_STATUSES: readonly string[] = ['open', 'bailed', 'completed', 'closed'] satisfies ChatStatus[];
const LISTING_STATUSES: readonly string[] = ['open', 'locked', 'completed', 'withdrawn'] satisfies ListingStatus[];

/** `user:<uid>` `chat`: a new parallel offer on my listing (insert) or a status change (update). */
export interface ChatEvent {
  op: 'insert' | 'update';
  chatId: string;
  listingId: string;
  status: ChatStatus;
}

export function parseChatEvent(payload: unknown): ChatEvent | null {
  if (!isRecord(payload)) return null;
  const { op, chat_id, listing_id, status } = payload;
  if ((op !== 'insert' && op !== 'update') || !isString(chat_id) || !isString(listing_id)) return null;
  if (!isString(status) || !CHAT_STATUSES.includes(status)) return null;
  return { op, chatId: chat_id, listingId: listing_id, status: status as ChatStatus };
}

/** `user:<uid>` `lock`: the trade lock was taken, its confirmations changed, or it was released. */
export interface LockEvent {
  op: 'insert' | 'update' | 'delete';
  released: boolean;
  listingId: string;
  chatId: string;
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
  /**
   * `trade_locks.updated_at`: the token that orders two observations of the same lock, so a frame that
   * overtakes a newer one can be recognised and dropped (migration …000300). Null only for a payload from
   * a server that predates that migration, which the store treats as "unordered, apply it".
   */
  updatedAt: string | null;
}

export function parseLockEvent(payload: unknown): LockEvent | null {
  if (!isRecord(payload)) return null;
  const { op, released, listing_id, chat_id } = payload;
  if ((op !== 'insert' && op !== 'update' && op !== 'delete') || !isString(listing_id) || !isString(chat_id)) return null;
  return {
    op,
    released: released === true || op === 'delete',
    listingId: listing_id,
    chatId: chat_id,
    sellerConfirmedAt: nullableString(payload.seller_confirmed_at),
    buyerConfirmedAt: nullableString(payload.buyer_confirmed_at),
    updatedAt: nullableString(payload.updated_at),
  };
}

/** `user:<uid>` and `listing:<id>` `listing_status`. Carries no lock holder: a frozen sibling never learns who won. */
export interface ListingStatusEvent {
  listingId: string;
  status: ListingStatus;
}

export function parseListingStatusEvent(payload: unknown): ListingStatusEvent | null {
  if (!isRecord(payload)) return null;
  const { listing_id, status } = payload;
  if (!isString(listing_id) || !isString(status) || !LISTING_STATUSES.includes(status)) return null;
  return { listingId: listing_id, status: status as ListingStatus };
}

/** `chat:<id>` `message`: the full `chat_messages` row. */
export function parseMessageEvent(payload: unknown, meId: string | null): ChatMessage | null {
  if (!isRecord(payload)) return null;
  const { id, chat_id, kind, body, created_at } = payload;
  if (!isString(id) || !isString(chat_id) || !isString(created_at) || !isString(body)) return null;
  if (kind !== 'text' && kind !== 'offer' && kind !== 'system') return null;
  return toChatMessage(
    {
      id,
      chat_id,
      kind,
      body,
      created_at,
      sender_id: nullableString(payload.sender_id),
      client_id: nullableString(payload.client_id),
      offer: (payload.offer ?? null) as Json | null,
      system_event: nullableString(payload.system_event) as MessageRow['system_event'],
    },
    meId
  );
}
