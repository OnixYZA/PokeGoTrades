/**
 * Pure tristate feed filters: no Supabase, no React Native. `store/trade-store.tsx` owns the
 * `FilterState`; `lib/use-feed.ts` compiles it once per render and, with the mock data source,
 * matches it locally with `matchesFilter`; with Supabase, `lib/api/listings.ts#applyFilterSpec`
 * compiles the same `FilterSpec` into a PostgREST query. Those two — `matchesFilter` here and
 * `applyFilterSpec` there — implement the same filter semantics on two different engines and MUST be
 * kept in sync; a change to one without the other means the mock feed and the live feed disagree
 * about what a chip means.
 */
// Relative import, not the `@/` alias: this keeps the module resolvable from `vitest.config.ts`'s
// minimal config (no bundler-alias plugin — see its own comment), same as every other value this
// pure test suite needs to import for real, rather than as an erased `import type`.
import {
  FILTER_ATTRIBUTES,
  type FilterEnumField,
  type FilterFlagField,
  type FilterKey,
  type ListingTag,
} from '../constants/listing-attributes';
import type { Listing } from '@/data/types';

// Re-exported: everywhere else in the app that needs a filter key (the store, the future filter-chip
// UI) reaches it through this module rather than reaching past it into the constants registry.
export type { FilterKey };

/** Neutral (absent), included, or excluded — one entry per filter chip. Cycling order:
 *  neutral -> include -> exclude -> neutral. */
export type FilterMode = 'include' | 'exclude';
export type FilterState = Partial<Record<FilterKey, FilterMode>>;

/** The compiled, engine-agnostic shape of a `FilterState` — what `matchesFilter` and
 *  `applyFilterSpec` both read. */
export interface FilterSpec {
  /** column -> required value. An excluded flag compiles to `false`, not "absent". */
  flags: Partial<Record<FilterFlagField, boolean>>;
  /** Every tag here must be present (AND) — `.contains('tags', tagsAll)` on the PostgREST side. */
  tagsAll: ListingTag[];
  /** No tag here may be present — `.not('tags', 'ov', ...)` on the PostgREST side. */
  tagsNone: ListingTag[];
  /** column -> the set of values that satisfy an *included* chip for that column (OR within the
   *  column: including both XXS and XXL matches either). */
  enumIn: Partial<Record<FilterEnumField, string[]>>;
  /** column -> values an *excluded* chip rules out. A NULL column value always still matches — an
   *  absent size is not "size XXL", so excluding XXL must not hide it. */
  enumNotIn: Partial<Record<FilterEnumField, string[]>>;
}

const CYCLE_NEXT: Record<'none' | FilterMode, FilterMode | 'none'> = {
  none: 'include',
  include: 'exclude',
  exclude: 'none',
};

/** Advances one chip: neutral -> include -> exclude -> neutral. Returns a new state (immutable). */
export function cycleFilter(state: FilterState, key: FilterKey): FilterState {
  const current = state[key] ?? 'none';
  const next = CYCLE_NEXT[current];
  const { [key]: _dropped, ...rest } = state;
  return next === 'none' ? rest : { ...rest, [key]: next };
}

function emptySpec(): FilterSpec {
  return { flags: {}, tagsAll: [], tagsNone: [], enumIn: {}, enumNotIn: {} };
}

/**
 * Turns the sparse, chip-keyed `FilterState` into the grouped `FilterSpec` both engines match
 * against. Always iterates `FILTER_ATTRIBUTES` (fixed registry order) rather than `Object.keys(state)`,
 * so the result — and therefore `filterKey` — never depends on the order the chips were toggled in.
 */
export function compileFilter(state: FilterState): FilterSpec {
  const spec = emptySpec();
  for (const attr of FILTER_ATTRIBUTES) {
    const mode = state[attr.key];
    if (!mode) continue;
    if (attr.kind === 'flag') {
      spec.flags[attr.column] = mode === 'include';
    } else if (attr.kind === 'tag') {
      (mode === 'include' ? spec.tagsAll : spec.tagsNone).push(attr.tag);
    } else {
      const bucket = mode === 'include' ? spec.enumIn : spec.enumNotIn;
      (bucket[attr.column] ??= []).push(attr.value);
    }
  }
  return spec;
}

/**
 * The mock-feed twin of `applyFilterSpec` (lib/api/listings.ts) — same semantics, no network. Keep
 * the two in sync (see the file banner).
 */
export function matchesFilter(listing: Listing, spec: FilterSpec): boolean {
  for (const column of Object.keys(spec.flags) as FilterFlagField[]) {
    if (listing[column] !== spec.flags[column]) return false;
  }

  for (const tag of spec.tagsAll) if (!listing.tags.includes(tag)) return false;
  for (const tag of spec.tagsNone) if (listing.tags.includes(tag)) return false;

  for (const column of Object.keys(spec.enumIn) as FilterEnumField[]) {
    const value = listing[column];
    if (value === null || !spec.enumIn[column]!.includes(value)) return false;
  }

  for (const column of Object.keys(spec.enumNotIn) as FilterEnumField[]) {
    const value = listing[column];
    // A null column value (no size recorded yet, etc.) is never "excluded" by any specific value.
    if (value !== null && spec.enumNotIn[column]!.includes(value)) return false;
  }

  return true;
}

/**
 * A stable string for a compiled spec — used as a memo key and as the race-guard key in
 * `lib/use-feed.ts` (the same role `loc` already plays there). Sorted at every level so two states
 * that toggled the same chips in a different order compile to the identical key; `compileFilter`'s
 * fixed iteration order already guarantees this, but sorting here costs nothing and does not rely on
 * that being true forever.
 */
export function filterKey(spec: FilterSpec): string {
  const flags = Object.keys(spec.flags)
    .sort()
    .map((column) => `${column}=${spec.flags[column as FilterFlagField]}`);
  const enumIn = Object.keys(spec.enumIn)
    .sort()
    .map((column) => `${column}:in:${[...spec.enumIn[column as FilterEnumField]!].sort().join(',')}`);
  const enumNotIn = Object.keys(spec.enumNotIn)
    .sort()
    .map((column) => `${column}:notin:${[...spec.enumNotIn[column as FilterEnumField]!].sort().join(',')}`);
  return JSON.stringify([flags, [...spec.tagsAll].sort(), [...spec.tagsNone].sort(), enumIn, enumNotIn]);
}
