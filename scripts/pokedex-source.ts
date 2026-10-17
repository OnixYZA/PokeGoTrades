/**
 * Pure half of `scripts/generate-pokedex.ts`: turns the raw downloads (PokeAPI's CSV export, the PokeMiners
 * game master, the PokeMiners sprite listing) into the contents of `constants/pokedex-data.ts`. No network,
 * no filesystem, so vitest drives it with small fixtures (`scripts/pokedex-source.test.ts`).
 *
 * RELATIVE IMPORTS ONLY, and the only app modules it may import are LEAVES with no imports of their own
 * (`constants/pokemon-types.ts`; `constants/base-form-codes.ts` and `constants/untradable.ts` are leaves too and
 * reach this module as INPUTS from the CLI, so tests can substitute fixtures): the generator replaces
 * `constants/pokedex-data.ts`, so it must keep running even when that file is stale, mid-merge or the wrong
 * shape. Do not import `constants/pokedex.ts`, `lib/sprite-url.ts` or `scripts/pokeminers.ts` here (each
 * pulls the dex data in).
 *
 * WHY TWO SOURCES (decision recorded at the time of writing, 2026-10-17):
 *   - The PokeMiners game master is Pokémon GO's own data, with per-FORM types and form ids that line up
 *     with the form codes this app stores. But it has no `pokemonSettings` for #902 Basculegion (only the
 *     size/spawn/forms stubs), so it cannot be the single source for all 1025 species.
 *   - PokeAPI's CSVs are the file's original, documented source: they cover all 1025 species with both
 *     type slots, and also give the English names.
 *   So PokeAPI supplies every species' DEFAULT typing and name, and the game master supplies per-form
 *   OVERRIDES: a form is recorded only when the game master says its types differ from that default.
 *   `buildPokedexData` cross-checks the two sources on every species they share and reports any
 *   disagreement instead of picking a side; the CLI refuses to write the file while one exists.
 *
 * THE FORM CATALOG (added 2026-10-17) answers a different question from the overrides: not "which forms
 * type differently" but "which forms can a trainer list a creature as". The overrides table cannot answer
 * it (Origin Palkia and Armored Mewtwo have their species' typing, so they are not in it), and the Create
 * Listing form picker needs the complete list. It comes from the game master's own `FORMS_V####_POKEMON_*`
 * lists, in the order the game master gives them, with the exclusions documented on `buildFormCatalog`.
 *
 * THE TRADABILITY CROSS-CHECK (added 2026-10-18) writes nothing into the data file. It compares the game
 * master's per-template `isTradable` flag (absent means untradable) with the app's own untradable rules
 * (`constants/untradable.ts`, mirrored by `public.is_creature_untradable`) and refuses to write while any
 * species or form disagrees, except the entries listed, with a reason, in `TRADABILITY_OVERRIDES`. The rules are
 * hand-maintained in two languages, so this is what turns a game master update that changes a creature's
 * tradability into a failed run instead of silent drift. See `checkTradability`.
 */
import { POKEMON_TYPES, isPokemonType, sameTypes, toPokemonTypes, type PokemonType, type PokemonTypes } from '../constants/pokemon-types';

// ================================================================================================
// CSV
// ================================================================================================

