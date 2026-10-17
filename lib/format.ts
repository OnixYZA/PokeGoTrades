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


/** A PokeMiners form code re-cased as display text, e.g. `'CROWNED_SWORD'` -> `'Crowned Sword'`. The codes are
 *  sprite keys (`lib/sprite-url.ts`), not names, so this only re-cases them — it never maps one onto a different
 *  name. It is the LAST step of `creatureFormLabel`'s lookup (after `FORM_LABEL_TABLE` and the repeated-species
 *  rule), and the whole answer for the great majority of codes, whose re-cased spelling already is the official
 *  name (`ORIGIN`, `GALARIAN`, `HISUIAN`, `MEGA_X`, `DAWN_WINGS`, `ICE_RIDER`, `RAPID_STRIKE`, ...). */
export function formCodeLabel(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/** One row of `FORM_LABEL_TABLE`: `[pokemonId | '*', formCode, label]`. */
type FormLabelEntry = readonly [pokemonId: number | '*', formCode: string, label: string];

/**
 * Display names for the form codes whose re-cased spelling (`formCodeLabel`) reads wrongly. Every other code
 * is left to that fallback, so this stays small on purpose: an entry is added only when re-casing the code
 * misnames the form, never to dress up a code that already reads correctly. Every label below is the form's
 * official Pokémon name (AGENTS.md: never hallucinate game data); a name that could not be verified is left
 * out and falls back to the re-cased code instead of being guessed.
 *
 * WHY THE TABLE IS KEYED BY SPECIES AS WELL AS CODE. A code is a sprite token, and the same token can mean
 * different things on different species: `A` is Armored Mewtwo's code (the only single-letter form code in the
 * game's art) and means nothing on any other species, `ZEN` is Darmanitan's Zen Mode, `FAIRY` is an Arceus
 * type form but also a Silvally one. So a row names the species it is for (`pokemonId`), and `'*'` is reserved for
 * the codes that mean the same on every species that has them. The two regional adjectives below are those:
 * `ALOLA` is Alolan on Rattata, Sandshrew and Meowth alike. (`GALARIAN` and `HISUIAN` already re-case to the
 * right adjective, so they have no row.) A lookup tries the species row first, so a `'*'` row never overrides
 * a species-specific one.
 *
 * Rows are checked against the dex data by `lib/format.test.ts`: a code that no species in
 * `FORM_TYPE_OVERRIDES` / `BASE_FORM_CODES` carries (a typo, a form that was renamed upstream) fails there.
 */
export const FORM_LABEL_TABLE: readonly FormLabelEntry[] = [
  // Regional adjectives: re-casing gives the region ("Alola", "Paldea"), the form is the demonym.
  ['*', 'ALOLA', 'Alolan'],
  ['*', 'PALDEA', 'Paldean'],

  // Tauros #128: the three Paldean breeds (official: Paldean Tauros, Combat / Blaze / Aqua Breed).
  [128, 'PALDEA_COMBAT', 'Paldean Combat Breed'],
  [128, 'PALDEA_BLAZE', 'Paldean Blaze Breed'],
  [128, 'PALDEA_AQUA', 'Paldean Aqua Breed'],

  // Mewtwo #150: `A` is PokeMiners' code for Armored Mewtwo (Pokémon GO's Armored costume). Re-cased it reads "A".
  [150, 'A', 'Armored'],

  // Burmy #412 / Wormadam #413: their codes lead with the species ("WORMADAM_SANDY"), which the screen already
  // shows in the name above the form line. The official form names are the three cloaks (Plant / Sandy / Trash).
  [412, 'BURMY_PLANT', 'Plant Cloak'],
  [413, 'WORMADAM_PLANT', 'Plant Cloak'],
  [413, 'WORMADAM_SANDY', 'Sandy Cloak'],
  [413, 'WORMADAM_TRASH', 'Trash Cloak'],

  // Darmanitan #555: Standard Mode / Zen Mode, and the Galarian ones. The bare words are not the form names.
  [555, 'STANDARD', 'Standard Mode'],
  [555, 'ZEN', 'Zen Mode'],
  [555, 'GALARIAN_STANDARD', 'Galarian Standard Mode'],
  [555, 'GALARIAN_ZEN', 'Galarian Zen Mode'],

  // Oricorio #741: the four Styles. Re-casing misspells two of them (official: "Pa'u" and "Pom-Pom"), and the
  // set reads as one family only if all four say "Style".
  [741, 'BAILE', 'Baile Style'],
  [741, 'PAU', "Pa'u Style"],
  [741, 'POMPOM', 'Pom-Pom Style'],
  [741, 'SENSU', 'Sensu Style'],

  // Maushold #925: re-casing capitalises the "of" ("Family Of Four").
  [925, 'FAMILY_OF_FOUR', 'Family of Four'],
];

const FORM_LABELS: ReadonlyMap<string, string> = new Map(FORM_LABEL_TABLE.map(([id, code, label]) => [`${id}:${code}`, label]));

/** A code that opens with the species' own name ("UNOWN_A", "WORMADAM_SANDY") with that name taken off
 *  ("A", "SANDY"), or `undefined` when it does not (or nothing would be left). The name is the dex's name
 *  upper-cased, so a species whose name is not a bare token (e.g. "Mr. Mime") never matches and keeps the
 *  full re-cased code. */
function withoutSpeciesPrefix(pokemonId: number, code: string): string | undefined {
  const species = findPokemon(pokemonId)?.name.toUpperCase();
  if (!species || !code.startsWith(`${species}_`)) return undefined;
  return code.slice(species.length + 1).replace(/^_+/, '') || undefined;
}

/**
 * A creature's form as a line of text, or `undefined` for the species' default form (no `formCode`). The
 * structured home of what a stored name used to say in prose ("Origin Palkia", "Primal Groudon", "Mega
 * Rayquaza"): `creatureDisplayName` shows the dex species only, so a screen that has room for a second line
 * shows the form here instead, and the two can never disagree about which form it is.
 *
 * `pokemonId` is required because a form code does not name a form by itself, only together with the species
 * it is on (`A` is Armored on #150 and nothing anywhere else; see `FORM_LABEL_TABLE`). The lookup is, in order:
 *   1. `FORM_LABEL_TABLE`, the species' own row and then a `'*'` row: the official name where re-casing the
 *      code would misname the form ("Alolan", "Armored", "Pa'u Style").
 *   2. A code that starts with the species' name ("UNOWN_A"), minus that name, re-cased: the screen already
 *      says the species, so repeating it ("Unown A") only adds noise. A rule rather than a table because Unown
 *      alone has 28 forms and only `UNOWN_A` is in the data today; `UNOWN_A` -> "A".
 *   3. `formCodeLabel`: the code re-cased ("CROWNED_SWORD" -> "Crowned Sword"). A code nothing above knows
 *      therefore reads as itself, never blank and never a guessed name.
 */
export function creatureFormLabel(c: { pokemonId: number; formCode?: string | null }): string | undefined {
  const code = c.formCode;
  if (!code) return undefined;
  const named = FORM_LABELS.get(`${c.pokemonId}:${code}`) ?? FORM_LABELS.get(`*:${code}`);
  if (named !== undefined) return named;
  const unprefixed = withoutSpeciesPrefix(c.pokemonId, code);
  return formCodeLabel(unprefixed ?? code);
}

/** A creature's typing as a screen reader should hear it, e.g. `['Fire', 'Flying']` -> `'Fire and Flying type'`
 *  and `['Fairy']` -> `'Fairy type'`. The one wording every type label shares (`TypeBadge`, the Pokémon
 *  picker's rows, a formal offer's card), so they cannot disagree on it. Primary type first, as `PokemonTypes` orders it. */
export function describeTypes(types: PokemonTypes): string {
  return `${types.join(' and ')} type`;
}
