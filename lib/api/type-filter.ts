/**
 * The PostgREST half of the feed's TYPE filter, as pure string-building. `lib/api/listings.ts#applyFilterSpec`
 * is the only caller; it lives here, not there, because that file imports the Supabase client (and through
 * it react-native) and so can never be loaded by the vitest suite, and a filter that nothing can run is a
 * filter nothing can prove equal to its mock-feed twin. `lib/api/type-filter.test.ts` runs a small
 * PostgREST evaluator over the strings built here and checks it agrees with `matchesFilter`
 * (store/listing-filters.ts) for every creature in the dex.
 *
 * Relative, value-level imports only (no `@/` alias): vitest's config has no alias plugin, same constraint
 * as `lib/api/creature-ref.ts`. No Supabase / React Native import.
 *
 * WHY THIS IS NOT A COLUMN FILTER. A listing's types are not stored: they are derived from
 * (pokemon_id, form_code), because typing is per form (Alolan Vulpix is Ice, Vulpix is Fire; Heat Rotom
 * gains Fire) and a `types` column would be a denormalised copy that rots every time the dex data changes.
 * `typeMembership` (constants/pokedex.ts) turns "has type X" into three disjoint (species, form) groups, and
 * everything below compiles those groups into PostgREST filters on the two real columns.
 *
 * SEMANTICS (the same ones `matchesFilter` implements; see FILTER SEMANTICS in constants/listing-attributes.ts):
 *   include [A, B]  ->  the row has A OR B
 *   exclude [A, B]  ->  the row has neither A nor B
 *   both            ->  the two applied together (AND)
 *   an id outside the dex has no types: it never matches an include and always survives an exclude.
 *
 * HOW MULTIPLE TYPES COMBINE. The memberships are combined in TypeScript first, per species, so the query
 * carries one compact description instead of one clause per type: the same species is in many types' sets
 * (every dual-type creature), and a species can be partial for one type (Vulpix: Fire except ALOLA) while
 * whole, or complementary, for another (Vulpix and Ice: only ALOLA), which together cover every form. Each
 * species' set of qualifying forms is one of three kinds (every form / every form but some / only some forms,
 * the same three groups `TypeMembership` has) and those kinds are closed under union, complement and
 * intersection, so any combination of includes and excludes is again one membership:
 *   - `unionMembership(types)`           the creatures with at least one of `types`
 *   - `satisfyingMembership(any, none)`  ... and none of `none`
 *
 * TWO RENDERINGS, ONE PER SHAPE OF FILTER.
 *   - an include (with or without excludes) is rendered POSITIVELY: ONE `or=(...)` that selects exactly
 *     `satisfyingMembership(any, none)`. An exclude that is also present has already been subtracted per
 *     species, so it costs no extra clauses; and because an include never matches an id outside the dex, the
 *     positive form is complete without saying anything about unknown ids.
 *   - an exclude with no include must keep every unknown id, so it is rendered as the explicit COMPLEMENT of
 *     `unionMembership(none)`: a conjunction of independent top-level params.
 *
 * WHY THE COMPLEMENT IS WRITTEN OUT AND NOT A NEGATED INCLUDE. PostgREST documents negating a logic tree
 * (`not.or=(...)`), but postgrest-js has no key-level negation (`.not()` writes `column=not.op.value`, i.e.
 * the negation goes on a leaf, never on `or`), and, more importantly, SQL's three-valued logic makes a
 * literal negation WRONG here: for the `onlyForms` clause `and(pokemon_id.eq.479,form_code.in.(HEAT))` a
 * Rotom row with a NULL `form_code` evaluates to NULL, and NOT NULL is NULL, so that row would be dropped by
 * "exclude Fire" even though a plain Rotom is not Fire. Every NULL-sensitive branch is therefore written out
 * explicitly (De Morgan, per species):
 *
 *   has type  (species in allForms)          ->  pokemon_id.in.(...)
 *             complement                     ->  pokemon_id.not.in.(...)
 *   has type  (exceptForms, codes E)         ->  pokemon_id = X AND (form_code IS NULL OR form_code NOT IN E)
 *             complement                     ->  pokemon_id <> X OR  form_code IN E
 *   has type  (onlyForms, codes O)           ->  pokemon_id = X AND  form_code IN O
 *             complement                     ->  pokemon_id <> X OR  form_code IS NULL OR form_code NOT IN O
 *
 * `pokemon_id` is NOT NULL in `listings`, so it never poisons these with an UNKNOWN; `form_code` is nullable
 * and each branch above says what a NULL does. In every complement a row whose id the dex doesn't know takes
 * the `pokemon_id <> X` / `not.in` branch and survives, as `matchesFilter` requires.
 *
 * COMPACTNESS. postgrest-js writes the filter into the URL query string through `URLSearchParams`, which
 * percent-encodes every `(`, `)` and `,` to three bytes, and postgrest-js itself starts warning at 8000
 * characters. A naive `pokemon_id.in.(1,2,...)` over a big union (all 18 types is every one of the ~1025
 * species) would be ~7 KB on its own, so three things keep the URL small:
 *   - species whose form-dependent clause is identical share one clause: `pokemon_id.in.(a,b,c)` with a
 *     single `form_code` condition instead of one clause per species (about 20 Alolan species would
 *     otherwise repeat `form_code.in.(ALOLA)` 20 times); this is the distributive law, so it is exact.
 *   - the whole-species ids are written whichever of three ways is shortest: a plain list, a list plus
 *     `gte`/`lte` ranges for long consecutive runs, or the bounding interval minus its holes (see
 *     "id sets" below). Nothing assumes the dex is contiguous.
 *   - include and exclude are solved together, never emitted as two independent id lists (two lists of
 *     hundreds of ids each would roughly double the URL), so the size depends on how mixed the answer set
 *     is, not on how many chips are pressed.
 * Measured on the current dex: every type selected costs ~50 bytes (the answer is one range or its
 * complement), and the worst of any include/exclude combination is ~5.3 KB of query string, an answer set
 * that is a scattered half of the ~1025 species, which no list encoding can beat. `type-filter.test.ts`
 * measures the real postgrest-js URL for random combinations and pins a ceiling below the 8000 limit.
 */
