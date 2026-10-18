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

/** The one place the `"Shiny "` marker is written. `creatureDisplayName` and `creatureFullName` both end here, so
 *  no spelling of "shiny" (or its position: always FIRST, ahead of any form) can differ between the short and the
 *  full name of one creature. */
function withShinyPrefix(name: string, shiny: boolean | null | undefined): string {
  return shiny ? `Shiny ${name}` : name;
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
 *  a form is shown through its structured field (`formCode` via `creatureFormLabel`, on a listing as anywhere
 *  else), and a listing's Purified / Costume / tags are badges of their own.
 *
 *  This is the SHORT name: the species, for a screen that shows the form on a line of its own (a listing card's
 *  "Armored · 2019"). A screen that names the creature in a single string, with no such line (a chat's "RE:"
 *  header, the Make Offer sheet's sentence), wants `creatureFullName`, which adds the form to this. */
export function creatureDisplayName(c: NamedCreature & { shiny?: boolean | null }): string {
  return withShinyPrefix(speciesName(c), c.shiny);
}

/** A trade-history date as `TradeHistoryGrid` renders it, e.g. `'Aug 22, 2026'` — the one place that
 *  format is decided, so a live `completed_at` timestamp (`fetchMyTradeHistory`) and
 *  `data/publicProfile.ts`'s synthetic "N months ago" date can never drift apart in shape. */
export function formatTradeDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}


/** A PokeMiners form code re-cased as display text, e.g. `'CROWNED_SWORD'` -> `'Crowned Sword'`. The codes are
 *  sprite keys (`lib/sprite-url.ts`), not names, so this only re-cases them — it never maps one onto a different
 *  name. It is the LAST step of `creatureForm`'s lookup (after `FORM_LABEL_TABLE` and the repeated-species
 *  rule), and the whole answer for the great majority of codes, whose re-cased spelling already is the official
 *  name (`ORIGIN`, `GALARIAN`, `HISUIAN`, `MEGA_X`, `DAWN_WINGS`, `ICE_RIDER`, `RAPID_STRIKE`, ...). */
export function formCodeLabel(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Where a form's label goes in a creature's full name (`creatureFullName`):
 *   - `'prefix'`: before the species. For a label that is an adjective on the species, said the way trainers
 *     say it: "Alolan Vulpix", "Armored Mewtwo", "Origin Palkia", "Heat Rotom", "Crowned Sword Zacian".
 *   - `'suffix'`: after the species, in parentheses. For a label that names a KIND of form (a cloak, a style, a
 *     breed, a mode, a family) or is only a symbol (a letter, a number), which does not read as a modifier:
 *     "Wormadam (Sandy Cloak)", "Oricorio (Baile Style)", "Unown (F)", "Spinda (01)" — not "Sandy Cloak Wormadam",
 *     "Baile Style Oricorio", "F Unown", "01 Spinda".
 * It is a property of the LABEL (which word order reads correctly), so it is decided here, beside the label, and
 * the component showing the name never chooses it.
 */
export type FormPlacement = 'prefix' | 'suffix';

/** One row of `FORM_LABEL_TABLE`: `[pokemonId | '*', formCode, label, placement]`. */
type FormLabelEntry = readonly [pokemonId: number | '*', formCode: string, label: string, placement: FormPlacement];

/** A creature's form as `creatureForm` resolves it: what it is called, and where that goes in a full name. */
export interface CreatureForm {
  label: string;
  placement: FormPlacement;
}

/**
 * Display names, and their placement (`FormPlacement`), for the form codes that need either decided by hand: a
 * code whose re-cased spelling (`formCodeLabel`) reads wrongly, or whose label reads wrongly BEFORE the species
 * (see the defaults on `creatureForm`). Every other code is left to those defaults, so this stays small on
 * purpose: an entry is added only when re-casing misnames the form or the default placement misorders it, never
 * to dress up a code that already reads correctly. A row that exists only for its placement repeats the re-cased
 * label as it is. Every label below is the form's official Pokémon name (AGENTS.md: never hallucinate game
 * data); a name that could not be verified is left out and falls back to the re-cased code instead of being
 * guessed. `placement` is required on every row, so a new row cannot forget to decide it.
 *
 * WHY THE TABLE IS KEYED BY SPECIES AS WELL AS CODE. A code is a sprite token, and the same token can mean
 * different things on different species: `A` is Armored Mewtwo's code (the only single-letter form code in the
 * game's art) and means nothing on any other species, `ZEN` is Darmanitan's Zen Mode, `FAIRY` is an Arceus
 * type form but also a Silvally one. So a row names the species it is for (`pokemonId`), and `'*'` is reserved for
 * the codes that mean the same on every species that has them. `ALOLA` is Alolan on Rattata, Sandshrew and
 * Meowth alike; `MEGA_X` is Mega X on every species that has one. (`GALARIAN` and `HISUIAN` already re-case to
 * the right adjective and sit before the species by default, so they have no row.) A lookup tries the species
 * row first, so a `'*'` row never overrides a species-specific one.
 *
 * Rows are checked against the dex data by `lib/format.test.ts`: a code that no species in
 * `FORM_TYPE_OVERRIDES` / `POKEDEX_FORMS` / `BASE_FORM_CODES` carries (a typo, a form that was renamed upstream)
 * fails there.
 */
export const FORM_LABEL_TABLE: readonly FormLabelEntry[] = [
  // Regional adjectives: re-casing gives the region ("Alola", "Paldea"), the form is the demonym. "Alolan Vulpix".
  ['*', 'ALOLA', 'Alolan', 'prefix'],
  ['*', 'PALDEA', 'Paldean', 'prefix'],

  // Mega X / Mega Y (Charizard, Mewtwo): the official names put the species in the middle ("Mega Charizard X"), which
  // a placement cannot say, and a prefix would misorder ("Mega X Charizard"). After the species it is at least
  // correct and unambiguous: "Charizard (Mega X)". `MEGA_Y` has no override row (Y keeps its species' typing) but
  // is the same code family. The plain `MEGA` and `PRIMAL` re-case and read correctly as prefixes ("Mega Gyarados").
  ['*', 'MEGA_X', 'Mega X', 'suffix'],
  ['*', 'MEGA_Y', 'Mega Y', 'suffix'],

  // Tauros #128: the three Paldean breeds (official: Paldean Tauros, Combat / Blaze / Aqua Breed).
  [128, 'PALDEA_COMBAT', 'Paldean Combat Breed', 'suffix'],
  [128, 'PALDEA_BLAZE', 'Paldean Blaze Breed', 'suffix'],
  [128, 'PALDEA_AQUA', 'Paldean Aqua Breed', 'suffix'],

  // Mewtwo #150: `A` is PokeMiners' code for Armored Mewtwo (Pokémon GO's Armored costume). Re-cased it reads "A".
  [150, 'A', 'Armored', 'prefix'],

  // Burmy #412 / Wormadam #413: their codes lead with the species ("WORMADAM_SANDY"), which the screen already
  // shows in the name above the form line. The official form names are the three cloaks (Plant / Sandy / Trash).
  [412, 'BURMY_PLANT', 'Plant Cloak', 'suffix'],
  [412, 'BURMY_SANDY', 'Sandy Cloak', 'suffix'],
  [412, 'BURMY_TRASH', 'Trash Cloak', 'suffix'],
  [413, 'WORMADAM_PLANT', 'Plant Cloak', 'suffix'],
  [413, 'WORMADAM_SANDY', 'Sandy Cloak', 'suffix'],
  [413, 'WORMADAM_TRASH', 'Trash Cloak', 'suffix'],

  // Darmanitan #555: Standard Mode / Zen Mode, and the Galarian ones. The bare words are not the form names.
  [555, 'STANDARD', 'Standard Mode', 'suffix'],
  [555, 'ZEN', 'Zen Mode', 'suffix'],
  [555, 'GALARIAN_STANDARD', 'Galarian Standard Mode', 'suffix'],
  [555, 'GALARIAN_ZEN', 'Galarian Zen Mode', 'suffix'],

  // Zygarde #718: the Forme names are percentages and "Complete" ("Complete Fifty Percent Zygarde" is not a
  // phrase), so the whole family goes after the species rather than splitting it over both sides.
  [718, 'TEN_PERCENT', 'Ten Percent', 'suffix'],
  [718, 'FIFTY_PERCENT', 'Fifty Percent', 'suffix'],
  [718, 'COMPLETE', 'Complete', 'suffix'],
  [718, 'COMPLETE_TEN_PERCENT', 'Complete Ten Percent', 'suffix'],
  [718, 'COMPLETE_FIFTY_PERCENT', 'Complete Fifty Percent', 'suffix'],

  // Oricorio #741: the four Styles. Re-casing misspells two of them (official: "Pa'u" and "Pom-Pom"), and the
  // set reads as one family only if all four say "Style".
  [741, 'BAILE', 'Baile Style', 'suffix'],
  [741, 'PAU', "Pa'u Style", 'suffix'],
  [741, 'POMPOM', 'Pom-Pom Style', 'suffix'],
  [741, 'SENSU', 'Sensu Style', 'suffix'],

  // Maushold #925: re-casing capitalises the "of" ("Family Of Four"). Family of Three / Four are the two Formes.
  [925, 'FAMILY_OF_THREE', 'Family of Three', 'suffix'],
  [925, 'FAMILY_OF_FOUR', 'Family of Four', 'suffix'],

  // Dudunsparce #982: the Three-Segment Form's code is the bare number word, which only reads after the species.
  [982, 'THREE', 'Three', 'suffix'],
];

const FORMS: ReadonlyMap<string, CreatureForm> = new Map(
  FORM_LABEL_TABLE.map(([id, code, label, placement]) => [`${id}:${code}`, { label, placement }]),
);

/** A code that opens with the species' own name ("UNOWN_A", "WORMADAM_SANDY") with that name taken off
 *  ("A", "SANDY"), or `undefined` when it does not (or nothing would be left). The name is the dex's name
 *  upper-cased, so a species whose name is not a bare token (e.g. "Mr. Mime") never matches and keeps the
 *  full re-cased code. */
function withoutSpeciesPrefix(pokemonId: number, code: string): string | undefined {
  const species = findPokemon(pokemonId)?.name.toUpperCase();
  if (!species || !code.startsWith(`${species}_`)) return undefined;
  return code.slice(species.length + 1).replace(/^_+/, '') || undefined;
}

/** A label that is a symbol, not a word: it opens with a digit ("01", "Spring 2026" does not) or is a lone letter
 *  ("A", "F"). Such a label cannot qualify a species ("01 Spinda", "A Mew"), so `creatureForm` puts it after it. */
const SYMBOL_LABEL = /^(?:\d|\p{L}(?:\s|$))/u;

/**
 * A creature's form: its display label and where that label sits in a full name, or `undefined` for the species'
 * default form (no `formCode`). The structured home of what a stored name used to say in prose ("Origin
 * Palkia", "Primal Groudon", "Mega Rayquaza"): `creatureDisplayName` shows the dex species only, so a screen
 * that has room for a second line shows the form here instead (`creatureFormLabel`), and a screen that names the
 * creature in one string composes the two with `creatureFullName`. They cannot disagree about which form it is,
 * because both read this.
 *
 * `pokemonId` is required because a form code does not name a form by itself, only together with the species
 * it is on (`A` is Armored on #150 and nothing anywhere else; see `FORM_LABEL_TABLE`). The lookup is, in order:
 *   1. `FORM_LABEL_TABLE`, the species' own row and then a `'*'` row: the official name where re-casing the
 *      code would misname the form ("Alolan", "Armored", "Pa'u Style"), with the placement the row states.
 *   2. A code that starts with the species' name ("UNOWN_A"), minus that name, re-cased: the screen already
 *      says the species, so repeating it ("Unown A") only adds noise. A rule rather than a table because Unown
 *      alone has 28 forms and only `UNOWN_A` is in the data today; `UNOWN_A` -> "A". What is left is a bare
 *      token (a letter, a cloak, a punctuation mark), so the placement is `'suffix'`: "Unown (A)", "Burmy (Sandy)".
 *   3. `formCodeLabel`: the code re-cased ("CROWNED_SWORD" -> "Crowned Sword"). A code nothing above knows
 *      therefore reads as itself, never blank and never a guessed name. Placement is `'prefix'` ("Crowned Sword
 *      Zacian", "Heat Rotom", "Ultra Necrozma": most re-cased codes are an adjective on the species), unless the
 *      label is a symbol (`SYMBOL_LABEL`: Spinda's "01" to "19"), which goes `'suffix'` ("Spinda (01)").
 */
export function creatureForm(c: { pokemonId: number; formCode?: string | null }): CreatureForm | undefined {
  const code = c.formCode;
  if (!code) return undefined;
  const named = FORMS.get(`${c.pokemonId}:${code}`) ?? FORMS.get(`*:${code}`);
  if (named !== undefined) return named;
  const unprefixed = withoutSpeciesPrefix(c.pokemonId, code);
  if (unprefixed !== undefined) return { label: formCodeLabel(unprefixed), placement: 'suffix' };
  const label = formCodeLabel(code);
  return { label, placement: SYMBOL_LABEL.test(label) ? 'suffix' : 'prefix' };
}

/**
 * A creature's form as a line of text, or `undefined` for the species' default form (no `formCode`): the label
 * half of `creatureForm`, for a screen that has room for a second line under the name ("Armored · 2019 catch").
 * Where the label would go inside a full name is `creatureForm`'s `placement`; do not re-derive it from the label.
 */
export function creatureFormLabel(c: { pokemonId: number; formCode?: string | null }): string | undefined {
  return creatureForm(c)?.label;
}

/**
 * What a creature is called in one string, form included: "Shiny Armored Mewtwo", "Alolan Vulpix", "Shiny
 * Unown (F)", "Wormadam (Sandy Cloak)". The name for any screen that has no second line to put the form on
 * (a chat's "RE:" header, the Make Offer sheet's sentence, a screen reader's label), so the form is heard and
 * read there too. It is the ONE place a species and a form are put together: do not concatenate
 * `creatureFormLabel` and `speciesName` at a call site, which is how "Sandy Cloak Wormadam" gets written.
 *
 * Built from the same parts as `creatureDisplayName`, so the two cannot disagree: the species is `speciesName`
 * (the dex's name, never the stored `name`), the form is `creatureForm` (the label and where it goes, see
 * `FormPlacement`), and `"Shiny "` is `withShinyPrefix`'s and always comes FIRST, ahead of any form
 * ("Shiny Armored Mewtwo", "Shiny Unown (F)"). The default form has no label, so it is exactly
 * `creatureDisplayName(c)`; an empty label (a code of nothing but underscores) is treated the same way, never
 * rendered as a doubled space or empty parentheses. An unknown species or code still gives a name: the stored
 * name or "Pokémon #N", and the re-cased code.
 *
 * A name with a form is longer than the species alone ("Shiny Darmanitan (Galarian Zen Mode)"), so the Text
 * that shows it needs its own truncation (`numberOfLines`) wherever it sits in a fixed-width row.
 */
export function creatureFullName(c: NamedCreature & { shiny?: boolean | null; formCode?: string | null }): string {
  const species = speciesName(c);
  const form = creatureForm(c);
  if (!form?.label) return withShinyPrefix(species, c.shiny);
  const named = form.placement === 'prefix' ? `${form.label} ${species}` : `${species} (${form.label})`;
  return withShinyPrefix(named, c.shiny);
}

/** A creature's typing as a screen reader should hear it, e.g. `['Fire', 'Flying']` -> `'Fire and Flying type'`
 *  and `['Fairy']` -> `'Fairy type'`. The one wording every type label shares (`TypeBadge`, the Pokémon
 *  picker's rows, a formal offer's card), so they cannot disagree on it. Primary type first, as `PokemonTypes` orders it. */
export function describeTypes(types: PokemonTypes): string {
  return `${types.join(' and ')} type`;
}
