/**
 * Base stats, max CP and stat-based meta tiers, built from `POKEDEX_STATS` / `FORM_STAT_OVERRIDES`
 * (constants/pokedex-data.ts, generated from the pinned PokeMiners game master). Re-exported by
 * constants/pokedex.ts; app code imports from there.
 *
 * A LEAF over the generated data on purpose (no import of constants/pokedex.ts, which re-exports this module):
 * `MetaCreature` is structurally the same shape as `TypedCreature`.
 *
 * NOTHING HERE IS GAME DATA TYPED FROM MEMORY (AGENTS.md). The only literals are formula constants (the level-50
 * CPM, the league CP caps, the bucket sizes), each documented where it is declared. Every per-species number is
 * read from the generated tables.
 *
 * STATS ARE PER (pokemonId, formCode), like typing: the form's own stats when `FORM_STAT_OVERRIDES` lists it,
 * else the species default (the form `formCode: null` means). Mega and Primal are not stored forms and have no
 * stats here.
 *
 * TIERS ARE ESTIMATES. They are computed from base stats alone, never from movesets, so they cannot say who is
 * good in the live meta (Shadow Mewtwo's fast move, Registeel's typing coverage). `META_TIER_DISCLAIMER` is the
 * copy a screen must show beside them.
 */
import { FORM_STAT_OVERRIDES, POKEDEX_STATS } from './pokedex-data';

export interface MetaCreature {
  pokemonId: number;
  /** PokeMiners form code, exact spelling. Absent/null = the species' default form. */
  formCode?: string | null;
}

export interface BaseStatLine {
  atk: number;
  def: number;
  sta: number;
}

export interface CreatureStats extends BaseStatLine {
  /** CP at level 50 with 15/15/15 IVs; see `maxCpOf`. */
  maxCp: number;
}

/**
 * Combat Power multiplier of level 50 in Pokémon GO (the game's level-50 CPM, 0.84029999). It is the one place
 * the constant lives: `maxCpOf` and the league scores below both read it. Level 50 is the highest level a
 * Pokémon can reach (40 plus best-buddy and XL candy levels).
 */
export const LEVEL_50_CPM = 0.84029999;

/** IV every stat is assumed to have in `maxCpOf` and in the league scores (15, the maximum). */
const MAX_IV = 15;

/**
 * CP of a species/form at level 50 with 15/15/15 IVs: the standard GO formula
 * `floor((atk+15) * sqrt(def+15) * sqrt(sta+15) * CPM^2 / 10)`, floored at 10 (the game's minimum CP).
 */
export function maxCpOf({ atk, def, sta }: BaseStatLine): number {
  return Math.max(10, Math.floor(((atk + MAX_IV) * Math.sqrt(def + MAX_IV) * Math.sqrt(sta + MAX_IV) * LEVEL_50_CPM ** 2) / 10));
}

const withMaxCp = (line: BaseStatLine): CreatureStats => ({ ...line, maxCp: maxCpOf(line) });

const key = (pokemonId: number, formCode: string) => `${pokemonId}:${formCode}`;

/** Species id -> default-form stats; a species the game master has no stats for (#902) is absent. */
const DEFAULT_STATS = new Map<number, CreatureStats>(POKEDEX_STATS.map(([id, atk, def, sta]) => [id, withMaxCp({ atk, def, sta })]));
const FORM_STATS = new Map<string, CreatureStats>(FORM_STAT_OVERRIDES.map(([id, code, atk, def, sta]) => [key(id, code), withMaxCp({ atk, def, sta })]));

/**
 * Base stats and max CP of this creature: the form's own when `FORM_STAT_OVERRIDES` lists
 * `(pokemonId, formCode)`, otherwise the species default (so a null form, and a form that does not change
 * stats, resolve to the species). `undefined` for an unknown id AND for a species with no stats in the data
 * (#902 Basculegion); it never guesses. `formCode` is case-sensitive; an unrecognised one falls back to the
 * species default, like `typesOf`.
 */
export function statsOf(creature: MetaCreature): CreatureStats | undefined {
  const base = DEFAULT_STATS.get(creature.pokemonId);
  if (!base) return undefined;
  return (creature.formCode ? FORM_STATS.get(key(creature.pokemonId, creature.formCode)) : undefined) ?? base;
}

// ——— meta tiers ———

export type MetaTier = 'S+' | 'S' | 'A' | 'B' | 'C';

export interface MetaRanks {
  pve: MetaTier;
  greatLeague: MetaTier;
  ultraLeague: MetaTier;
  masterLeague: MetaTier;
}

export const META_TIER_DISCLAIMER = 'Estimated from Pokémon GO base stats only, not from movesets or the live meta.';

/** Highest CP a Great League / Ultra League PvP team member may have. */
export const GREAT_LEAGUE_CP_CAP = 1500;
export const ULTRA_LEAGUE_CP_CAP = 2500;