import { typeMembership, type PokemonType, type TypeMembership } from '../../constants/pokedex';

/** A `TypeMembership` minus its `type`: any union, difference or intersection of types' memberships has the
 *  same three groups and the same row-matching rules as a single type's. */
export type UnionMembership = Omit<TypeMembership, 'type'>;

const POKEMON_ID = 'pokemon_id';
const FORM_CODE = 'form_code';

// ——— the per-species form algebra ———

/** The forms of ONE species that qualify. The `null` form (no form code) is "the species' default form":
 *  it is in `all` and in every `except` set, and never in an `only` set. `except` and `only` sets are never
 *  empty (an empty `except` is `all`; an empty `only` is nothing, which is represented by absence). */
type FormSet =
  | { kind: 'all' }
  | { kind: 'except'; codes: ReadonlySet<string> }
  | { kind: 'only'; codes: ReadonlySet<string> };

/** species id -> qualifying forms; a species that is absent has no qualifying form at all. */
type SpeciesForms = Map<number, FormSet>;

const ALL_FORMS: FormSet = { kind: 'all' };

const exceptFormSet = (codes: ReadonlySet<string>): FormSet => (codes.size === 0 ? ALL_FORMS : { kind: 'except', codes });
const onlyFormSet = (codes: ReadonlySet<string>): FormSet | null => (codes.size === 0 ? null : { kind: 'only', codes });

const difference = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((code) => !b.has(code)));
const intersection = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((code) => b.has(code)));
const union = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a, ...b]);

/** `set` minus `removed`, i.e. `set AND NOT removed` over the forms of one species; null when nothing is left. */
function without(set: FormSet, removed: FormSet): FormSet | null {
  if (removed.kind === 'all') return null;
  if (removed.kind === 'except') {
    // NOT (every form but E) = exactly the forms in E, so only those can be left.
    if (set.kind === 'all') return onlyFormSet(removed.codes);
    if (set.kind === 'except') return onlyFormSet(difference(removed.codes, set.codes));
    return onlyFormSet(intersection(set.codes, removed.codes));
  }
  // NOT (only O) = every form but O, null included.
  if (set.kind === 'all') return exceptFormSet(removed.codes);
  if (set.kind === 'except') return exceptFormSet(union(set.codes, removed.codes));
  return onlyFormSet(difference(set.codes, removed.codes));
}

