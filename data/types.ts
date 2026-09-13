export type BackgroundHint = 'meta' | 'legacy' | 'shiny' | 'shadow';

export type TradeType = 
  | 'Standard / Registered'
  | 'Special (Shiny/Legendary) Registered'
  | 'Unregistered (Standard)'
  | 'Unregistered (Shiny/Legendary)';

export const TRADE_COST_MATRIX: Record<TradeType, number> = {
  'Standard / Registered': 100,
  'Special (Shiny/Legendary) Registered': 20000,
  'Unregistered (Standard)': 20000,
  'Unregistered (Shiny/Legendary)': 1000000,
};

export interface CreatureRef {
  name: string;
  hue: number;
  pokemonId: number;
  shiny?: boolean;
  lucky?: boolean;
}

export interface Listing extends CreatureRef {
  id: string;
  form: string;
  year: number;
  lucky: boolean;
  shiny: boolean;
  accent: string;
  bg: BackgroundHint;
  seller: string;
  dist: number;
  loc: string;
  pvp: string;
  demand: string;
  tradeType: TradeType;
  iv: string;
  looking: CreatureRef[];
  untradable?: boolean;
}

export interface FormalOffer {
  name: string;
  pokemonId: number;
  hue: number;
  iv?: string;
  move?: string;
}

export interface ChatMessage {
  role: 'them' | 'me';
  text: string;
  time: string;
  /** Present when this message is an auto-sent formal-offer card rather than plain text. */
  offer?: FormalOffer;
}

export interface Chat {
  id: string;
  listingId: string;
  partner: string;
  preview: string;
  unread: number;
  active: boolean;
  offers: ChatMessage[];
  /** Set on every other chat for the same listing once one of them locks the trade. */
  isFrozen?: boolean;
  /** Set once the trade is marked completed — hidden from the active inbox. */
  archived?: boolean;
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
