export type BackgroundHint = 'meta' | 'legacy' | 'shiny' | 'shadow';

export type TradeType =
  | 'Standard / Registered'
  | 'Special (Shiny/Legendary) Registered'
  | 'Unregistered (Standard)'
  | 'Unregistered (Shiny/Legendary)';

/** Friendship tier, from lowest to highest. Drives the Stardust discount in `TRADE_COST_MATRIX`. */
export type FriendshipLabel = 'Good' | 'Great' | 'Ultra' | 'Best';

/**
 * Single source of truth for Stardust cost, by trade type and friendship tier. Standard trades
 * stay flat at the base cost regardless of friendship (matches live game behavior); only Special
 * and Unregistered trades get the friendship discount.
 */
export const TRADE_COST_MATRIX: Record<TradeType, Record<FriendshipLabel, number>> = {
  'Standard / Registered': { Good: 100, Great: 100, Ultra: 100, Best: 100 },
  'Special (Shiny/Legendary) Registered': { Good: 20000, Great: 16000, Ultra: 1600, Best: 800 },
  'Unregistered (Standard)': { Good: 20000, Great: 16000, Ultra: 1600, Best: 800 },
  'Unregistered (Shiny/Legendary)': { Good: 1000000, Great: 800000, Ultra: 80000, Best: 40000 },
};

export interface CreatureRef {
  name: string;
  hue: number;
  pokemonId: number;
  shiny?: boolean;
  lucky?: boolean;
}

/** Server-side lifecycle of a listing. The feed shows `open` and `locked`. */
export type ListingStatus = 'open' | 'locked' | 'completed' | 'withdrawn';

export interface Listing extends CreatureRef {
  id: string;
  form: string;
  year: number;
  lucky: boolean;
  shiny: boolean;
  accent: string;
  bg: BackgroundHint;
  seller: string;
  /** Profile uuid of the seller. Only Supabase-backed listings carry it. */
  sellerId?: string;
  /** Kilometres from the viewer. Mock data only: proximity is not persisted (SUPABASE_PLAN.md D3),
   *  so Supabase-backed listings leave it undefined and the UI hides the badge. */
  dist?: number;
  loc: string;
  pvp: string;
  demand: string;
  tradeType: TradeType;
  iv: string;
  looking: CreatureRef[];
  untradable?: boolean;
  /** Proof photos (appraisal, movesets, event badges, ...) — multiple, replacing the old
   *  single-screenshot assumption. Optional since existing seed listings predate this field. */
  screenshots?: string[];
  /** Freeform listing tags the seller picks at creation time (e.g. "Legacy Move", "PvP Ready"). */
  tags?: string[];
  /** Seller's own terms / context, shown to buyers on the card. */
  notes?: string;
  /** Only Supabase-backed listings carry a status; the mock data predates it. */
  status?: ListingStatus;
}

export interface FormalOffer {
  name: string;
  pokemonId: number;
  hue: number;
  iv?: string;
  move?: string;
  /** Server offers carry these so the card stops guessing; the mock offers predate them. */
  shiny?: boolean;
  lucky?: boolean;
}

export type ChatStatus = 'open' | 'bailed' | 'completed' | 'closed';
export type ChatRole = 'seller' | 'buyer';

export interface ChatMessage {
  /** 'system' rows (lock / unlock / confirm / completed / closed) exist only on Supabase-backed chats. */
  role: 'them' | 'me' | 'system';
  text: string;
  time: string;
  /** Present when this message is an auto-sent formal-offer card rather than plain text. */
  offer?: FormalOffer;

  // ——— Supabase-backed messages only; the mock thread predates all of these ———
  /** Server row id. For an unconfirmed optimistic message this equals `clientId`. */
  id?: string;
  /** Idempotency key generated on the device (`chat_messages.client_id`). */
  clientId?: string;
  /** `null` for system rows. `role` is derived from this at mapping time: 'me' has no meaning on the other device. */
  senderId?: string | null;
  kind?: 'text' | 'offer' | 'system';
  /** ISO timestamp; `time` is the display string derived from it. */
  createdAt?: string;
  systemEvent?: string;
  /** Set only while an optimistic send is unconfirmed or has failed. */
  delivery?: 'pending' | 'failed';
}

export interface Chat {
  id: string;
  listingId: string;
  partner: string;
  preview: string;
  unread: number;
  active: boolean;
  /** Set once the trade is marked completed — hidden from the active inbox. */
  archived?: boolean;

  // ——— Supabase-backed chats only (`my_inbox`); the mock data predates all of these ———
  partnerId?: string;
  sellerId?: string;
  buyerId?: string;
  /** Which side of the trade the signed-in trainer is on. Its presence marks a live chat. */
  myRole?: ChatRole;
  status?: ChatStatus;
  closedBy?: string | null;
  lastMessageAt?: string | null;
}

/** A `Chat` plus its opening messages, as seeded from `data/chats.ts` or created via `addChat`.
 *  The store splits `offers` into its own normalized `messages` slice on ingest — a live `Chat`
 *  record never carries messages directly, so there's exactly one place they can drift. */
export interface ChatSeed extends Chat {
  offers: ChatMessage[];
}

export interface TradeHistoryEntry {
  id: string;
  gave: CreatureRef;
  got: CreatureRef;
  partner: string;
  date: string;
}

export interface Trainer {
  handle: string;
  code: string;
  lvl: number;
  team: string;
  bio: string;
  safeLoc: string;
  trades: number;
  rep: number;
  streak: number;
  arsenal: CreatureRef[];
  wishlist: CreatureRef[];
  tradeHistory: TradeHistoryEntry[];
}