interface SpeciesAccumulator {
  /** Some membership has every form of this species. */
  all: boolean;
  /** Intersection of the dropped-form sets of every membership that has the species' default typing but
   *  drops some forms; null while none is partial for it. */
  except: Set<string> | null;
  /** Union of the gained-form sets of every membership that only some forms of the species are in. */
  only: Set<string>;
}

/**
 * Union. Per species, each membership contributes one of: every form (`allForms`), every form but some
 * (`exceptForms`; the null form counts as kept), or only some forms (`onlyForms`; null never does). Their
 * union per species is:
 *
 *   - every form, when ANY membership contributes every form;
 *   - otherwise, with D = (intersection of the except sets) minus (union of the only sets): every form but
 *     D, which is every form again when D is empty. (A form is missing from the union only if EVERY partial
 *     membership drops it and NO gaining one adds it. Vulpix Fire + Ice: Fire drops ALOLA, Ice gains ALOLA,
 *     D = {}, so every Vulpix form is Fire or Ice.)
 *   - otherwise (nothing but gaining memberships): only the union of their form sets.
 */
function unionOf(memberships: readonly UnionMembership[]): SpeciesForms {
  const bySpecies = new Map<number, SpeciesAccumulator>();
  const accumulator = (pokemonId: number): SpeciesAccumulator => {
    let entry = bySpecies.get(pokemonId);
    if (!entry) {
      entry = { all: false, except: null, only: new Set() };
      bySpecies.set(pokemonId, entry);
    }
    return entry;
  };

  for (const membership of memberships) {
    for (const pokemonId of membership.allForms) accumulator(pokemonId).all = true;
    for (const { pokemonId, formCodes } of membership.exceptForms) {
      const entry = accumulator(pokemonId);
      const dropped = new Set(formCodes);
      entry.except = entry.except ? intersection(entry.except, dropped) : dropped;
    }
    for (const { pokemonId, formCodes } of membership.onlyForms) {
      const entry = accumulator(pokemonId);
      for (const code of formCodes) entry.only.add(code);
    }
  }

  const forms: SpeciesForms = new Map();
  for (const [pokemonId, { all, except, only }] of bySpecies) {
    // Not `all` and not partial means only gained forms are left (and none at all if a malformed membership
    // listed an empty `onlyForms` group, in which case the species is simply absent).
    const set = all ? ALL_FORMS : except ? exceptFormSet(difference(except, only)) : onlyFormSet(only);
    if (set) forms.set(pokemonId, set);
  }
  return forms;
}

function fromMembership(membership: UnionMembership): SpeciesForms {
  const forms: SpeciesForms = new Map();
  for (const pokemonId of membership.allForms) forms.set(pokemonId, ALL_FORMS);
  for (const { pokemonId, formCodes } of membership.exceptForms) forms.set(pokemonId, exceptFormSet(new Set(formCodes)));
  for (const { pokemonId, formCodes } of membership.onlyForms) {
    const only = onlyFormSet(new Set(formCodes));
    if (only) forms.set(pokemonId, only);
  }
  return forms;
}

/** Species ascending, form codes sorted: the stable, comparable shape tests and the renderers read. */
function toMembership(forms: SpeciesForms): UnionMembership {
  const allForms: number[] = [];
  const exceptEntries: { pokemonId: number; formCodes: string[] }[] = [];
  const onlyEntries: { pokemonId: number; formCodes: string[] }[] = [];
  for (const pokemonId of [...forms.keys()].sort((a, b) => a - b)) {
    const set = forms.get(pokemonId)!;
    if (set.kind === 'all') allForms.push(pokemonId);
    else if (set.kind === 'except') exceptEntries.push({ pokemonId, formCodes: [...set.codes].sort() });
    else onlyEntries.push({ pokemonId, formCodes: [...set.codes].sort() });
  }
  return { allForms, exceptForms: exceptEntries, onlyForms: onlyEntries };
}

/** The creatures in at least one of `memberships`. The data-free core of `unionMembership`, exported so the
 *  tests can run the algebra over small synthetic memberships and prove it exhaustively. */