/**
 * PvE score: `atk^1.6 * (def * sta)^0.35` on BASE stats (no IVs: the question is which species is better, not
 * which individual). Attack dominates raid damage output; def*sta is a weaker survivability term. The
 * exponents are a heuristic weighting, not a simulation; they only need to be monotone in all three stats.
 */
export const pveScore = ({ atk, def, sta }: BaseStatLine): number => atk ** 1.6 * (def * sta) ** 0.35;

/** Master League score: `atk * def * sta` on base stats. With no CP cap, level 50 and 15/15/15 are best for
 *  everyone, so the stat product is the whole story. */
export const masterLeagueScore = ({ atk, def, sta }: BaseStatLine): number => atk * def * sta;

/**
 * CP-capped stat product, the Great/Ultra League score. Documented APPROXIMATION of "the best stat product at
 * or under the cap": with 15/15/15 IVs, scale the level multiplier continuously to the largest value whose CP is
 * still <= `cap` (capped at the level-50 CPM), and return `(atk+15)m * (def+15)m * (sta+15)m`. It ignores
 * level quantisation (half levels), IV trade-offs (the real rank 1 often runs low attack) and stamina flooring,
 * so it is a bulk ranking, not a rank-1 spec. A species whose max CP is well below the cap is
 * penalised for free: its multiplier is pinned at the level-50 CPM, so its product stays small, instead of
 * being scaled up past what it can reach.
 */
export function cappedStatProduct({ atk, def, sta }: BaseStatLine, cap: number): number {
  const a = atk + MAX_IV;
  const d = def + MAX_IV;
  const s = sta + MAX_IV;
  // CP = a * sqrt(d*s) * m^2 / 10  =>  the multiplier that lands exactly on the cap.
  const mAtCap = Math.sqrt((cap * 10) / (a * Math.sqrt(d * s)));
  const m = Math.min(LEVEL_50_CPM, mAtCap);
  return a * d * s * m ** 3;
}

type Score = (line: BaseStatLine) => number;
const METRICS: { [K in keyof MetaRanks]: Score } = {
  pve: pveScore,
  greatLeague: (line) => cappedStatProduct(line, GREAT_LEAGUE_CP_CAP),
  ultraLeague: (line) => cappedStatProduct(line, ULTRA_LEAGUE_CP_CAP),
  masterLeague: masterLeagueScore,
};

/**
 * PERCENTILE buckets: the share of the population scoring strictly higher decides the tier. Top 5% is S+, the
 * next 10% S, the next 20% A, the next 30% B, the remaining 35% C (cumulative cut-offs 5/15/35/65%). Tied scores
 * share a tier, so a strictly better stat line can never land in a lower tier.
 */
export const META_TIER_BUCKETS: readonly { tier: MetaTier; upTo: number }[] = [
  { tier: 'S+', upTo: 0.05 },
  { tier: 'S', upTo: 0.15 },
  { tier: 'A', upTo: 0.35 },
  { tier: 'B', upTo: 0.65 },
  { tier: 'C', upTo: 1 },
];

/** The population every percentile is measured against: each species' DEFAULT form (one entry per species, so
 *  the distribution is stable and form overrides never shift anyone else's tier). Built once at module load. */
const POPULATION: readonly BaseStatLine[] = POKEDEX_STATS.map(([, atk, def, sta]) => ({ atk, def, sta }));

/** Per metric, the population's scores sorted ascending, for a binary search of "how many score higher". */
const SORTED_SCORES = Object.fromEntries(
  (Object.keys(METRICS) as (keyof MetaRanks)[]).map((metric) => [metric, POPULATION.map(METRICS[metric]).sort((x, y) => x - y)]),
) as Record<keyof MetaRanks, number[]>;

function tierOf(metric: keyof MetaRanks, score: number): MetaTier {
  const sorted = SORTED_SCORES[metric];
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= score) lo = mid + 1;
    else hi = mid;
  }
  const share = (sorted.length - lo) / sorted.length; // fraction of the population strictly above
  return META_TIER_BUCKETS.find((bucket) => share < bucket.upTo)?.tier ?? 'C';
}

/**
 * Stat-based tier of this creature in each mode, `undefined` exactly when `statsOf` is. A form (Origin Giratina)
 * is scored with its own stats against the species-default population. See `META_TIER_DISCLAIMER`.
 */
export function metaRanksOf(creature: MetaCreature): MetaRanks | undefined {
  const stats = statsOf(creature);
  if (!stats) return undefined;
  return {
    pve: tierOf('pve', METRICS.pve(stats)),
    greatLeague: tierOf('greatLeague', METRICS.greatLeague(stats)),
    ultraLeague: tierOf('ultraLeague', METRICS.ultraLeague(stats)),
    masterLeague: tierOf('masterLeague', METRICS.masterLeague(stats)),
  };
}
