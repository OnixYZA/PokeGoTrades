export type BackgroundHint = 'meta' | 'legacy' | 'shiny' | 'shadow';

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
  stardust: number;
  iv: string;
  looking: CreatureRef[];
}

export interface ChatMessage {
  role: 'them' | 'me';
  text: string;
  time: string;
}

export interface Chat {
  id: string;
  listingId: string;
  partner: string;
  preview: string;
  unread: number;
  active: boolean;
  offers: ChatMessage[];
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
}