export function unionOfMemberships(memberships: readonly UnionMembership[]): UnionMembership {
  return toMembership(unionOf(memberships));
}

/** The creatures in `base` that are not in `removed`. The data-free core of `satisfyingMembership`. */
export function subtractMembership(base: UnionMembership, removed: UnionMembership): UnionMembership {
  const removedForms = fromMembership(removed);
  const forms: SpeciesForms = new Map();
  for (const [pokemonId, set] of fromMembership(base)) {
    const gone = removedForms.get(pokemonId);
    const kept = gone ? without(set, gone) : set;
    if (kept) forms.set(pokemonId, kept);
  }
  return toMembership(forms);
}

/** The creatures that have AT LEAST ONE of `types`. For one type this is exactly `typeMembership(type)`. */
export function unionMembership(types: readonly PokemonType[]): UnionMembership {
  return unionOfMemberships([...new Set(types)].map(typeMembership));
}

/**
 * The creatures that have at least one of `any` AND none of `none`: per species, the union of `any`'s forms
 * minus the union of `none`'s forms. Include Flying + exclude Dragon leaves Charizard's Flying forms except
 * the Dragon-typed `MEGA_X`, and drops Dragonite altogether.
 */
export function satisfyingMembership(any: readonly PokemonType[], none: readonly PokemonType[]): UnionMembership {
  return subtractMembership(unionMembership(any), unionMembership(none));
}

// ——— compaction helpers ———

interface IdGroup {
  pokemonIds: number[];
  formCodes: string[];
}

/** Species that share the same set of form codes, in first-appearance (ascending id) order. */
function groupByFormCodes(entries: readonly { pokemonId: number; formCodes: readonly string[] }[]): IdGroup[] {
  const groups = new Map<string, IdGroup>();
  for (const { pokemonId, formCodes } of entries) {
    const key = formCodes.join(',');
    const group = groups.get(key);
    if (group) group.pokemonIds.push(pokemonId);
    else groups.set(key, { pokemonIds: [pokemonId], formCodes: [...formCodes] });
  }
  return [...groups.values()];
}

/** `[1,2,3,7]` -> `[[1,3],[7,7]]`: maximal runs of consecutive ids. `ids` must be ascending and unique. */
function consecutiveRuns(ids: readonly number[]): [first: number, last: number][] {
  const runs: [number, number][] = [];
  for (const id of ids) {
    const last = runs[runs.length - 1];
    if (last && last[1] === id - 1) last[1] = id;
    else runs.push([id, id]);
  }
  return runs;
}

/** Splits ascending ids into the ones to list and the runs worth writing as `gte`/`lte` ranges. A run is a
 *  range only when its range clause is shorter than listing its ids, so isolated ids and short runs stay
 *  in the list. */
function splitRanges(ids: readonly number[]): { listed: number[]; ranges: [number, number][] } {
  const listed: number[] = [];
  const ranges: [number, number][] = [];
  for (const [first, last] of consecutiveRuns(ids)) {
    let listedLength = 0;
    for (let id = first; id <= last; id++) listedLength += String(id).length + 1; // digits + a comma
    const rangeLength = `and(${POKEMON_ID}.gte.${first},${POKEMON_ID}.lte.${last}),`.length;
    if (rangeLength < listedLength) ranges.push([first, last]);
    else for (let id = first; id <= last; id++) listed.push(id);
  }
  return { listed, ranges };
}

/** Every integer between the smallest and largest id that is NOT in `ids` (ascending, non-empty). */
function holesWithin(ids: readonly number[]): number[] {
  const present = new Set(ids);
  const holes: number[] = [];
  for (let id = ids[0]; id <= ids[ids.length - 1]; id++) if (!present.has(id)) holes.push(id);
  return holes;
}

// ——— id sets: the whole-species part, written whichever way is shorter ———
//
// A set of species ids can be written two exact ways, and which is shorter depends on its shape, so both
// are built and the shorter wins (ties go to the direct form):
//   direct      the ids themselves: one `in` list plus a `gte`/`lte` range per long consecutive run.
//   complement  the bounding interval minus its holes: `id >= min AND id <= max AND id NOT IN (holes)`.
//               Nothing outside [min, max] matches, and an integer inside it that is not in the set is by
//               definition a hole, so this is exact even for ids the dex doesn't have.
// The complement is what keeps a DENSE set small. The `in` list of 600 of the 1025 species costs ~4 KB once
// percent-encoded, while listing the other ~400 as holes costs ~2.5 KB, and 'every species' is just a range.

