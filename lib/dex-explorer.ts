import { TYPE_CHIP_ORDER } from '../constants/listing-attributes';
import {
  canGigantamax,
  formsOf,
  isPokemonUntradable,
  metaRanksOf,
  POKEDEX,
  searchPokedex,
  statsOf,
  typesOf,
  type MetaTier,
  type PokedexEntry,
  type PokemonType,
} from '../constants/pokedex';

/**
 * The Pokédex Explorer's list logic (search + type chip + switches + sort) as ONE pure function, so the screen
 * is only rendering and the composition rules are unit-tested instead of living in `useMemo` bodies.
 *
 * Every value comes from the generated dex through `statsOf` / `metaRanksOf` / `typesOf`; nothing here knows a
 * Pokémon's numbers. A row stands for the SPECIES, so each lookup uses its default form (no `formCode`); the
 * detail sheet looks at a chosen form.
 */

export type DexSort = 'dex' | 'maxCp' | 'attack';

export const DEX_SORTS: readonly { key: DexSort; label: string }[] = [
  { key: 'dex', label: '#Dex' },
  { key: 'maxCp', label: 'Max CP' },
  { key: 'attack', label: 'Attack' },
];

/** The type chip row: "All" (`null`) then every type in the feed's chip order. */
export const DEX_TYPE_FILTERS: readonly (PokemonType | null)[] = [null, ...TYPE_CHIP_ORDER];

export interface DexQuery {
  /** Dex number, name or type, as `searchPokedex` understands it. Blank means the whole dex. */
  query: string;
  /** Keep species with this type in their default form; `null` is "All". */
  type: PokemonType | null;
  /** Hide species that can not be traded at all (`isPokemonUntradable`, species level). */
  tradableOnly: boolean;
  /** Keep only species that can Gigantamax (`canGigantamax`). */
  gmaxOnly: boolean;
  sort: DexSort;
}

export const DEFAULT_DEX_QUERY: DexQuery = { query: '', type: null, tradableOnly: false, gmaxOnly: false, sort: 'dex' };

type StatsLookup = typeof statsOf;

/**
 * Filter, then sort. Filters AND together. `#Dex` is ascending dex number (search relevance is not kept: a
 * trainer who picks a sort wants that order); the stat sorts are descending, ties broken by dex number, and a
 * species without stats goes last in either stat sort. `statsFor` is injectable for tests.
 */
export function exploreDex(q: DexQuery, statsFor: StatsLookup = statsOf): PokedexEntry[] {
  const trimmed = q.query.trim();
  const base = trimmed.length === 0 ? POKEDEX : searchPokedex(trimmed, POKEDEX.length);
  const kept = base.filter((entry) => {
    if (q.type !== null && !typesOf({ pokemonId: entry.pokemonId })?.includes(q.type)) return false;
    if (q.tradableOnly && isPokemonUntradable(entry.pokemonId)) return false;
    if (q.gmaxOnly && !canGigantamax(entry.pokemonId)) return false;
    return true;
  });

  const valueOf = (entry: PokedexEntry): number | undefined => {
    if (q.sort === 'dex') return entry.pokemonId;
    const stats = statsFor({ pokemonId: entry.pokemonId });
    return q.sort === 'maxCp' ? stats?.maxCp : stats?.atk;
  };
  return [...kept].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (q.sort === 'dex') return a.pokemonId - b.pokemonId;
    if (av === undefined && bv === undefined) return a.pokemonId - b.pokemonId;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return bv - av || a.pokemonId - b.pokemonId;
  });
}

// ——— tiers ———

export type MetaTrack = 'pve' | 'greatLeague' | 'ultraLeague' | 'masterLeague';

/** The four tracks in display order, with the label every surface uses. */
export const META_TRACKS: readonly { key: MetaTrack; label: string; short: string }[] = [
  { key: 'pve', label: 'PvE Raid Attacker', short: 'PvE' },
  { key: 'greatLeague', label: 'Great League (up to 1500 CP)', short: 'GL' },
  { key: 'ultraLeague', label: 'Ultra League (up to 2500 CP)', short: 'UL' },
  { key: 'masterLeague', label: 'Master League', short: 'ML' },
];

/** Best to worst, the order the contract's `MetaTier` is ranked in. */
const TIER_RANK: Record<MetaTier, number> = { 'S+': 0, S: 1, A: 2, B: 3, C: 4 };

export function compareTiers(a: MetaTier, b: MetaTier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

/** The single best tier across the four tracks (the list row's pill), earliest track on a tie (PvE first).
 *  `undefined` when the species has no ranks or none of its tracks carries a tier. */
export function bestTier(ranks: ReturnType<typeof metaRanksOf>): { track: MetaTrack; short: string; tier: MetaTier } | undefined {
  if (!ranks) return undefined;
  let best: { track: MetaTrack; short: string; tier: MetaTier } | undefined;
  for (const { key, short } of META_TRACKS) {
    const tier = ranks[key] as MetaTier | undefined;
    if (tier === undefined) continue;
    if (!best || compareTiers(tier, best.tier) < 0) best = { track: key, short, tier };
  }
  return best;
}

// ——— stat bars ———

export interface StatCeilings {
  atk: number;
  def: number;
  sta: number;
}

let ceilings: StatCeilings | undefined;

/**
 * The highest base ATK / DEF / STA anywhere in the dex (every species' default form and every other form), the
 * scale for the detail sheet's bars: a full bar means "the best in the game", derived from the data so it moves
 * when the generated dex does. Computed once, lazily.
 */
export function statCeilings(): StatCeilings {
  if (ceilings) return ceilings;
  const max: StatCeilings = { atk: 0, def: 0, sta: 0 };
  for (const { pokemonId } of POKEDEX) {
    for (const formCode of [undefined, ...formsOf(pokemonId)]) {
      const stats = statsOf({ pokemonId, formCode });
      if (!stats) continue;
      max.atk = Math.max(max.atk, stats.atk);
      max.def = Math.max(max.def, stats.def);
      max.sta = Math.max(max.sta, stats.sta);
    }
  }
  ceilings = max;
  return max;
}

/** A bar's fill, 0 to 1. A zero ceiling (no stats in the dex yet) gives an empty bar rather than NaN. */
export function barFraction(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return Math.min(1, Math.max(0, value / ceiling));
}
