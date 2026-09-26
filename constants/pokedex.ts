/**
 * The app's one source of truth for "what Pokémon exist, what are they called, what type are they" —
 * built from `POKEDEX_DATA` (constants/pokedex-data.ts, generated from PokeAPI's CSVs; see that file's
 * header). Nothing here is typed from memory (AGENTS.md: never hallucinate game data): a name or dex
 * number that doesn't appear in `POKEDEX_DATA` cannot be looked up or searched.
 */
import { POKEDEX_DATA } from './pokedex-data';

/** PokéAPI official-artwork sprite URLs, keyed by national dex id + shiny. */
export function spriteUrl(pokemonId: number, shiny = false): string {
  const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
  return shiny ? `${base}/shiny/${pokemonId}.png` : `${base}/${pokemonId}.png`;
}

/** The 18 standard Pokémon types, exactly as they appear in `POKEDEX_DATA`'s third column. */
export type PokemonType =
  | 'Normal'
  | 'Fire'
  | 'Fighting'
  | 'Water'
  | 'Flying'
  | 'Grass'
  | 'Poison'
  | 'Electric'
  | 'Ground'
  | 'Psychic'
  | 'Rock'
  | 'Ice'
  | 'Bug'
  | 'Dragon'
  | 'Ghost'
  | 'Steel'
  | 'Dark'
  | 'Fairy';

export interface PokedexEntry {
  pokemonId: number;
  name: string;
  type: PokemonType;
  hue: number;
}

/**
 * Design mapping of type -> accent hue (0-360), for the hue-driven chip/card backgrounds in
 * `constants/theme.ts` (`hueChipBg`, `hueBleed`, ...). Seven values are pinned to hues already in use
 * for specific Pokémon elsewhere in the app (CreateListingModal's demo creatures, data/listings.ts) so a
 * type-derived hue never clashes with one a screen already hardcodes: Fire 18 (Charizard/Moltres), Water
 * 205 (Blastoise), Grass 130 (Venusaur), Electric 48 (Zapdos), Ice 210 (Articuno), Dragon 205 (Dragonite —
 * shares Water's blue, which is how the mock data already draws it), Psychic 275 (Mewtwo).
 *
 * The rest are chosen to group by the same warm/cool families those seven already sketch out:
 *   - warm earth tones (Normal, Fighting, Ground, Rock, plus Fire/Electric above)
 *   - green (Bug, plus Grass above)
 *   - blue (plus Water/Ice/Dragon above)
 *   - blue-violet "mystical" cluster (Flying, Steel, Ghost, Dark, plus Psychic above)
 *   - pink-violet (Poison, Fairy)
 */
export const TYPE_HUE: Record<PokemonType, number> = {
  Fighting: 5,
  Ground: 35,
  Rock: 42,
  Normal: 45,
  Fire: 18,
  Electric: 48,
  Bug: 85,
  Grass: 130,
  Water: 205,
  Dragon: 205,
  Ice: 210,
  Steel: 220,
  Flying: 230,
  Ghost: 255,
  Dark: 265,
  Psychic: 275,
  Poison: 295,
  Fairy: 330,
};

/** Built once from `POKEDEX_DATA`; every list, lookup and search below reads from this. */
export const POKEDEX: readonly PokedexEntry[] = POKEDEX_DATA.map(([pokemonId, name, primaryType]) => {
  const type = primaryType as PokemonType;
  return { pokemonId, name, type, hue: TYPE_HUE[type] };
});

const BY_ID = new Map<number, PokedexEntry>(POKEDEX.map((entry) => [entry.pokemonId, entry]));

export function findPokemon(pokemonId: number): PokedexEntry | undefined {
  return BY_ID.get(pokemonId);
}

/**
 * Case- and diacritic-insensitive, punctuation-stripping search key: "Flabébé" -> "flabebe",
 * "Mr. Mime" -> "mrmime", "Farfetch’d" -> "farfetchd", "Type: Null" -> "typenull". Diacritics are
 * removed via Unicode decomposition (NFD) rather than a hand-rolled accent table, so it holds for any
 * future entry, not just the ones spot-checked when this was written.
 */
function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const SEARCH_KEYS = new Map<number, string>(POKEDEX.map((entry) => [entry.pokemonId, searchKey(entry.name)]));

/** A query of only digits (an optional leading '#' and leading zeros allowed) is a dex-number search. */
function numericQuery(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#/, '');
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return null;
  const stripped = trimmed.replace(/^0+/, '');
  return stripped.length === 0 ? '0' : stripped;
}

const DEFAULT_SEARCH_LIMIT = 30;

/**
 * Ranked search over the whole dex: numeric queries match the dex number (exact, then prefix);
 * text queries match the name (exact, then prefix, then anywhere), all case/diacritic/punctuation
 * -insensitive. An empty query returns the start of the dex, so callers don't need a separate branch
 * for "nothing typed yet" (see PokemonPickerModal's empty state).
 */
export function searchPokedex(query: string, limit = DEFAULT_SEARCH_LIMIT): PokedexEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return POKEDEX.slice(0, limit);

  const digits = numericQuery(trimmed);
  const key = searchKey(trimmed);

  const ranked: { entry: PokedexEntry; rank: number }[] = [];
  for (const entry of POKEDEX) {
    let rank = Infinity;
    if (digits !== null) {
      const idStr = String(entry.pokemonId);
      if (idStr === digits) rank = 0;
      else if (idStr.startsWith(digits)) rank = 1;
    }
    if (key.length > 0) {
      const nameKey = SEARCH_KEYS.get(entry.pokemonId) ?? '';
      if (nameKey === key) rank = Math.min(rank, 2);
      else if (nameKey.startsWith(key)) rank = Math.min(rank, 3);
      else if (nameKey.includes(key)) rank = Math.min(rank, 4);
    }
    if (rank !== Infinity) ranked.push({ entry, rank });
  }

  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.entry.pokemonId - b.entry.pokemonId));
  return ranked.slice(0, limit).map((r) => r.entry);
}