/** `pokemon_id.in.(...)`, or `pokemon_id.eq.X` for a single id. */
function idIn(pokemonIds: readonly number[]): string {
  return pokemonIds.length === 1 ? `${POKEMON_ID}.eq.${pokemonIds[0]}` : `${POKEMON_ID}.in.(${pokemonIds.join(',')})`;
}

/** `pokemon_id.not.in.(...)`, or `pokemon_id.neq.X` for a single id. */
function idNotIn(pokemonIds: readonly number[]): string {
  return pokemonIds.length === 1 ? `${POKEMON_ID}.neq.${pokemonIds[0]}` : `${POKEMON_ID}.not.in.(${pokemonIds.join(',')})`;
}

/** Terms to OR together (inside an include `or`) that select exactly `ids` (ascending, unique). */
function includeIdTerms(ids: readonly number[]): string[] {
  if (ids.length === 0) return [];

  const { listed, ranges } = splitRanges(ids);
  const direct: string[] = [];
  if (listed.length > 0) direct.push(idIn(listed));
  for (const [first, last] of ranges) direct.push(`and(${POKEMON_ID}.gte.${first},${POKEMON_ID}.lte.${last})`);

  const holes = holesWithin(ids);
  const bounded = [`${POKEMON_ID}.gte.${ids[0]}`, `${POKEMON_ID}.lte.${ids[ids.length - 1]}`];
  if (holes.length > 0) bounded.push(idNotIn(holes));
  const complement = [`and(${bounded.join(',')})`];

  return complement.join(',').length < direct.join(',').length ? complement : direct;
}

/** What to AND onto the query so that no row with one of `ids` (ascending, unique) survives. */
function excludeIdClauses(ids: readonly number[]): PostgrestTypeClauses {
  if (ids.length === 0) return { or: [], notInPokemonIds: [] };

  const { listed, ranges } = splitRanges(ids);
  const direct: PostgrestTypeClauses = {
    // A range [a, b] is dropped by `or=(pokemon_id.lt.a,pokemon_id.gt.b)`.
    or: ranges.map(([first, last]) => `${POKEMON_ID}.lt.${first},${POKEMON_ID}.gt.${last}`),
    notInPokemonIds: listed,
  };

  // Survivors of the complement form: below the interval, above it, or one of its holes.
  const holes = holesWithin(ids);
  const survivors = [`${POKEMON_ID}.lt.${ids[0]}`, `${POKEMON_ID}.gt.${ids[ids.length - 1]}`];
  if (holes.length > 0) survivors.push(idIn(holes));
  const complement: PostgrestTypeClauses = { or: [survivors.join(',')], notInPokemonIds: [] };

  const cost = (clauses: PostgrestTypeClauses) => clauses.or.join(',').length + clauses.notInPokemonIds.join(',').length;
  return cost(complement) < cost(direct) ? complement : direct;
}

// ——— include: the row has at least one of the types ———

/** The body of the one `or=(...)` that selects every row belonging to `membership`, or null for an empty one. */
function includeBody(membership: UnionMembership): string | null {
  const terms: string[] = includeIdTerms(membership.allForms);

  // `form_code.is.null` is load-bearing: NOT IN is never true for NULL, so without it a Vulpix listing with
  // no form code would stop being Fire.
  for (const { pokemonIds, formCodes } of groupByFormCodes(membership.exceptForms)) {
    terms.push(`and(${idIn(pokemonIds)},or(${FORM_CODE}.is.null,${FORM_CODE}.not.in.(${formCodes.join(',')})))`);
  }
  // `in` is never true for NULL, which is exactly right here: a gained form needs a real form code.
  for (const { pokemonIds, formCodes } of groupByFormCodes(membership.onlyForms)) {
    terms.push(`and(${idIn(pokemonIds)},${FORM_CODE}.in.(${formCodes.join(',')}))`);
  }

  return terms.length > 0 ? terms.join(',') : null;
}