/** RFC 4180 parser: quoted fields, `""` escapes, embedded commas/newlines, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Header-keyed rows. A row whose width differs from the header is a corrupt download, not data. */
export function csvRecords(text: string, what: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error(`${what}: empty CSV`);
  return rows.map((row, i) => {
    if (row.length !== header.length) {
      throw new Error(`${what}: row ${i + 2} has ${row.length} fields, the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, col) => [name, row[col]]));
  });
}

// ================================================================================================
// PokeAPI: species names + default types
// ================================================================================================

export interface PokeApiCsv {
  /** pokemon_species.csv */
  species: string;
  /** pokemon_species_names.csv */
  speciesNames: string;
  /** pokemon.csv */
  pokemon: string;
  /** pokemon_types.csv */
  pokemonTypes: string;
  /** types.csv */
  types: string;
}

export interface SpeciesRow {
  id: number;
  name: string;
  /** The species' default-form typing, in PokeAPI's slot order. */
  types: PokemonTypes;
}

/** PokeAPI's `language_id` for English in `pokemon_species_names.csv`. */
const ENGLISH = '9';

const titleCase = (identifier: string): string => identifier.charAt(0).toUpperCase() + identifier.slice(1);

/**
 * One row per species, ids 1..N in order: the English name, and the types of the `pokemon` row whose id
 * equals the species id (PokeAPI's default form of that species), slot 1 first. Throws on any gap, so a
 * truncated download can never silently shrink the dex.
 */
export function parsePokeApiSpecies(csv: PokeApiCsv): SpeciesRow[] {
  const typeById = new Map<string, PokemonType>();
  for (const row of csvRecords(csv.types, 'types.csv')) {
    const name = titleCase(row.identifier);
    // Ids past the 18 standard types (stellar, unknown, shadow) are not part of this app's vocabulary.
    if (isPokemonType(name)) typeById.set(row.id, name);
  }
  for (const type of POKEMON_TYPES) {
    if (![...typeById.values()].includes(type)) throw new Error(`types.csv has no "${type}" row; the vocabulary drifted`);
  }

  const englishName = new Map<number, string>();
  for (const row of csvRecords(csv.speciesNames, 'pokemon_species_names.csv')) {
    if (row.local_language_id === ENGLISH) englishName.set(Number(row.pokemon_species_id), row.name);
  }

  const defaultPokemonIds = new Set<string>();
  for (const row of csvRecords(csv.pokemon, 'pokemon.csv')) {
    if (row.id === row.species_id) defaultPokemonIds.add(row.id);
  }

  const slotsByPokemon = new Map<string, { slot: number; typeId: string }[]>();
  for (const row of csvRecords(csv.pokemonTypes, 'pokemon_types.csv')) {
    const slots = slotsByPokemon.get(row.pokemon_id) ?? [];
    slots.push({ slot: Number(row.slot), typeId: row.type_id });
    slotsByPokemon.set(row.pokemon_id, slots);
  }

  const ids = csvRecords(csv.species, 'pokemon_species.csv')
    .map((row) => Number(row.id))
    .sort((a, b) => a - b);
  return ids.map((id, index) => {
    if (id !== index + 1) throw new Error(`pokemon_species.csv is not contiguous: expected ${index + 1}, found ${id}`);
    const name = englishName.get(id);
    if (!name) throw new Error(`Species #${id} has no English name`);
    if (!defaultPokemonIds.has(String(id))) throw new Error(`Species #${id} has no pokemon row with the same id`);
    const slots = (slotsByPokemon.get(String(id)) ?? []).sort((a, b) => a.slot - b.slot);
    if (!slots.every((s, i) => s.slot === i + 1)) throw new Error(`Species #${id} has non-contiguous type slots`);
    const names = slots.map((s) => {
      const type = typeById.get(s.typeId);
      if (!type) throw new Error(`Species #${id} uses type id ${s.typeId}, which is not one of the 18 standard types`);
      return type;
    });
    return { id, name, types: toPokemonTypes(names) };
  });
}

// ================================================================================================
// PokeMiners game master: per-form types
// ================================================================================================

/** The parts of a game master template this module reads. The real entries carry hundreds of other fields. */
export interface GameMasterTemplate {
  templateId: string;
  data?: {
    pokemonSettings?: {
      /** The species enum, e.g. `ZACIAN`. */
      pokemonId?: string;
      /** The form enum, e.g. `ZACIAN_CROWNED_SWORD`. Absent on the species' formless template. */
      form?: string;
      type?: string;
      type2?: string;
      /** Whether the creature can be traded. Present (`true`) on tradable creatures and ABSENT, never `false`,
       *  on untradable ones: in the pinned file 2387 of the 2472 species/form templates carry it, none with any
       *  other value. It is per TEMPLATE, so per form: `ZACIAN_HERO` has it and `ZACIAN_CROWNED_SWORD` does not. */
      isTradable?: boolean;
      /** Mega/Primal evolutions: only the entries with a `typeOverride1` change typing. */
      tempEvoOverrides?: { tempEvoId?: string; typeOverride1?: string; typeOverride2?: string }[];
    };
    formSettings?: {
      /** The species enum again, e.g. `ZACIAN`. Present even on species with no `pokemonSettings` (Basculegion). */
      pokemon?: string;
      /** In the game master's order. The first entry is the species' default form. */
      forms?: {
        form?: string;
        /** Pokémon GO's own flag for an event-costume form (`PIKACHU_FALL_2019`, `CORSOLA_SPRING_2026`).
         *  Absent, never `false`, on every other form. Its art still lives under a `.f` token. */
        isCostume?: boolean;
      }[];
    };
  };
}

export interface GmSpecies {
  pokemonId: number;
  /** The species enum used in form names, e.g. `ZACIAN`. */
  enumName: string;
  /** Types on the formless `V####_POKEMON_<NAME>` template. NOT always the default form's typing: Zacian's
   *  formless template carries the Crowned Sword typing. */
  bare: PokemonTypes;
  /** Full form enum -> types, from the `V####_POKEMON_<NAME>_<FORM>` templates. */
  forms: Map<string, PokemonTypes>;
  /** First form in the species' `FORMS_V####_POKEMON_<NAME>` list, which is the default form, or null. */
  defaultForm: string | null;
  /** `MEGA`, `MEGA_X`, `MEGA_Y`, `PRIMAL`, ... (without the `TEMP_EVOLUTION_` prefix) -> types. */
  tempEvos: Map<string, PokemonTypes>;
  /** Whether the formless template is flagged `isTradable`. */
  bareTradable: boolean;
  /** Full form enum -> whether that form's template is flagged `isTradable` (same keys as `forms`). */
  formTradable: Map<string, boolean>;
}

const POKEMON_TEMPLATE = /^V(\d{4})_POKEMON_/;
const FORMS_TEMPLATE = /^FORMS_V(\d{4})_POKEMON_/;
const TEMP_EVO_PREFIX = 'TEMP_EVOLUTION_';
const TYPE_PREFIX = 'POKEMON_TYPE_';

/** `POKEMON_TYPE_FIRE` -> `'Fire'`. Throws on a type this app doesn't know. */
function gmTypeName(value: string, where: string): PokemonType {
  if (!value.startsWith(TYPE_PREFIX)) throw new Error(`${where}: "${value}" is not a POKEMON_TYPE_ enum`);
  const name = titleCase(value.slice(TYPE_PREFIX.length).toLowerCase());
  if (!isPokemonType(name)) throw new Error(`${where}: unknown type ${value}`);
  return name;
}

function gmTypes(type: string | undefined, type2: string | undefined, where: string): PokemonTypes {
  if (!type) throw new Error(`${where}: no primary type`);
  return toPokemonTypes([gmTypeName(type, where), ...(type2 ? [gmTypeName(type2, where)] : [])]);
}

/**
 * Species id -> its game master typing data, for every species that has at least one `pokemonSettings`
 * template (so not #902 Basculegion, which only has stubs). Throws on contradictory duplicates rather than
 * letting the last one win.
 */
export function parseGameMaster(templates: readonly GameMasterTemplate[]): Map<number, GmSpecies> {
  const defaultForms = new Map<number, string | null>();
  const building = new Map<number, Omit<GmSpecies, 'bare' | 'bareTradable' | 'defaultForm'> & { bare: PokemonTypes | undefined; bareTradable: boolean }>();

  for (const template of templates) {
    const formsMatch = FORMS_TEMPLATE.exec(template.templateId);
    if (formsMatch) {
      defaultForms.set(Number(formsMatch[1]), template.data?.formSettings?.forms?.[0]?.form ?? null);
      continue;
    }
    const settings = template.data?.pokemonSettings;
    const match = POKEMON_TEMPLATE.exec(template.templateId);
    if (!settings || !match) continue;

    const where = template.templateId;
    const pokemonId = Number(match[1]);
    if (!settings.pokemonId) throw new Error(`${where}: no pokemonId enum`);
    const types = gmTypes(settings.type, settings.type2, where);

    let entry = building.get(pokemonId);
    if (!entry) {
      entry = { pokemonId, enumName: settings.pokemonId, bare: undefined, bareTradable: false, forms: new Map(), formTradable: new Map(), tempEvos: new Map() };
      building.set(pokemonId, entry);
    } else if (entry.enumName !== settings.pokemonId) {
      throw new Error(`${where}: species enum ${settings.pokemonId} contradicts ${entry.enumName} on #${pokemonId}`);
    }

    if (settings.form) {
      if (entry.forms.has(settings.form)) throw new Error(`${where}: form ${settings.form} is defined twice`);
      entry.forms.set(settings.form, types);
      entry.formTradable.set(settings.form, settings.isTradable === true);
    } else {
      if (entry.bare) throw new Error(`${where}: a second formless template for #${pokemonId}`);
      entry.bare = types;
      entry.bareTradable = settings.isTradable === true;
    }

    for (const override of settings.tempEvoOverrides ?? []) {
      // Overrides without a tempEvoId or a typeOverride1 only adjust camera/size/stats: typing is unchanged.
      if (!override.tempEvoId || !override.typeOverride1) continue;
      if (!override.tempEvoId.startsWith(TEMP_EVO_PREFIX)) throw new Error(`${where}: unexpected tempEvoId ${override.tempEvoId}`);
      const code = override.tempEvoId.slice(TEMP_EVO_PREFIX.length);
      const evoTypes = gmTypes(override.typeOverride1, override.typeOverride2, `${where} ${override.tempEvoId}`);
      const seen = entry.tempEvos.get(code);
      // The formless and `_NORMAL` templates both repeat the same overrides; they must agree.
      if (seen && !sameTypes(seen, evoTypes)) throw new Error(`${where}: ${override.tempEvoId} has two different typings`);
      entry.tempEvos.set(code, evoTypes);
    }
  }

  const species = new Map<number, GmSpecies>();
  for (const [pokemonId, entry] of building) {
    if (!entry.bare) throw new Error(`#${pokemonId} has form templates but no formless template`);
    species.set(pokemonId, { ...entry, bare: entry.bare, defaultForm: defaultForms.get(pokemonId) ?? null });
  }
  return species;
}

/** What the game master says the species' default form is typed as: its first-listed form's template, or
 *  the formless template when there is no form list or that form has no template of its own. */
export function gameMasterDefaultTypes(entry: GmSpecies): { types: PokemonTypes; via: 'form' | 'formless' } {
  const formTypes = entry.defaultForm ? entry.forms.get(entry.defaultForm) : undefined;
  return formTypes ? { types: formTypes, via: 'form' } : { types: entry.bare, via: 'formless' };
}

/** One entry of a species' `FORMS_V####_POKEMON_*` list. */
export interface GmFormEntry {
  /** The full form enum, e.g. `ZACIAN_CROWNED_SWORD`. */
  form: string;
  /** The game master's `isCostume` flag; see `GameMasterTemplate`. */
  isCostume: boolean;
}

export interface GmFormList {
  /** The species enum used in form names, e.g. `ZACIAN`. */
  enumName: string;
  /** In the game master's order; `forms[0]` is the species' default form. */
  forms: GmFormEntry[];
}

/**
 * Species id -> its complete `FORMS_` list, for every species that has one (1024 of 1025 at the time of
 * writing, including #902 Basculegion, whose `pokemonSettings` the game master lacks: this reads the list
 * itself, not `parseGameMaster`'s per-form typing). A species whose list has no `forms` array gets an empty
 * list. Throws on a repeated list or a form listed twice, rather than letting the last one win.
 */
export function parseGameMasterForms(templates: readonly GameMasterTemplate[]): Map<number, GmFormList> {
  const lists = new Map<number, GmFormList>();
  for (const template of templates) {
    const match = FORMS_TEMPLATE.exec(template.templateId);
    if (!match) continue;
    const where = template.templateId;
    const pokemonId = Number(match[1]);
    if (lists.has(pokemonId)) throw new Error(`${where}: a second form list for #${pokemonId}`);
    const settings = template.data?.formSettings;
    if (!settings?.pokemon) throw new Error(`${where}: no species enum`);
    const seen = new Set<string>();
    const forms = (settings.forms ?? []).map((entry) => {
      if (!entry.form) throw new Error(`${where}: a form entry with no name`);
      if (seen.has(entry.form)) throw new Error(`${where}: form ${entry.form} is listed twice`);
      seen.add(entry.form);
      return { form: entry.form, isCostume: entry.isCostume === true };
    });
    lists.set(pokemonId, { enumName: settings.pokemon, forms });
  }
  return lists;
}

// ================================================================================================
// PokeMiners sprite listing: the app's own spelling of form codes
// ================================================================================================

/**
 * `pm{dex}[.f{FORM}][.c{COSTUME}][.g2][.s].icon.png`: the same grammar `scripts/pokeminers.ts` parses
 * (`ICON_NAME`), repeated here only because that module imports the dex. `pokedex-source.test.ts` asserts
 * the two agree on real filenames.
 */
const ICON_NAME = /^pm(\d+)(?:\.f([^.]+))?(?:\.c([^.]+))?(?:\.(g2))?(?:\.(s))?\.icon\.png$/;

/**
 * Species id -> the form tokens upstream has sprite art for (`ALOLA`, `CROWNED_SWORD`, `UNOWN_A`, ...).
 * Those tokens are exactly what `lib/sprite-url.ts` folds into storage keys and what `Listing.formCode`
 * holds, so they define the app's spelling. Costume-only files (`.c`) and gender variants add nothing.
 */
export function parseAssetFormTokens(fileNames: readonly string[]): Map<number, Set<string>> {
  const tokens = new Map<number, Set<string>>();
  for (const file of fileNames) {
    const match = ICON_NAME.exec(file);
    if (!match || !match[2] || match[3]) continue;
    const id = Number(match[1]);
    const set = tokens.get(id) ?? new Set<string>();
    set.add(match[2]);
    tokens.set(id, set);
  }
  return tokens;
}

/** The shape `listings.form_code` and `creature_ref_is_valid` accept (migration 20260927000500). */
const FORM_CODE = /^[A-Z0-9_]{1,40}$/;

export interface ResolvedFormCode {
  code: string;
  /** True when upstream sprite art exists under exactly this spelling. */
  confirmed: boolean;
}

/**
 * Game master form enum -> the app's form code.
 *
 * The convention (366 of the 400 forms that have both a game master template and sprite art): drop the species prefix, so `ZACIAN_CROWNED_SWORD`
 * is `CROWNED_SWORD` and `RATTATA_ALOLA` is `ALOLA`. The exceptions (Unown, Burmy and Wormadam keep the
 * whole enum: `UNOWN_A`, `WORMADAM_SANDY`) are found by checking BOTH spellings against the sprite listing
 * rather than by listing species here. A form with no art at all (Silvally's memories, Calyrex's riders)
 * gets the convention's spelling with `confirmed: false`, so it is reported rather than guessed silently.
 */
export function resolveFormCode(enumName: string, gmForm: string, tokens: ReadonlySet<string> | undefined): ResolvedFormCode {
  const prefix = `${enumName}_`;
  const stripped = gmForm.startsWith(prefix) ? gmForm.slice(prefix.length) : gmForm;
  const candidates = [...new Set([stripped, gmForm])];
  const withArt = candidates.filter((candidate) => tokens?.has(candidate));
  if (withArt.length > 1) throw new Error(`${gmForm}: both ${withArt.join(' and ')} have sprite art, so the spelling is ambiguous`);
  const code = withArt[0] ?? stripped;
  if (!FORM_CODE.test(code)) throw new Error(`${gmForm}: "${code}" is not a valid form code ([A-Z0-9_]{1,40})`);
  return { code, confirmed: withArt.length === 1 };
}

// ================================================================================================
// Form catalog: the forms a creature can be listed as
// ================================================================================================

/**
 * Costume-flagged forms the app nevertheless stores as a FORM: species id -> the app's form codes.
 *
 * The game master flags 97 forms `isCostume` (Pikachu's 70-odd event outfits, `CORSOLA_SPRING_2026`, ...), and
 * the sprite listing files every one of them under a `.f` token, not the `.c` costume token. So the sprite
 * pipeline's `.f`/`.c` split cannot tell a costume from a form here, and the game master's own flag is the
 * only signal: a flagged form is an event outfit. Outfits are not offered as forms, because a costume is a
 * listing attribute of its own (`Listing.costume`, `costumeCode`), and offering Pikachu 70 extra "forms"
 * would bury the few real ones.
 *
 * The one exception is Armored Mewtwo (`MEWTWO_A`, code `A`). The game master flags it `isCostume` too, but
 * this app has treated it as a form from the start: `FORM_LABEL_TABLE` names it, the hosted data rewrite
 * mapped it to 150/`A`, and listings already carry it. It is the only entry, and the builder throws if an
 * entry stops being a flagged form, so the table cannot go stale unnoticed.
 */
export const COSTUME_FORMS_KEPT_AS_FORMS: ReadonlyMap<number, ReadonlySet<string>> = new Map([[150, new Set(['A'])]]);

/**
 * Event outfits the game master does NOT flag `isCostume`, so the flag alone would offer them as forms: species
 * id -> the app's form codes. The mirror image of `COSTUME_FORMS_KEPT_AS_FORMS` (a flagged form that IS a form),
 * keyed the same way, and for the same reason: the flag is the only machine-readable signal, so every place the
 * flag is wrong needs an explicit, reviewed entry.
 *
 *   - `COPY_2019` on #3 Venusaur, #6 Charizard, #9 Blastoise and #25 Pikachu: a 2019 event form. Its game
 *     master entry carries an `assetBundleSuffix` of `pm00NN_00_pgo_copy2019` and no `isCostume`, while
 *     Pikachu's other 2019 outfits (`FALL_2019`, `VS_2019`) ARE flagged.
 *   - `SWIM_2025` on #54 Psyduck: a 2025 event form, likewise unflagged.
 * That these behave as costumes is the project's judgement (2026-10-18), not something the data states; the
 * data only shows that they are event-year forms with no flag. With them out, none of the five species has any
 * other selectable form, so all five drop out of POKEDEX_FORMS.
 *
 * SPECIES-SCOPED, like the table above, and not a global set of codes like `SHADOW_MARKER_CODES`. The shadow
 * marker is one game master convention that means the same on every species, so one code is right for all of
 * them. An event outfit is a judgement about a specific form, made by reading it, so the entry names exactly the
 * forms that were read. That keeps the generated diff the review of any new form (an unflagged outfit on a
 * species not listed here shows up as a new selectable form, instead of being swallowed by a rule written for
 * other species), and it lets the staleness guard name the precise entry that stopped matching, where a global
 * code would stay satisfied while any one species still had it.
 *
 * The builder THROWS when an entry no longer matches a non-default form in the game master's list for that
 * species (renamed, removed, or the species has no form list), and when the game master has since flagged it
 * `isCostume` (the entry is then redundant: delete it). So the table can neither go stale unnoticed nor outlive
 * the data fix that makes it unnecessary.
 */
export const UNFLAGGED_COSTUME_FORMS_EXCLUDED: ReadonlyMap<number, ReadonlySet<string>> = new Map([
  [3, new Set(['COPY_2019'])], // Venusaur
  [6, new Set(['COPY_2019'])], // Charizard
  [9, new Set(['COPY_2019'])], // Blastoise
  [25, new Set(['COPY_2019'])], // Pikachu
  [54, new Set(['SWIM_2025'])], // Psyduck
]);

/**
 * Form codes that are the game master's form-level Shadow marker rather than a form a trainer can own.
 *
 * `S` is a single-letter form on seven legendaries (#243 Raikou, #244 Entei, #245 Suicune, #249 Lugia, #250
 * Ho-Oh, #380 Latias, #381 Latios; Unown's letter keeps its species prefix, `UNOWN_S`, so it is not this).
 * What `S` stands for is NOT stated anywhere in the pinned sources, so this is a judgement, not a fact the
 * data proves: it is treated as Shadow because (a) the app has no shadow concept (shadow Pokémon are untradable
 * and `listings.bg` refuses 'shadow'), (b) the earlier data rewrite deliberately left Apex Lugia and Ho-Oh
 * (`249/250.fS`) unmapped, and (c) a bare "S" has no label a trainer could read. If that reading is wrong,
 * remove the code here and regenerate; nothing else changes.
 */
export const SHADOW_MARKER_CODES: ReadonlySet<string> = new Set(['S']);

/** A code that names a status rather than a form: `X_SHADOW`, `X_PURIFIED` or the bare word. Anchored to the
 *  END on purpose: `CALYREX_SHADOW_RIDER` is a real species form (Shadow Rider) and must not match. */
const STATUS_SUFFIX = /(?:^|_)(?:SHADOW|PURIFIED)$/;

export interface FormCatalogEntry {
  pokemonId: number;
  /** The species' default form, when it has a NAME of its own (Zacian's `HERO`, Giratina's `ALTERED`,
   *  Vivillon's `MEADOW`). Null when the default is the game master's plain `*_NORMAL`. It is never in
   *  `forms`: `formCode: null` already means it. */
  defaultCode: string | null;
  /** The selectable non-default forms, in the game master's order. Never empty. */
  forms: ResolvedFormCode[];
}

export interface FormCatalogReport {
  /** Species whose game master list names two or more forms. */
  speciesWithSeveralForms: number;
  /** `isCostume` forms left out, with the app's spelling of their code. */
  excludedCostumes: { pokemonId: number; code: string }[];
  /** `isCostume` forms kept because `COSTUME_FORMS_KEPT_AS_FORMS` says so. */
  keptCostumes: { pokemonId: number; code: string }[];
  /** Event forms left out because `UNFLAGGED_COSTUME_FORMS_EXCLUDED` says so (the game master does not flag them). */
  excludedUnflaggedCostumes: { pokemonId: number; code: string }[];
  /** Shadow/purified status codes left out (`SHADOW_MARKER_CODES`, `*_SHADOW`, `*_PURIFIED`). */
  excludedStatus: { pokemonId: number; code: string }[];
  /** Species whose default is `BASE_FORM_CODES`' form, where the game master lists a different form first. */
  defaultsFromBaseTable: { pokemonId: number; code: string; gameMasterFirst: string }[];
  /** FATAL: `BASE_FORM_CODES` names a form code the species' game master list does not contain, so one of
   *  the two is stale. Must be empty to write. */
  baseTableConflicts: { pokemonId: number; code: string }[];
}

/**
 * The selectable forms of every species, from the game master's `FORMS_V####_POKEMON_*` lists.
 *
 * WHAT IS LEFT OUT (each rule is also stated in the generated file's header):
 *   1. The DEFAULT form, because `formCode: null` already means it. That is the form `BASE_FORM_CODES`
 *      names when the species has an entry (the form the sprite pipeline already treats as the species' base:
 *      Unown A, Vivillon Meadow, Toxtricity Amped, ...), otherwise the first form the game master lists. A
 *      `*_NORMAL` form is always left out as well: it is the default by definition.
 *   2. Temporary evolutions (Mega, Primal) and Gigantamax. They are not stored forms, and the game master's
 *      form lists do not carry them (Mega/Primal live in `tempEvoOverrides`), so nothing needs filtering.
 *   3. Event costumes: forms the game master flags `isCostume`, except `COSTUME_FORMS_KEPT_AS_FORMS`, and the
 *      event forms it does not flag that `UNFLAGGED_COSTUME_FORMS_EXCLUDED` names.
 *   4. Status variants: `SHADOW_MARKER_CODES` and any code ending `_SHADOW` / `_PURIFIED`.
 * Everything else is offered, including forms whose spelling has no sprite art yet (`confirmed: false`, the
 * same convention as the override table) and forms of untradable species. TRADABILITY IS NOT DECIDED HERE:
 * `isPokemonUntradable` (constants/pokedex.ts), mirrored in the database, is the one rule, and a picker
 * applies it to whatever this returns.
 *
 * Two codes that resolve to the same spelling are offered once. Species are in id order and forms in the
 * game master's order, so the output is deterministic.
 */
export function buildFormCatalog(input: {
  species: readonly SpeciesRow[];
  gameMasterForms: ReadonlyMap<number, GmFormList>;
  assetTokens: ReadonlyMap<number, ReadonlySet<string>>;
  baseFormCodes: Readonly<Record<number, string>>;
}): { entries: FormCatalogEntry[]; report: FormCatalogReport } {
  const { species, gameMasterForms, assetTokens, baseFormCodes } = input;
  const entries: FormCatalogEntry[] = [];
  const report: FormCatalogReport = {
    speciesWithSeveralForms: 0,
    excludedCostumes: [],
    keptCostumes: [],
    excludedUnflaggedCostumes: [],
    excludedStatus: [],
    defaultsFromBaseTable: [],
    baseTableConflicts: [],
  };

  for (const row of species) {
    const list = gameMasterForms.get(row.id);
    const unflagged = UNFLAGGED_COSTUME_FORMS_EXCLUDED.get(row.id);
    if (!list || list.forms.length < 2) {
      // Checked before skipping, so an entry for a species whose form list shrank or vanished cannot go stale.
      if (unflagged) throw new Error(`#${row.id} ${[...unflagged].join(', ')}: UNFLAGGED_COSTUME_FORMS_EXCLUDED excludes it, but the game master lists no such form`);
      continue;
    }
    report.speciesWithSeveralForms++;

    const tokens = assetTokens.get(row.id);
    const resolved = list.forms.map((entry) => ({ ...entry, ...resolveFormCode(list.enumName, entry.form, tokens) }));

    const kept = COSTUME_FORMS_KEPT_AS_FORMS.get(row.id);
    for (const code of kept ?? []) {
      if (!resolved.some((r) => r.code === code && r.isCostume)) {
        throw new Error(`#${row.id} ${code}: COSTUME_FORMS_KEPT_AS_FORMS keeps it, but the game master no longer lists it as an isCostume form`);
      }
    }

    const baseCode = baseFormCodes[row.id];
    const baseEntry = baseCode === undefined ? undefined : resolved.find((r) => r.code === baseCode);
    if (baseCode !== undefined && !baseEntry) report.baseTableConflicts.push({ pokemonId: row.id, code: baseCode });
    const defaultEntry = baseEntry ?? resolved[0];
    if (baseEntry && baseEntry !== resolved[0]) {
      report.defaultsFromBaseTable.push({ pokemonId: row.id, code: baseEntry.code, gameMasterFirst: resolved[0].code });
    }

    for (const code of unflagged ?? []) {
      const entry = resolved.find((r) => r.code === code);
      if (!entry || entry === defaultEntry) {
        throw new Error(`#${row.id} ${code}: UNFLAGGED_COSTUME_FORMS_EXCLUDED excludes it, but it is not a non-default form in the game master's list`);
      }
      if (entry.isCostume) {
        throw new Error(`#${row.id} ${code}: the game master now flags it isCostume, so UNFLAGGED_COSTUME_FORMS_EXCLUDED no longer needs it; remove the entry`);
      }
    }

    const taken = new Set<string>([defaultEntry.code]);
    const forms: ResolvedFormCode[] = [];
    for (const r of resolved) {
      if (r === defaultEntry || r.form.endsWith('_NORMAL') || taken.has(r.code)) continue;
      taken.add(r.code);
      if (SHADOW_MARKER_CODES.has(r.code) || STATUS_SUFFIX.test(r.code)) {
        report.excludedStatus.push({ pokemonId: row.id, code: r.code });
        continue;
      }
      if (r.isCostume) {
        if (!kept?.has(r.code)) {
          report.excludedCostumes.push({ pokemonId: row.id, code: r.code });
          continue;
        }
        report.keptCostumes.push({ pokemonId: row.id, code: r.code });
      }
      if (unflagged?.has(r.code)) {
        report.excludedUnflaggedCostumes.push({ pokemonId: row.id, code: r.code });
        continue;
      }
      forms.push({ code: r.code, confirmed: r.confirmed });
    }
    if (forms.length === 0) continue;
    entries.push({ pokemonId: row.id, defaultCode: defaultEntry.form.endsWith('_NORMAL') ? null : defaultEntry.code, forms });
  }
  return { entries, report };
}

// ================================================================================================
// Tradability cross-check
// ================================================================================================

/**
 * The app's untradable rules as the generator sees them. Both halves come from `constants/untradable.ts` (a leaf
 * module, so importing it cannot pull in the data file this run replaces) and arrive as INPUT, like
 * `baseFormCodes`, so tests can substitute fixtures.
 */
export interface TradabilityRules {
  /** `isPokemonUntradable`. `formCode: null` is the species' default form. */
  isUntradable: (pokemonId: number, formCode: string | null) => boolean;
  /** `UNTRADABLE_FORM_COMBINATIONS`: the forms the rules name one by one. */
  formCombinations: readonly { pokemonId: number; formCode: string }[];
}

/** One deliberate difference between the app's untradable rules and the game master's `isTradable`. */
export interface TradabilityOverride {
  pokemonId: number;
  /** The app's form code for the game master entry; `null` is the species' default form (its formless
   *  template, and its `*_NORMAL` form template, which are the same creature to the app). */
  formCode: string | null;
  /** What the game master says. The app says the opposite: that is what makes this an override. */
  gameMasterTradable: boolean;
  /** Why the app departs from the source. Printed by the generator and written into the data file's header. */
  reason: string;
}

/**
 * The ONLY places the app's untradable rules (`constants/untradable.ts`, mirrored by
 * `public.is_creature_untradable`) are allowed to differ from the game master's `isTradable`. Every other
 * species and form must agree, or `checkTradability` reports it and the generator refuses to write.
 *
 * Add an entry only for a decision the project has made on purpose, with its reason. An entry is also a promise
 * that the game master still says what it says: `checkTradability` THROWS when an entry no longer matches a real
 * disagreement (the game master changed its mind, or the app's rule did), so the list shrinks to what is true.
 *
 * Pecharunt (#1025): the pinned game master marks it `isTradable: true`, on its formless template and on
 * `PECHARUNT_NORMAL`. The project keeps it untradable, like every Mythical except Meltan and Melmetal
 * (`UNTRADABLE_MYTHICAL_IDS`). That is the project owner's decision (2026-10-18), not a reading of the source.
 */
export const TRADABILITY_OVERRIDES: readonly TradabilityOverride[] = [
  {
    pokemonId: 1025,
    formCode: null,
    gameMasterTradable: true,
    reason: 'the project treats it as a Mythical, like every Mythical but Meltan and Melmetal; owner decision, 2026-10-18',
  },
];

export interface TradabilityDisagreement {
  pokemonId: number;
  name: string;
  /** The app's form code; `null` is the species' default form. */
  formCode: string | null;
  /** What the game master says; the app's rules say the opposite. */
  gameMasterTradable: boolean;
}

export interface TradabilityReport {
  /** (species, form) entries compared: per species its default form plus every form with a template of its own. */
  checked: number;
  /** Species the game master has no `pokemonSettings` for (Basculegion), so nothing was compared whatever the rules say. */
  unchecked: { pokemonId: number; name: string }[];
  /** Differences accepted because `TRADABILITY_OVERRIDES` lists them. */
  overridden: (TradabilityDisagreement & { reason: string })[];
  /** FATAL: differences nothing lists. Must be empty to write. */
  disagreements: TradabilityDisagreement[];
  /** FATAL: `UNTRADABLE_FORM_COMBINATIONS` names a form the game master has no template for, so the rule can
   *  never be compared (the form was renamed or removed upstream). Must be empty to write. */
  unmatchedFormRules: { pokemonId: number; formCode: string }[];
}

/**
 * Compares the game master's `isTradable` with the app's untradable rules, for every species and form the game
 * master has a template for. The flag is per TEMPLATE, so it is checked per form: `ZACIAN_HERO` is tradable and
 * `ZACIAN_CROWNED_SWORD` is not, and the rules must say so for each. A flag that is absent counts as untradable
 * (the pinned file never writes `false`).
 *
 * WHAT IS COMPARED. For each species, one entry per app form code: the formless template and the `*_NORMAL`
 * form are the species' default form (`formCode: null`, since `NORMAL` is never stored), and every other form
 * template is its resolved code (`resolveFormCode`), so a rule keyed `CROWNED_SWORD` meets the template named
 * `ZACIAN_CROWNED_SWORD`. Two templates that land on one entry must agree, or this throws: a game master that
 * contradicts itself about one creature has no answer to compare against.
 *
 * WHAT HAPPENS ON A DIFFERENCE. It is reported in `disagreements` (the caller refuses to write; see
 * `blockingProblems`) unless `TRADABILITY_OVERRIDES` lists exactly it. An override that matches nothing throws,
 * so the list cannot go stale. Species the game master has no template for cannot be compared; they are named
 * in `unchecked`, not failed.
 *
 * The comparison also runs backwards for forms: a form the rules name (`formCombinations`) must exist in the game
 * master, or the rule is dead (`unmatchedFormRules`). Only species in the `species` input are considered, so a
 * fixture with a handful of species is not failed for the rest of the dex.
 */
export function checkTradability(input: {
  species: readonly SpeciesRow[];
  gameMaster: ReadonlyMap<number, GmSpecies>;
  assetTokens: ReadonlyMap<number, ReadonlySet<string>>;
  rules: TradabilityRules;
}): TradabilityReport {
  const { species, gameMaster, assetTokens, rules } = input;
  const report: TradabilityReport = { checked: 0, unchecked: [], overridden: [], disagreements: [], unmatchedFormRules: [] };
  const compared = new Set<string>();
  const usedOverrides = new Set<TradabilityOverride>();
  const key = (pokemonId: number, formCode: string | null) => `${pokemonId}:${formCode ?? ''}`;

  for (const row of species) {
    const entry = gameMaster.get(row.id);
    if (!entry) {
      report.unchecked.push({ pokemonId: row.id, name: row.name });
      continue;
    }

    const tokens = assetTokens.get(row.id);
    const tradableByForm = new Map<string | null, boolean>();
    const note = (formCode: string | null, tradable: boolean, source: string) => {
      const earlier = tradableByForm.get(formCode);
      if (earlier !== undefined && earlier !== tradable) {
        throw new Error(`#${row.id} ${row.name}: the game master contradicts itself about ${formCode ?? 'the default form'}: ${source} says ${tradable ? 'tradable' : 'untradable'}, an earlier template says the opposite`);
      }
      tradableByForm.set(formCode, tradable);
    };
    note(null, entry.bareTradable, 'the formless template');
    for (const [form, tradable] of entry.formTradable) {
      note(form.endsWith('_NORMAL') ? null : resolveFormCode(entry.enumName, form, tokens).code, tradable, form);
    }

    for (const [formCode, gameMasterTradable] of tradableByForm) {
      report.checked++;
      compared.add(key(row.id, formCode));
      if (gameMasterTradable !== rules.isUntradable(row.id, formCode)) continue; // tradable both ways, or untradable both ways
      const disagreement: TradabilityDisagreement = { pokemonId: row.id, name: row.name, formCode, gameMasterTradable };
      const override = TRADABILITY_OVERRIDES.find((o) => o.pokemonId === row.id && o.formCode === formCode && o.gameMasterTradable === gameMasterTradable);
      if (override) {
        usedOverrides.add(override);
        report.overridden.push({ ...disagreement, reason: override.reason });
      } else report.disagreements.push(disagreement);
    }
  }

  const inDex = new Set(species.map((row) => row.id));
  for (const override of TRADABILITY_OVERRIDES) {
    if (inDex.has(override.pokemonId) && !usedOverrides.has(override)) {
      throw new Error(
        `TRADABILITY_OVERRIDES entry #${override.pokemonId} ${override.formCode ?? '(default form)'} no longer matches a difference ` +
          `(the game master ${override.gameMasterTradable ? 'no longer says tradable' : 'no longer says untradable'}, or the app's rule changed): remove the entry`,
      );
    }
  }
  for (const combination of rules.formCombinations) {
    if (inDex.has(combination.pokemonId) && gameMaster.has(combination.pokemonId) && !compared.has(key(combination.pokemonId, combination.formCode))) {
      report.unmatchedFormRules.push({ pokemonId: combination.pokemonId, formCode: combination.formCode });
    }
  }
  return report;
}

// ================================================================================================
// Assembly + cross-checks
// ================================================================================================

export interface FormOverride {
  pokemonId: number;
  formCode: string;
  types: PokemonTypes;
  /** See `ResolvedFormCode.confirmed`. */
  confirmed: boolean;
}

export interface Disagreement {
  pokemonId: number;
  name: string;
  pokeApi: PokemonTypes;
  gameMaster: PokemonTypes;
}

export interface BuildReport {
  species: number;
  /** Species with game master typing data. */
  gameMasterSpecies: number;
  /** In PokeAPI but absent from the game master: their typing is PokeAPI's alone, and they get no overrides. */
  missingFromGameMaster: { pokemonId: number; name: string }[];
  /** FATAL: species whose game master DEFAULT FORM typing differs from PokeAPI's. Must be empty to write. */
  disagreements: Disagreement[];
  /** Informational: species whose formless game master template differs from PokeAPI (Zacian, Zamazenta,
   *  Urshifu). Each is explained by a default form with its own template; see `gameMasterDefaultTypes`. */
  formlessDisagreements: Disagreement[];
  /** Species whose default form was read from the formless template because no form template exists for it. */
  defaultFromFormless: number;
  overridesFromForms: number;
  overridesFromTempEvolutions: number;
  /** Sprite art exists for these (species, form token) pairs, but the game master has no typing for them,
   *  so they resolve to the species default. May include cosmetic tokens (costumes) that never change typing. */
  assetFormsWithoutTypes: { pokemonId: number; token: string }[];
  formCatalog: FormCatalogReport;
  /** The game master's `isTradable` against the app's untradable rules; see `checkTradability`. */
  tradability: TradabilityReport;
}

export interface PokedexData {
  species: SpeciesRow[];
  overrides: FormOverride[];
  /** Species with at least one selectable non-default form, in id order. */
  forms: FormCatalogEntry[];
  report: BuildReport;
}

export function buildPokedexData(input: {
  species: readonly SpeciesRow[];
  gameMaster: ReadonlyMap<number, GmSpecies>;
  gameMasterForms: ReadonlyMap<number, GmFormList>;
  assetTokens: ReadonlyMap<number, ReadonlySet<string>>;
  /** `constants/base-form-codes.ts`: which form `formCode: null` means for the species it names. */
  baseFormCodes: Readonly<Record<number, string>>;
  /** `constants/untradable.ts`: the rules `checkTradability` holds the game master's `isTradable` against. */
  tradabilityRules: TradabilityRules;
}): PokedexData {
  const { species, gameMaster, gameMasterForms, assetTokens, baseFormCodes, tradabilityRules } = input;
  const missingFromGameMaster: BuildReport['missingFromGameMaster'] = [];
  const disagreements: Disagreement[] = [];
  const formlessDisagreements: Disagreement[] = [];
  const overrides: FormOverride[] = [];
  let defaultFromFormless = 0;
  let overridesFromForms = 0;
  let overridesFromTempEvolutions = 0;
  const assetFormsWithoutTypes: BuildReport['assetFormsWithoutTypes'] = [];

  for (const row of species) {
    const entry = gameMaster.get(row.id);
    if (!entry) {
      missingFromGameMaster.push({ pokemonId: row.id, name: row.name });
      continue;
    }

    const formList = gameMasterForms.get(row.id);
    if (formList && formList.enumName !== entry.enumName) {
      throw new Error(`#${row.id}: the form list says ${formList.enumName} but the species template says ${entry.enumName}`);
    }

    const asDisagreement = (gm: PokemonTypes): Disagreement => ({ pokemonId: row.id, name: row.name, pokeApi: row.types, gameMaster: gm });
    const def = gameMasterDefaultTypes(entry);
    if (def.via === 'formless') defaultFromFormless++;
    if (!sameTypes(def.types, row.types)) disagreements.push(asDisagreement(def.types));
    if (!sameTypes(entry.bare, row.types)) formlessDisagreements.push(asDisagreement(entry.bare));

    const tokens = assetTokens.get(row.id);
    const claimed = new Set<string>();
    const seenCodes = new Map<string, PokemonTypes>();
    const consider = (gmForm: string, types: PokemonTypes, fromTempEvo: boolean) => {
      const resolved = fromTempEvo ? { code: gmForm, confirmed: tokens?.has(gmForm) ?? false } : resolveFormCode(entry.enumName, gmForm, tokens);
      claimed.add(resolved.code);
      if (sameTypes(types, row.types)) return;
      const earlier = seenCodes.get(resolved.code);
      if (earlier && sameTypes(earlier, types)) return; // the same override reached through two templates
      if (earlier) throw new Error(`#${row.id} ${resolved.code}: two game master forms collapse to one code with ${earlier.join('/')} vs ${types.join('/')}`);
      seenCodes.set(resolved.code, types);
      overrides.push({ pokemonId: row.id, formCode: resolved.code, types, confirmed: resolved.confirmed });
      if (fromTempEvo) overridesFromTempEvolutions++;
      else overridesFromForms++;
    };
    for (const [form, types] of entry.forms) consider(form, types, false);
    for (const [code, types] of entry.tempEvos) consider(code, types, true);

    for (const token of tokens ?? []) if (!claimed.has(token)) assetFormsWithoutTypes.push({ pokemonId: row.id, token });
  }

  overrides.sort((a, b) => a.pokemonId - b.pokemonId || (a.formCode < b.formCode ? -1 : a.formCode > b.formCode ? 1 : 0));
  assetFormsWithoutTypes.sort((a, b) => a.pokemonId - b.pokemonId || (a.token < b.token ? -1 : 1));
  const catalog = buildFormCatalog({ species, gameMasterForms, assetTokens, baseFormCodes });
  const tradability = checkTradability({ species, gameMaster, assetTokens, rules: tradabilityRules });
  return {
    species: [...species],
    overrides,
    forms: catalog.entries,
    report: {
      species: species.length,
      gameMasterSpecies: species.length - missingFromGameMaster.length,
      missingFromGameMaster,
      disagreements,
      formlessDisagreements,
      defaultFromFormless,
      overridesFromForms,
      overridesFromTempEvolutions,
      assetFormsWithoutTypes,
      formCatalog: catalog.report,
      tradability,
    },
  };
}

/**
 * Why the generator must NOT write the data file, one sentence per problem (empty when it may). The CLI prints
 * the detail above these and exits 1; keeping the decision here, next to the report, means a new check cannot
 * be added to the report and forgotten by the CLI, and it is covered by tests.
 */
export function blockingProblems(report: BuildReport): string[] {
  const problems: string[] = [];
  if (report.disagreements.length > 0) {
    problems.push(`the sources disagree about ${report.disagreements.length} species' default typing (listed above).`);
  }
  if (report.formCatalog.baseTableConflicts.length > 0) {
    problems.push(
      `BASE_FORM_CODES (constants/base-form-codes.ts) names ${report.formCatalog.baseTableConflicts.length} default form(s) the game master does not list (listed above).`,
    );
  }
  if (report.tradability.disagreements.length > 0) {
    problems.push(
      `the game master's isTradable disagrees with the app's untradable rules (constants/untradable.ts) for ${report.tradability.disagreements.length} ` +
        `${report.tradability.disagreements.length === 1 ? 'entry' : 'entries'} not listed in TRADABILITY_OVERRIDES (listed above).`,
    );
  }
  if (report.tradability.unmatchedFormRules.length > 0) {
    problems.push(
      `UNTRADABLE_FORM_COMBINATIONS (constants/untradable.ts) names ${report.tradability.unmatchedFormRules.length} form(s) the game master has no template for (listed above).`,
    );
  }
  return problems;
}

// ================================================================================================
// Rendering constants/pokedex-data.ts
// ================================================================================================

export interface Provenance {
  /** `owner/repo@<commit sha>` for each input, so the file says exactly what it was generated from. */
  pokeApi: string;
  gameMaster: string;
  spriteAssets: string;
}

/**
 * The three `owner/repo@<sha>` lines of a previously generated data file's header, or `null` when the text
 * has none (a hand-edited or pre-provenance file). `generate-pokedex.ts --pinned` regenerates from exactly
 * these commits instead of whatever `master` points at today, so a rerun reproduces the file byte for byte
 * and a change to the generator is not mixed with unrelated upstream drift.
 */
export function parseProvenance(dataFile: string): Provenance | null {
  const find = (repo: string): string | null => new RegExp(`${repo.replace('/', '\\/')}@([0-9a-f]{40})\\b`).exec(dataFile)?.[0] ?? null;
  const pokeApi = find('PokeAPI/pokeapi');
  const gameMaster = find('PokeMiners/game_masters');
  const spriteAssets = find('PokeMiners/pogo_assets');
  return pokeApi && gameMaster && spriteAssets ? { pokeApi, gameMaster, spriteAssets } : null;
}

/** Single-quoted TS string literal. Names are plain text, but escape anyway so a quote can't break the file. */
const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const typesLiteral = (types: PokemonTypes): string => `[${types.map(quote).join(', ')}]`;

export const REGENERATE_COMMAND = 'npm run pokedex:generate';

export function renderDataFile(data: PokedexData, provenance: Provenance): string {
  const { report } = data;
  const unconfirmed = data.overrides.filter((o) => !o.confirmed).length;
  const formCount = data.forms.reduce((sum, entry) => sum + entry.forms.length, 0);
  const unconfirmedForms = data.forms.reduce((sum, entry) => sum + entry.forms.filter((f) => !f.confirmed).length, 0);
  const namedDefaults = data.forms.filter((entry) => entry.defaultCode !== null).length;
  const keptText = report.formCatalog.keptCostumes.map((k) => `#${k.pokemonId} ${k.code}`).join(', ');
  const unflaggedText = report.formCatalog.excludedUnflaggedCostumes.map((x) => `#${x.pokemonId} ${x.code}`).join(', ');
  const overrideText = report.tradability.overridden
    .map((o) => `#${o.pokemonId} ${o.name}${o.formCode === null ? '' : ` ${o.formCode}`}: game master ${o.gameMasterTradable ? 'tradable' : 'untradable'}, app ${o.gameMasterTradable ? 'untradable' : 'tradable'} on purpose (${o.reason})`)
    .join('; ');
  const statusSpecies = new Set(report.formCatalog.excludedStatus.map((x) => x.pokemonId)).size;
  const statusCodes = [...new Set(report.formCatalog.excludedStatus.map((x) => x.code))];
  const statusText = report.formCatalog.excludedStatus.length > 0 ? ` (code ${statusCodes.join(', ')} on ${statusSpecies} species)` : '';
  const lines: string[] = [];
  const missing = report.missingFromGameMaster.map((m) => `#${m.pokemonId} ${m.name}`);
  const quirk = report.formlessDisagreements.map((d) => `#${d.pokemonId} ${d.name}`);
  lines.push(`/**
 * Generated Pokédex data — DO NOT EDIT BY HAND.
 *
 * Regenerate with \`${REGENERATE_COMMAND}\` (scripts/generate-pokedex.ts; the logic is in
 * scripts/pokedex-source.ts). It downloads three upstream sources at generation time only. The app never
 * fetches game data at runtime, and nothing downloaded is committed except this file:
 *
 *   ${provenance.pokeApi}
 *     data/v2/csv/{pokemon_species,pokemon_species_names,pokemon,pokemon_types,types}.csv
 *     Every species' English name and DEFAULT typing (both slots, in PokeAPI's slot order), taken from
 *     the pokemon row whose id equals the species id.
 *   ${provenance.gameMaster}
 *     latest/latest.json (Pokémon GO's own data). Per-form types, for FORM_TYPE_OVERRIDES; a cross-check of
 *     every species' default typing against PokeAPI's; each species' list of forms (the FORMS_
 *     templates), for POKEDEX_FORMS; and a cross-check of every species' and form's isTradable flag
 *     against the app's untradable rules (nothing from it is written to this file).
 *   ${provenance.spriteAssets}
 *     "Images/Pokemon - 256x256/Addressable Assets" (file listing only). The form-token spelling the app
 *     stores in \`formCode\`, so overrides and the form catalog are keyed exactly as listings carry them.
 *
 * Coverage when generated:
 *   - ${report.species} species. The game master has typing for ${report.gameMasterSpecies}${
   missing.length > 0 ? `; not for ${missing.join(', ')}, which has PokeAPI typing and no form overrides` : ''
 }.
 *   - Default-form typing, game master vs PokeAPI: ${report.gameMasterSpecies - report.disagreements.length} of ${report.gameMasterSpecies} agree (the generator refuses to write while any differ).${
   quirk.length > 0
     ? `\n *     (The game master's FORMLESS template for ${quirk.join(', ')} carries a non-default form's\n *     typing, which is why a default is read from the species' first-listed form.)`
     : ''
 }
 *   - ${data.overrides.length} form overrides: ${report.overridesFromForms} from form templates, ${report.overridesFromTempEvolutions} from Mega/Primal evolutions${
   unconfirmed > 0 ? `. ${unconfirmed} are marked "spelling unconfirmed": upstream has no sprite art under that form code yet` : ''
 }.
 *   - ${formCount} selectable forms on ${data.forms.length} species in POKEDEX_FORMS${
   unconfirmedForms > 0 ? `; ${unconfirmedForms} are marked "spelling unconfirmed" the same way` : ''
 }. ${namedDefaults} of those species have a default form with a name of its own (POKEDEX_DEFAULT_FORMS).
 *   - Left out of POKEDEX_FORMS (see the rules below): ${report.formCatalog.excludedCostumes.length} event-costume forms${
   report.formCatalog.keptCostumes.length > 0 ? ` (and kept as forms: ${keptText})` : ''
 }${
   report.formCatalog.excludedUnflaggedCostumes.length > 0
     ? `, ${report.formCatalog.excludedUnflaggedCostumes.length} event forms the game master does not flag (${unflaggedText})`
     : ''
 }, and ${report.formCatalog.excludedStatus.length} shadow-marker forms${statusText}.
 *   - Tradability, game master isTradable vs the app's untradable rules (constants/untradable.ts): ${report.tradability.checked} species and form entries compared; ${
   report.tradability.overridden.length > 0
     ? `all agree except ${report.tradability.overridden.length} documented override${report.tradability.overridden.length === 1 ? '' : 's'}: ${overrideText}`
     : 'all agree'
 }. The generator refuses to write while any other differ (TRADABILITY_OVERRIDES).
 *
 * POKEDEX_DATA is species-level: national dex order, ids 1 through ${report.species}, one row per species with its
 * default form's typing. Typing that depends on the form (Alolan, Galarian, Hisuian, Origin, Crowned, Rotom
 * appliances, Mega, ...) lives in FORM_TYPE_OVERRIDES, keyed by (pokemonId, formCode) in PokeMiners'
 * form-code spelling (\`CreatureRef.formCode\`). Only forms whose types DIFFER from the species default are
 * listed, so a form that is not listed has the species' typing. Read both through constants/pokedex.ts
 * (\`typesOf\`, \`typeMembership\`), never directly.
 *
 * POKEDEX_FORMS answers a different question: which forms can a creature be LISTED as (the Create Listing
 * form picker). FORM_TYPE_OVERRIDES cannot answer it, because Origin Palkia and Armored Mewtwo have their
 * species' typing and so are not in it. Rows are \`[pokemonId, formCodes]\` in the same \`formCode\` spelling,
 * species in id order and codes in the game master's own order. \`formCode: null\` means the species' default
 * form, so the default is NOT listed; POKEDEX_DEFAULT_FORMS names it for the species where it has a name of
 * its own (Zacian's Hero, Giratina's Altered, Vivillon's Meadow), so a picker can say so instead of "Standard".
 * What is left out, and why:
 *   - the default form: the one constants/base-form-codes.ts names for the species when it has an entry (the
 *     form the sprite pipeline already treats as the base: Unown A, Vivillon Meadow, Toxtricity Amped), else
 *     the first form the game master lists. Every *_NORMAL form is left out too.
 *   - Mega, Primal and Gigantamax: not stored forms, and the game master's form lists do not carry them.
 *   - event costumes: forms the game master flags \`isCostume\` (Pikachu's outfits, Corsola SPRING_2026, ...).
 *     Their art sits under \`.f\` sprite tokens, so the sprite split cannot tell them from forms; the flag can.
 *     Costume is a listing attribute of its own. The one exception is Armored Mewtwo (\`A\`), which the app has
 *     always stored as a form (COSTUME_FORMS_KEPT_AS_FORMS in scripts/pokedex-source.ts). A few event forms
 *     carry no flag and are named one by one instead (UNFLAGGED_COSTUME_FORMS_EXCLUDED in the same file).
 *   - the form-level Shadow marker (\`S\`) and any code ending _SHADOW or _PURIFIED: shadow is untradable and
 *     purified is a listing flag (SHADOW_MARKER_CODES in scripts/pokedex-source.ts says why \`S\` counts).
 * Tradability is NOT decided here: forms of untradable species are listed, and \`isPokemonUntradable\`
 * (constants/untradable.ts, re-exported by constants/pokedex.ts) is the one rule that refuses them. Read this
 * through \`formsOf\` / \`defaultFormOf\`.
 */
import type { PokemonTypes } from './pokemon-types';

/** \`[id, English name, default-form types]\`. Types are 1 or 2 distinct types, primary (slot 1) first. */
export const POKEDEX_DATA: readonly (readonly [id: number, name: string, types: PokemonTypes])[] = [`);
  for (const row of data.species) lines.push(`  [${row.id}, ${quote(row.name)}, ${typesLiteral(row.types)}],`);
  lines.push(`];

/**
 * \`[pokemonId, formCode, types]\` for every form whose types differ from its species' default in
 * POKEDEX_DATA, sorted by id then code. At most one row per (pokemonId, formCode).
 */
export const FORM_TYPE_OVERRIDES: readonly (readonly [pokemonId: number, formCode: string, types: PokemonTypes])[] = [`);
  for (const o of data.overrides) {
    const mark = o.confirmed ? '' : ' // spelling unconfirmed: no sprite art upstream';
    lines.push(`  [${o.pokemonId}, ${quote(o.formCode)}, ${typesLiteral(o.types)}],${mark}`);
  }
  lines.push('];');

  lines.push(`
/**
 * \`[pokemonId, formCodes]\` for every species with at least one selectable non-default form: the forms a
 * creature can be listed as, in the game master's order. \`formCode: null\` is the default form and is never
 * listed. See the file header for what is left out. Read through \`formsOf\` in constants/pokedex.ts.
 */
export const POKEDEX_FORMS: readonly (readonly [pokemonId: number, formCodes: readonly string[]])[] = [`);
  for (const entry of data.forms) lines.push(...formRow(entry));
  lines.push('];');

  lines.push(`
/**
 * \`[pokemonId, formCode]\` for the species whose default form has a name of its own, i.e. the form
 * \`formCode: null\` stands for (Zacian's \`HERO\`, Vivillon's \`MEADOW\`). A species whose default is the plain \`*_NORMAL\`
 * form is absent. Only species that have a POKEDEX_FORMS row appear. Read through \`defaultFormOf\`.
 */
export const POKEDEX_DEFAULT_FORMS: readonly (readonly [pokemonId: number, formCode: string])[] = [`);
  for (const entry of data.forms) if (entry.defaultCode !== null) lines.push(`  [${entry.pokemonId}, ${quote(entry.defaultCode)}],`);
  lines.push('];', '');
  return lines.join('\n');
}

/** Rows wrap at this width so a species with 27 forms (Unown) stays readable in a diff. */
const FORM_ROW_WIDTH = 120;

/** One `POKEDEX_FORMS` row: a single line when it fits, else one code per wrapped line group. A trailing
 *  comment names the codes whose spelling no sprite art confirms (same convention as the override table). */
function formRow(entry: FormCatalogEntry): string[] {
  const codes = entry.forms.map((f) => quote(f.code));
  const unconfirmed = entry.forms.filter((f) => !f.confirmed).map((f) => f.code);
  const mark = unconfirmed.length === 0 ? '' : unconfirmed.length === entry.forms.length ? ' // spelling unconfirmed: all' : ` // spelling unconfirmed: ${unconfirmed.join(', ')}`;
  const single = `  [${entry.pokemonId}, [${codes.join(', ')}]],`;
  if (single.length <= FORM_ROW_WIDTH) return [single + mark];

  const rows: string[] = [];
  let current = '   ';
  for (const code of codes) {
    const next = `${current} ${code},`;
    if (next.length > FORM_ROW_WIDTH && current.trim().length > 0) {
      rows.push(current);
      current = `    ${code},`;
    } else current = next;
  }
  rows.push(current);
  return [`  [${entry.pokemonId}, [`, ...rows, `  ]],${mark}`];
}
