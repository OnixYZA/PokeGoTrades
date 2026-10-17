/**
 * Pure half of `scripts/generate-pokedex.ts`: turns the raw downloads (PokeAPI's CSV export, the PokeMiners
 * game master, the PokeMiners sprite listing) into the contents of `constants/pokedex-data.ts`. No network,
 * no filesystem, so vitest drives it with small fixtures (`scripts/pokedex-source.test.ts`).
 *
 * RELATIVE IMPORTS ONLY, and the only app module it may import is the LEAF `constants/pokemon-types.ts`:
 * the generator replaces `constants/pokedex-data.ts`, so it must keep running even when that file is stale,
 * mid-merge or the wrong shape. Do not import `constants/pokedex.ts`, `lib/sprite-url.ts` or
 * `scripts/pokeminers.ts` here (each pulls the dex data in).
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
      /** Mega/Primal evolutions: only the entries with a `typeOverride1` change typing. */
      tempEvoOverrides?: { tempEvoId?: string; typeOverride1?: string; typeOverride2?: string }[];
    };
    formSettings?: { forms?: { form?: string }[] };
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
  const building = new Map<number, Omit<GmSpecies, 'bare' | 'defaultForm'> & { bare: PokemonTypes | undefined }>();

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
      entry = { pokemonId, enumName: settings.pokemonId, bare: undefined, forms: new Map(), tempEvos: new Map() };
      building.set(pokemonId, entry);
    } else if (entry.enumName !== settings.pokemonId) {
      throw new Error(`${where}: species enum ${settings.pokemonId} contradicts ${entry.enumName} on #${pokemonId}`);
    }

    if (settings.form) {
      if (entry.forms.has(settings.form)) throw new Error(`${where}: form ${settings.form} is defined twice`);
      entry.forms.set(settings.form, types);
    } else {
      if (entry.bare) throw new Error(`${where}: a second formless template for #${pokemonId}`);
      entry.bare = types;
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
}

export interface PokedexData {
  species: SpeciesRow[];
  overrides: FormOverride[];
  report: BuildReport;
}

export function buildPokedexData(input: {
  species: readonly SpeciesRow[];
  gameMaster: ReadonlyMap<number, GmSpecies>;
  assetTokens: ReadonlyMap<number, ReadonlySet<string>>;
}): PokedexData {
  const { species, gameMaster, assetTokens } = input;
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
  return {
    species: [...species],
    overrides,
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
    },
  };
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

/** Single-quoted TS string literal. Names are plain text, but escape anyway so a quote can't break the file. */
const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const typesLiteral = (types: PokemonTypes): string => `[${types.map(quote).join(', ')}]`;

export const REGENERATE_COMMAND = 'npm run pokedex:generate';

export function renderDataFile(data: PokedexData, provenance: Provenance): string {
  const { report } = data;
  const unconfirmed = data.overrides.filter((o) => !o.confirmed).length;
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
 *     latest/latest.json (Pokémon GO's own data). Per-form types, for FORM_TYPE_OVERRIDES only, and a
 *     cross-check of every species' default typing against PokeAPI's.
 *   ${provenance.spriteAssets}
 *     "Images/Pokemon - 256x256/Addressable Assets" (file listing only). The form-token spelling the app
 *     stores in \`formCode\`, so overrides are keyed exactly as listings carry them.
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
 *
 * POKEDEX_DATA is species-level: national dex order, ids 1 through ${report.species}, one row per species with its
 * default form's typing. Typing that depends on the form (Alolan, Galarian, Hisuian, Origin, Crowned, Rotom
 * appliances, Mega, ...) lives in FORM_TYPE_OVERRIDES, keyed by (pokemonId, formCode) in PokeMiners'
 * form-code spelling (\`CreatureRef.formCode\`). Only forms whose types DIFFER from the species default are
 * listed, so a form that is not listed has the species' typing. Read both through constants/pokedex.ts
 * (\`typesOf\`, \`typeMembership\`), never directly.
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
  lines.push('];', '');
  return lines.join('\n');
}
