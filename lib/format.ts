// A RUNTIME import of the dex, by relative path: this module is loaded straight by vitest (no `@/` alias,
// no react-native), and `constants/pokedex.ts` is itself plain TypeScript over a generated data table with
// relative imports only — `constants/pokedex.test.ts` already loads it the same way. `lib/api/creature-ref.ts`
// imports THIS module for the same reason, so keep that chain relative and free of anything platform-specific.
import { findPokemon } from '../constants/pokedex';
import type { PokemonTypes } from '../constants/pokemon-types';

export function fmtDust(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** What `speciesName` accepts: the creature's identity (`pokemonId`, required) and, optionally, whatever
 *  name was stored beside it. Structural, so a `CreatureRef`, a `Listing`, a `FormalOffer`, a `PokedexEntry`
 *  or an ad-hoc literal all fit. */
export interface NamedCreature {
  /** The national dex id — the creature's identity, and the ONLY thing its displayed name is derived from. */
  pokemonId: number;
  /** The free text stored beside the id (`listings.name`, a `looking[]` / `trainer_creatures` / offer
   *  `name`). A fallback for an id the dex doesn't know, never the source of what is shown (see `speciesName`). */
  name?: string;
}

/** A leading "Shiny " / "Sh. " marker, repeated, in any case: the spellings that stored names have picked up
 *  ("Shiny Kyogre", "Sh. Mewtwo", and "Shiny Shiny ..." once the prefix was added on top of one). Needs a
 *  separator after the word, so a species that merely starts with the letters ("Shinx") is untouched. */
const SHINY_MARKER = /^(?:shiny\s+|sh\.\s*)+/i;

/**
 * What a creature is called, without any shiny prefix: the dex's name for its `pokemonId`.
 *
 * Identity lives in `pokemonId` (plus the structured `formCode` / `shiny` / `lucky` / `costumeCode` flags),
 * and `constants/pokedex.ts` is the one source of truth for what that id is called (AGENTS.md: never
 * hallucinate game data). The `name` string stored next to it in the jsonb (`listings.name`,
 * `listings.looking[]`, `trainer_creatures.creature`, `chat_messages.offer`) is free text that drifted: it had
 * attributes typed into it ("Shiny Kyogre", "Sh. Mewtwo", "Legacy Dnite", "Purified Apex Ho-Oh"), and the
 * display then prefixed "Shiny " on top of a name that already said it ("Shiny Shiny Kyogre"). So the
 * displayed name is never taken from it. Deriving it from the id makes that whole class of bug impossible
 * rather than patching each spelling: whatever a row stores, the screen shows the dex name.
 *
 * The stored `name` is used ONLY for an id the dex doesn't have (synthetic / mock ids exist), with any
 * leading shiny marker stripped so `creatureDisplayName` can add exactly one. A name that is nothing but a
 * marker, or no name at all, falls back to the dex number rather than rendering an empty string.
 */
export function speciesName(c: NamedCreature): string {
  const dexName = findPokemon(c.pokemonId)?.name;
  if (dexName !== undefined) return dexName;
  const stripped = (c.name ?? '').trim().replace(SHINY_MARKER, '').trim();
  return stripped || `Pokémon #${c.pokemonId}`;
}

/** The one place a shiny creature's display name gets its `"Shiny "` prefix — every screen that shows a
 *  creature's name to the trainer routes through this, so a shiny reads "Shiny Raboot" everywhere, not
 *  just wherever a screen happened to remember to say so (`app/(tabs)/profile.tsx`'s add-toast and
 *  `PokemonPickerModal`'s accessibility label used to each hand-roll this separately).
 *
 *  The species part is `speciesName(c)` — the dex's name for `c.pokemonId`, NOT the stored `name` — and the
 *  `shiny` flag is the only authority on whether the prefix is added, so the result carries exactly one
 *  "Shiny " or none, whatever the stored text says. `pokemonId` is therefore required: a name cannot be
 *  formatted without the identity it is derived from.
 *
 *  Typed structurally rather than as `CreatureRef` so it also takes a `Listing`, a `FormalOffer`, or an
 *  ad-hoc `{ pokemonId, shiny }` literal — never mutates its argument, and never the thing to reach for
 *  when a stable identity is needed instead (a `key`, an equality check: use `spriteVariantKey`). Anything
 *  the stored name used to carry beyond the species (a form, "Purified", "Legacy") is NOT shown by this:
 *  a form is shown through its structured field (`formCode` via `creatureFormLabel`; a listing's `form`),
 *  and a listing's Purified / Costume / tags are badges of their own. */
export function creatureDisplayName(c: NamedCreature & { shiny?: boolean | null }): string {
  const species = speciesName(c);
  return c.shiny ? `Shiny ${species}` : species;
}

/** A trade-history date as `TradeHistoryGrid` renders it, e.g. `'Aug 22, 2026'` — the one place that
 *  format is decided, so a live `completed_at` timestamp (`fetchMyTradeHistory`) and
 *  `data/publicProfile.ts`'s synthetic "N months ago" date can never drift apart in shape. */
export function formatTradeDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}


/** A PokeMiners form code as display text, e.g. `'CROWNED_SWORD'` -> `'Crowned Sword'`. The codes are sprite
 *  keys (`lib/sprite-url.ts`), not names, so this only re-cases them — it never maps one onto a different name,
 *  which is also why a formal offer (which carries a code and no display form) is shown through it. */
export function formCodeLabel(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/** A creature's form as a line of text — `formCodeLabel` of its `formCode`, or `undefined` for the species'
 *  default form. The structured home of what a stored name used to say in prose ("Origin Palkia", "Primal
 *  Groudon", "Mega Rayquaza"): `creatureDisplayName` shows the dex species only, so a screen that has room
 *  for a second line shows the form here instead, and the two can never disagree about which form it is.
 *  Same caveat as `formCodeLabel`: it re-cases the sprite code, it does not translate it, so a code with no
 *  readable word in it (`'A'`, Armored Mewtwo) reads as itself. */
export function creatureFormLabel(c: { formCode?: string | null }): string | undefined {
  return c.formCode ? formCodeLabel(c.formCode) : undefined;
}

/** A creature's typing as a screen reader should hear it, e.g. `['Fire', 'Flying']` -> `'Fire and Flying type'`
 *  and `['Fairy']` -> `'Fairy type'`. The one wording every type label shares (`TypeBadge`, the Pokémon
 *  picker's rows, a formal offer's card), so they cannot disagree on it. Primary type first, as `PokemonTypes` orders it. */
export function describeTypes(types: PokemonTypes): string {
  return `${types.join(' and ')} type`;
}
