/**
 * Single source of truth for every listing attribute the feed can filter on: the `as const` value
 * lists (which double as the TS types), their display labels, and the `FILTER_ATTRIBUTES` registry
 * that drives both `store/listing-filters.ts` (pure matching / PostgREST compilation) and, later,
 * the filter-chip UI. A migration that adds, removes or renames a `listing_tag` / `pokeball` /
 * `pokemon_size` / `trade_timeline` value only needs to change it here — `lib/api/listings.ts` has a
 * type-level assertion that these arrays stay in lockstep with the generated DB enums.
 *
 * Deliberately no Supabase / React Native import: this is plain data, safe to import from anywhere,
 * including the pure `store/listing-filters.ts` unit tests.
 */

// ——— enums (mirror the DB enums in lib/database.types.ts exactly — see the assertion in lib/api/listings.ts) ———

export const TRADE_TIMELINES = ['asap', 'this_week', 'this_month', 'flexible'] as const;
export type TradeTimeline = (typeof TRADE_TIMELINES)[number];

export const POKEBALLS = ['poke', 'great', 'ultra', 'premier', 'master', 'beast', 'safari'] as const;
export type Pokeball = (typeof POKEBALLS)[number];

export const POKEMON_SIZES = ['XXS', 'XS', 'XL', 'XXL'] as const;
export type PokemonSize = (typeof POKEMON_SIZES)[number];

/** The 5 pre-existing seller-picked tags, plus 'Level 1' (migration …000100_listing_attributes). */
export const LISTING_TAGS = [
  'Legacy Move',
  'Community Day',
  'PvP Ready',
  'Raid Exclusive',
  'Hundo IV',
  'Level 1',
] as const;
export type ListingTag = (typeof LISTING_TAGS)[number];

// ——— display labels ———

export const TRADE_TIMELINE_LABELS: Record<TradeTimeline, string> = {
  asap: 'ASAP',
  this_week: 'This Week',
  this_month: 'This Month',
  flexible: 'Flexible',
};

export const POKEBALL_LABELS: Record<Pokeball, string> = {
  poke: 'Poké Ball',
  great: 'Great Ball',
  ultra: 'Ultra Ball',
  premier: 'Premier Ball',
  master: 'Master Ball',
  beast: 'Beast Ball',
  safari: 'Safari Ball',
};

export const POKEMON_SIZE_LABELS: Record<PokemonSize, string> = {
  XXS: 'XXS',
  XS: 'XS',
  XL: 'XL',
  XXL: 'XXL',
};

// ——— filter registry ———

/** The boolean `listings` columns a filter chip can toggle. Named after the `Listing` field (camelCase);
 *  `lib/api/listings.ts` maps `willTravel` to the DB's `will_travel` for the PostgREST adapter. */
export const FILTER_FLAGS = ['shiny', 'lucky', 'purified', 'costume', 'willTravel'] as const;
export type FilterFlagField = (typeof FILTER_FLAGS)[number];

/** The nullable/enum `Listing` fields a filter chip can narrow to a set of values. */
export const FILTER_ENUM_COLUMNS = ['sizeClass', 'pokeball', 'tradeTimeline'] as const;
export type FilterEnumField = (typeof FILTER_ENUM_COLUMNS)[number];

// Each interface is generic over its own literal ("which flag" / "which enum value" / "which tag") so
// `key` comes out as a literal template type instead of widening to `string` — that is what lets
// `FilterKey` below be a real closed union instead of an easily-mistyped bare `string`.
interface FlagFilterAttribute<C extends FilterFlagField = FilterFlagField> {
  key: C;
  label: string;
  section: string;
  kind: 'flag';
  column: C;
}

interface TagFilterAttribute<T extends ListingTag = ListingTag> {
  key: `tag:${T}`;
  label: string;
  section: string;
  kind: 'tag';
  tag: T;
}

interface EnumFilterAttribute<C extends FilterEnumField = FilterEnumField, V extends string = string> {
  key: `${C}:${V}`;
  label: string;
  section: string;
  kind: 'enum';
  column: C;
  value: V;
}

export type FilterAttribute = FlagFilterAttribute | TagFilterAttribute | EnumFilterAttribute;

function flagAttribute<C extends FilterFlagField>(column: C, label: string): FlagFilterAttribute<C> {
  return { key: column, label, section: 'Attributes', kind: 'flag', column };
}

function enumAttribute<C extends FilterEnumField, V extends string>(
  column: C,
  value: V,
  label: string,
  section: string,
): EnumFilterAttribute<C, V> {
  return { key: `${column}:${value}`, label, section, kind: 'enum', column, value };
}

function tagAttribute<T extends ListingTag>(tag: T): TagFilterAttribute<T> {
  return { key: `tag:${tag}`, label: tag, section: 'Tags', kind: 'tag', tag };
}

/**
 * Every filter chip the feed can show, in display order. `size_class` deliberately only surfaces its
 * two extremes (XXS, XXL) — the mid sizes are not interesting to filter on — while `pokeball` and
 * `trade_timeline` surface every value. No Shadow entry exists anywhere in this file: Shadow Pokémon
 * are untradable and must never appear as a listing attribute or filter (AGENTS.md).
 */
export const FILTER_ATTRIBUTES = [
  flagAttribute('shiny', 'Shiny'),
  flagAttribute('lucky', 'Lucky'),
  flagAttribute('purified', 'Purified'),
  flagAttribute('costume', 'Costume'),
  flagAttribute('willTravel', 'Will Travel'),

  enumAttribute('sizeClass', 'XXS', 'XXS', 'Size'),
  enumAttribute('sizeClass', 'XXL', 'XXL', 'Size'),

  ...POKEBALLS.map((ball) => enumAttribute('pokeball', ball, POKEBALL_LABELS[ball], 'Poké Ball')),

  ...TRADE_TIMELINES.map((timeline) => enumAttribute('tradeTimeline', timeline, TRADE_TIMELINE_LABELS[timeline], 'Timeline')),

  ...LISTING_TAGS.map(tagAttribute),
] as const satisfies readonly FilterAttribute[];

export type FilterKey = (typeof FILTER_ATTRIBUTES)[number]['key'];