// ——— exclude: the row has none of the types ———

/** What must be ANDed onto the query so no row belonging to `membership` survives. */
function excludeClauses(membership: UnionMembership): PostgrestTypeClauses {
  // Whole species: pokemon_id <> every id in the set.
  const { or, notInPokemonIds } = excludeIdClauses(membership.allForms);

  // Partial species: a row survives if it is a different species, or this species with a form that lacks
  // the type. Here `form_code.in` being NULL-false is right: a NULL form code has the species' default
  // typing, which has the type, so the row must be dropped.
  for (const { pokemonIds, formCodes } of groupByFormCodes(membership.exceptForms)) {
    or.push(`${idNotIn(pokemonIds)},${FORM_CODE}.in.(${formCodes.join(',')})`);
  }
  // For gained forms the default typing lacks the type, so NULL (and any non-gaining code) survives.
  for (const { pokemonIds, formCodes } of groupByFormCodes(membership.onlyForms)) {
    or.push(`${idNotIn(pokemonIds)},${FORM_CODE}.is.null,${FORM_CODE}.not.in.(${formCodes.join(',')})`);
  }

  return { or, notInPokemonIds };
}

// ——— public API ———

/**
 * What a type filter adds to a PostgREST query. Every entry is a separate top-level query parameter, and
 * PostgREST ANDs all top-level parameters together (with each other and with the feed's other filters).
 */
export interface PostgrestTypeClauses {
  /** Each entry is the body (no outer parentheses) of one top-level `or=(...)` parameter. */
  or: string[];
  /** Species ids for one top-level `pokemon_id=not.in.(...)` parameter; empty means omit it. */
  notInPokemonIds: number[];
}

/** Matches no row whatever its `pokemon_id`: an integer cannot be both below and above zero. Used when an
 *  include is unsatisfiable (e.g. include Fire and exclude Fire), which must yield an empty feed, not an
 *  unconstrained one. A plain `in.()` would say the same, but an empty list is a syntax this has not seen
 *  PostgREST accept; this is built only from operators used everywhere else. */
const MATCHES_NOTHING = `and(${POKEMON_ID}.lt.0,${POKEMON_ID}.gt.0)`;

/**
 * Compiles a spec's `typesAny` / `typesNone` into PostgREST clauses (see the file banner for the design).
 *   - `any` non-empty: ONE `or` that selects exactly the creatures with some type in `any` and none in `none`.
 *   - `any` empty, `none` non-empty: the complement of the creatures with a type in `none`, as independent
 *     params, so ids outside the dex survive.
 *   - both empty: nothing.
 * Pure and deterministic: the output depends only on the SET of types, not the order they are passed in.
 */
export function typeFilterClauses(any: readonly PokemonType[], none: readonly PokemonType[]): PostgrestTypeClauses {
  if (any.length > 0) {
    return { or: [includeBody(satisfyingMembership(any, none)) ?? MATCHES_NOTHING], notInPokemonIds: [] };
  }
  if (none.length > 0) return excludeClauses(unionMembership(none));
  return { or: [], notInPokemonIds: [] };
}

/** The two postgrest-js filter-builder methods `applyTypeFilter` calls; the real builder satisfies this
 *  structurally, and the test hands it a real one to prove the strings survive its serialisation. */
export interface PostgrestTypeFilterTarget {
  or(filters: string): unknown;
  not(column: string, operator: string, value: unknown): unknown;
}

/**
 * Applies the type filter to a postgrest-js query. `.or(body)` writes `or=(body)`, and
 * `.not('pokemon_id', 'in', '(...)')` writes `pokemon_id=not.in.(...)`; both only append to the query's URL
 * search params, so (like every filter method) they mutate the builder in place.
 */
export function applyTypeFilter(
  query: PostgrestTypeFilterTarget,
  any: readonly PokemonType[],
  none: readonly PokemonType[],
): void {
  const clauses = typeFilterClauses(any, none);
  for (const body of clauses.or) query.or(body);
  if (clauses.notInPokemonIds.length > 0) {
    query.not(POKEMON_ID, 'in', `(${clauses.notInPokemonIds.join(',')})`);
  }
}
