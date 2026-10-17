/**
 * Unit tests for `lib/api/type-filter.ts`, the PostgREST compiler of the feed's type filter.
 *
 * The point of this file is the PARITY test. The feed has two filter engines, `matchesFilter` (the mock
 * data source, plain TypeScript over `creatureHasType`) and PostgREST (the live data source), and nobody
 * can run a live PostgREST from a unit test. So this file carries a small evaluator for the PostgREST
 * filter grammar the compiler emits (`and`, `or`, `not.`, and the leaves `eq neq lt lte gt gte in is`), with
 * SQL's three-valued logic (NULL makes every comparison UNKNOWN, a WHERE keeps only TRUE), runs it over the
 * query string a REAL postgrest-js builder produces, and asserts it agrees with `matchesFilter` for every
 * creature in the dex. What it cannot prove is that a live PostgREST accepts the syntax; see the report.
 *
 * Relative imports for every value (vitest has no `@/` alias); `@/data/types` is type-only.
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { creatureHasType, POKEDEX, POKEMON_TYPES, typeMembership, type PokemonType } from '../../constants/pokedex';
import { FORM_TYPE_OVERRIDES } from '../../constants/pokedex-data';
import { compileFilter, matchesFilter, type FilterKey, type FilterState } from '../../store/listing-filters';
import type { Listing } from '@/data/types';

import {
  applyTypeFilter,
  satisfyingMembership,
  subtractMembership,
  typeFilterClauses,
  unionMembership,
  unionOfMemberships,
  type UnionMembership,
} from './type-filter';

// ——— a mini PostgREST evaluator ———

interface Row {
  pokemon_id: number;
  form_code: string | null;
}

/** SQL's three truth values: null is UNKNOWN. */
type Tri = boolean | null;
type Node = (row: Row) => Tri;

const not = (value: Tri): Tri => (value === null ? null : !value);

function and(nodes: Node[]): Node {
  return (row) => {
    let unknown = false;
    for (const node of nodes) {
      const value = node(row);
      if (value === false) return false;
      if (value === null) unknown = true;
    }
    return unknown ? null : true;
  };
}

function or(nodes: Node[]): Node {
  return (row) => {
    let unknown = false;
    for (const node of nodes) {
      const value = node(row);
      if (value === true) return true;
      if (value === null) unknown = true;
    }
    return unknown ? null : false;
  };
}

/** Splits at commas that are not inside parentheses: PostgREST's own logic-tree tokenisation. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth < 0) throw new Error(`Unbalanced ")" in ${text}`);
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error(`Unbalanced "(" in ${text}`);
  parts.push(text.slice(start));
  return parts;
}

const COMPARE = {
  eq: (a: number | string, b: number | string) => a === b,
  neq: (a: number | string, b: number | string) => a !== b,
  lt: (a: number | string, b: number | string) => a < b,
  lte: (a: number | string, b: number | string) => a <= b,
  gt: (a: number | string, b: number | string) => a > b,
  gte: (a: number | string, b: number | string) => a >= b,
};

const LEAF = /^(pokemon_id|form_code)\.(not\.)?(eq|neq|lt|lte|gt|gte|in|is)\.(.+)$/;

function parseLeaf(text: string): Node {
  const match = LEAF.exec(text);
  if (!match) throw new Error(`Unsupported PostgREST filter: ${text}`);
  const column = match[1] as keyof Row;
  const negated = match[2] !== undefined;
  const op = match[3];
  const raw = match[4];

  const parse = (value: string): number | string => {
    if (column === 'form_code') return value;
    if (!/^-?\d+$/.test(value)) throw new Error(`Non-integer id "${value}" in ${text}`);
    return Number(value);
  };

  let test: (value: number | string) => boolean;
  if (op === 'is') {
    if (raw !== 'null') throw new Error(`Only is.null is supported, got ${text}`);
    // IS NULL is the one comparison that is never UNKNOWN.
    return (row) => (negated ? row[column] !== null : row[column] === null);
  } else if (op === 'in') {
    if (!raw.startsWith('(') || !raw.endsWith(')')) throw new Error(`in needs a parenthesised list: ${text}`);
    const list = splitTopLevel(raw.slice(1, -1));
    if (list.some((item) => item === '')) throw new Error(`Empty item in ${text}`);
    const values = new Set(list.map(parse));
    test = (value) => values.has(value);
  } else {
    const arg = parse(raw);
    if (typeof arg === 'string' && op !== 'eq' && op !== 'neq') throw new Error(`Ordering a string: ${text}`);
    const compare = COMPARE[op as keyof typeof COMPARE];
    test = (value) => compare(value, arg);
  }

  return (row) => {
    const value = row[column];
    if (value === null) return null; // every comparison against NULL is UNKNOWN, `not.` included
    const result = test(value);
    return negated ? !result : result;
  };
}

const LOGIC = /^(not\.)?(and|or)\((.*)\)$/s;

function parseNode(text: string): Node {
  const logic = LOGIC.exec(text);
  if (!logic) return parseLeaf(text);
  const children = splitTopLevel(logic[3]).map(parseNode);
  const node = logic[2] === 'and' ? and(children) : or(children);
  return logic[1] ? (row) => not(node(row)) : node;
}

/** One top-level query parameter, as it arrives decoded: `or` -> `(a,b)`, `pokemon_id` -> `not.in.(1,2)`. */
function parseParam(key: string, value: string): Node {
  if (/^(not\.)?(and|or)$/.test(key)) return parseNode(`${key}${value}`);
  return parseLeaf(`${key}.${value}`);
}

/** A WHERE clause: every top-level parameter is ANDed, and only TRUE keeps a row. */
function compileParams(params: [key: string, value: string][]): (row: Row) => boolean {
  const node = and(params.map(([key, value]) => parseParam(key, value)));
  return (row) => node(row) === true;
}

// ——— evaluator self-checks (an evaluator nobody checked proves nothing) ———

describe('the mini PostgREST evaluator', () => {
  const where = (...params: [string, string][]) => compileParams(params);
  const row = (pokemon_id: number, form_code: string | null = null): Row => ({ pokemon_id, form_code });

  it('treats NULL as UNKNOWN: `not.in` and `in` both reject a NULL form_code', () => {
    expect(where(['form_code', 'not.in.(ALOLA)'])(row(37))).toBe(false);
    expect(where(['form_code', 'in.(ALOLA)'])(row(37))).toBe(false);
    expect(where(['form_code', 'not.in.(ALOLA)'])(row(37, 'HEAT'))).toBe(true);
    expect(where(['form_code', 'is.null'])(row(37))).toBe(true);
  });

  it('lets an explicit is.null branch rescue a NULL inside an or', () => {
    const keepsNull = where(['or', '(form_code.is.null,form_code.not.in.(ALOLA))']);
    expect(keepsNull(row(37))).toBe(true);
    expect(keepsNull(row(37, 'ALOLA'))).toBe(false);
    expect(keepsNull(row(37, 'GALARIAN'))).toBe(true);
  });

  it('implements and / or / not. and the comparison leaves', () => {
    expect(where(['or', '(pokemon_id.eq.1,and(pokemon_id.gte.5,pokemon_id.lte.7))'])(row(6))).toBe(true);
    expect(where(['or', '(pokemon_id.eq.1,and(pokemon_id.gte.5,pokemon_id.lte.7))'])(row(8))).toBe(false);
    expect(where(['pokemon_id', 'not.in.(1,2,3)'])(row(2))).toBe(false);
    expect(where(['pokemon_id', 'not.in.(1,2,3)'])(row(4))).toBe(true);
    expect(where(['or', '(pokemon_id.lt.3,pokemon_id.gt.9)'])(row(5))).toBe(false);
    expect(where(['pokemon_id', 'neq.5'])(row(5))).toBe(false);
  });

  it('rejects syntax it was not built for, so an unsupported emission fails loudly', () => {
    expect(() => where(['or', '(pokemon_id.like.5)'])).toThrow();
    expect(() => where(['or', '(pokemon_id.in.())'])).toThrow();
    expect(() => where(['or', '(pokemon_id.eq.5'])).toThrow();
    expect(() => where(['or', '(name.eq.5)'])).toThrow();
    expect(() => where(['select', '*'])).toThrow();
  });

  it('shows why a literal negation of an include is wrong: NOT UNKNOWN is UNKNOWN', () => {
    // "Heat Rotom is Fire": and(pokemon_id.eq.479,form_code.in.(HEAT)). For a plain Rotom (NULL form_code) that
    // is UNKNOWN, so negating it ("exclude Fire") would drop a Rotom that is NOT Fire. That is why exclusion
    // is compiled as an explicit complement.
    const negated = where(['not.and', '(pokemon_id.eq.479,form_code.in.(HEAT))']);
    expect(negated(row(479))).toBe(false); // a plain Rotom is wrongly dropped
    const complement = compileParams(typeFilterClausesAsParams([], ['Fire']));
    expect(complement(row(479))).toBe(true); // the compiled exclude keeps it
    expect(complement(row(479, 'HEAT'))).toBe(false);
  });
});

// ——— building the query the way the app does ———

const client = createClient('http://127.0.0.1:54321', 'anon-key-for-unit-tests', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** A real postgrest-js builder with the type filter applied, and the URL it would actually request. */
function builtUrl(any: readonly PokemonType[], none: readonly PokemonType[]): URL {
  const query = client.from('listings').select('id');
  applyTypeFilter(query, any, none);
  return (query as unknown as { url: URL }).url;
}

/** The type-filter parameters of a real builder's URL, percent-decoded the way PostgREST reads them. */
function paramsOf(url: URL): [string, string][] {
  return [...url.searchParams.entries()].filter(([key]) => key !== 'select');
}

function typeFilterClausesAsParams(any: readonly PokemonType[], none: readonly PokemonType[]): [string, string][] {
  return paramsOf(builtUrl(any, none));
}

// ——— the creatures to compare on ———

const formCodesBySpecies = new Map<number, string[]>();
for (const [pokemonId, formCode] of FORM_TYPE_OVERRIDES) {
  formCodesBySpecies.set(pokemonId, [...(formCodesBySpecies.get(pokemonId) ?? []), formCode]);
}

/**
 * Every creature the type filter can be asked about: for every dex species its default (no form code), every
 * form code that changes its typing, and a form code the dex has never heard of; plus ids outside the dex
 * (with and without a form code, including a real species' real form code on an unknown id).
 */
const CREATURES: Row[] = (() => {
  const rows: Row[] = [];
  for (const { pokemonId } of POKEDEX) {
    rows.push({ pokemon_id: pokemonId, form_code: null });
    rows.push({ pokemon_id: pokemonId, form_code: 'NOT_A_REAL_FORM' });
    for (const formCode of formCodesBySpecies.get(pokemonId) ?? []) rows.push({ pokemon_id: pokemonId, form_code: formCode });
  }
  const unknownIds = [0, -1, 1026, 5000, 10188, 99999];
  for (const pokemon_id of unknownIds) {
    for (const form_code of [null, 'ALOLA', 'CROWNED_SWORD', 'HEAT', 'NOT_A_REAL_FORM']) rows.push({ pokemon_id, form_code });
  }
  return rows;
})();

function listingOf(row: Row): Listing {
  return {
    id: 'l1',
    name: 'Test',
    hue: 0,
    pokemonId: row.pokemon_id,
    ...(row.form_code ? { formCode: row.form_code } : {}),
    form: 'Normal',
    year: 2026,
    lucky: false,
    shiny: false,
    accent: '#7c3aed',
    bg: 'meta',
    seller: 'Ash',
    loc: 'Pallet Town',
    pvp: 'Great League',
    tradeType: 'Standard / Registered',
    iv: '100%',
    looking: [],
    tags: [],
    purified: false,
    costume: false,
    pokeball: null,
    sizeClass: null,
    willTravel: false,
    tradeTimeline: 'flexible',
  };
}

const chip = (type: PokemonType): FilterKey => `type:${type}`;

function stateOf(any: readonly PokemonType[], none: readonly PokemonType[]): FilterState {
  const state: FilterState = {};
  for (const type of any) state[chip(type)] = 'include';
  for (const type of none) state[chip(type)] = 'exclude';
  return state;
}

/**
 * Compares the two engines for one filter over every creature. `matchesFilter` gets the compiled spec of the
 * chip state, exactly as the mock feed would; PostgREST gets the parameters of a real postgrest-js builder
 * built from that same spec, exactly as the live feed would. Returns the first few disagreements.
 */
function disagreements(any: readonly PokemonType[], none: readonly PokemonType[]): string[] {
  const spec = compileFilter(stateOf(any, none));
  const where = compileParams(paramsOf(builtUrl(spec.typesAny, spec.typesNone)));
  const found: string[] = [];
  for (const row of CREATURES) {
    const mock = matchesFilter(listingOf(row), spec);
    const live = where(row);
    if (mock !== live) {
      found.push(`include [${any}] exclude [${none}] #${row.pokemon_id} ${row.form_code}: mock ${mock}, postgrest ${live}`);
      if (found.length >= 5) break;
    }
  }
  return found;
}

/** Deterministic pseudo-random subsets of the 18 types (a tiny LCG, so a failure reproduces exactly). */
function randomSubsets(count: number, seed: number): PokemonType[][] {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: count }, () => POKEMON_TYPES.filter(() => next() < 0.4));
}

// ——— parity ———

describe('PostgREST type filter agrees with matchesFilter on every creature in the dex', () => {
  it('covers a meaningful universe: every species, its forms, unknown form codes and unknown ids', () => {
    expect(CREATURES.length).toBeGreaterThan(POKEDEX.length * 2);
    expect(CREATURES.some((row) => row.pokemon_id === 37 && row.form_code === 'ALOLA')).toBe(true);
    expect(CREATURES.some((row) => row.pokemon_id === 479 && row.form_code === null)).toBe(true);
    expect(CREATURES.some((row) => row.pokemon_id === 10188 && row.form_code === 'CROWNED_SWORD')).toBe(true);
  });

  it.each(POKEMON_TYPES)('include %s alone', (type) => {
    expect(disagreements([type], [])).toEqual([]);
  });

  it.each(POKEMON_TYPES)('exclude %s alone', (type) => {
    expect(disagreements([], [type])).toEqual([]);
  });

  it('include every PAIR of types (OR across types)', () => {
    for (let i = 0; i < POKEMON_TYPES.length; i++) {
      for (let j = i + 1; j < POKEMON_TYPES.length; j++) {
        expect(disagreements([POKEMON_TYPES[i], POKEMON_TYPES[j]], [])).toEqual([]);
      }
    }
  });

  it('exclude every PAIR of types (the creature has neither)', () => {
    for (let i = 0; i < POKEMON_TYPES.length; i++) {
      for (let j = i + 1; j < POKEMON_TYPES.length; j++) {
        expect(disagreements([], [POKEMON_TYPES[i], POKEMON_TYPES[j]])).toEqual([]);
      }
    }
  });

  it('include one type and exclude another, for every ordered pair (AND)', () => {
    for (const included of POKEMON_TYPES) {
      for (const excluded of POKEMON_TYPES) {
        if (included === excluded) continue;
        expect(disagreements([included], [excluded])).toEqual([]);
      }
    }
  });

  it('include and exclude several types at once, over random disjoint splits', () => {
    for (const subset of randomSubsets(40, 7)) {
      const rest = POKEMON_TYPES.filter((type) => !subset.includes(type));
      const half = Math.ceil(rest.length / 2);
      expect(disagreements(subset, rest.slice(0, half))).toEqual([]);
      expect(disagreements(rest.slice(half), subset)).toEqual([]);
    }
  });

  it('big and odd unions: random subsets on either side, all 18, and everything but one', () => {
    for (const subset of randomSubsets(40, 99)) {
      expect(disagreements(subset, [])).toEqual([]);
      expect(disagreements([], subset)).toEqual([]);
    }
    expect(disagreements([...POKEMON_TYPES], [])).toEqual([]);
    expect(disagreements([], [...POKEMON_TYPES])).toEqual([]);
    for (const type of POKEMON_TYPES) {
      const others = POKEMON_TYPES.filter((other) => other !== type);
      expect(disagreements(others, [])).toEqual([]);
      expect(disagreements([], others)).toEqual([]);
      expect(disagreements([type], others)).toEqual([]);
      expect(disagreements(others, [type])).toEqual([]);
    }
  });

  it('an unsatisfiable filter (include and exclude the same type) matches nothing, on both engines', () => {
    for (const type of POKEMON_TYPES) {
      expect(disagreements([type], [type])).toEqual([]);
      const spec = compileFilter({ [chip(type)]: 'include' });
      spec.typesNone.push(type);
      expect(CREATURES.some((row) => matchesFilter(listingOf(row), spec))).toBe(false);
      const where = compileParams(paramsOf(builtUrl([type], [type])));
      expect(CREATURES.some((row) => where(row))).toBe(false);
    }
  });

  it('is independent of the order the types are passed in', () => {
    for (const subset of randomSubsets(10, 3)) {
      const reversed = [...subset].reverse();
      expect(typeFilterClauses(reversed, [])).toEqual(typeFilterClauses(subset, []));
      expect(typeFilterClauses([], reversed)).toEqual(typeFilterClauses([], subset));
    }
  });
});

describe('spot checks of the semantics, on both engines', () => {
  function bothEngines(any: readonly PokemonType[], none: readonly PokemonType[], row: Row): [mock: boolean, live: boolean] {
    const spec = compileFilter(stateOf(any, none));
    const where = compileParams(paramsOf(builtUrl(any, none)));
    return [matchesFilter(listingOf(row), spec), where(row)];
  }
  const charizard: Row = { pokemon_id: 6, form_code: null };

  it('has-type looks at both slots: Flying finds Charizard, whose Flying is its secondary type', () => {
    expect(bothEngines(['Flying'], [], charizard)).toEqual([true, true]);
    expect(bothEngines(['Fire'], [], charizard)).toEqual([true, true]);
    expect(bothEngines(['Water'], [], charizard)).toEqual([false, false]);
  });

  it('several included types are OR: Water or Fire shows Charizard (Fire) and not a Grass/Poison Bulbasaur', () => {
    expect(bothEngines(['Water', 'Fire'], [], charizard)).toEqual([true, true]);
    expect(bothEngines(['Water', 'Fire'], [], { pokemon_id: 1, form_code: null })).toEqual([false, false]);
  });

  it('exclude drops a creature that has the type in EITHER slot', () => {
    expect(bothEngines([], ['Flying'], charizard)).toEqual([false, false]);
    expect(bothEngines([], ['Flying'], { pokemon_id: 4, form_code: null })).toEqual([true, true]); // Charmander
  });

  it('include and exclude apply together: Fire but not Flying keeps Charmander and drops Charizard', () => {
    expect(bothEngines(['Fire'], ['Flying'], { pokemon_id: 4, form_code: null })).toEqual([true, true]);
    expect(bothEngines(['Fire'], ['Flying'], charizard)).toEqual([false, false]);
  });

  it('is form-aware, both ways, and keeps NULL form codes right: Vulpix / Alolan Vulpix', () => {
    expect(bothEngines(['Fire'], [], { pokemon_id: 37, form_code: null })).toEqual([true, true]);
    expect(bothEngines(['Fire'], [], { pokemon_id: 37, form_code: 'ALOLA' })).toEqual([false, false]);
    expect(bothEngines(['Ice'], [], { pokemon_id: 37, form_code: null })).toEqual([false, false]);
    expect(bothEngines(['Ice'], [], { pokemon_id: 37, form_code: 'ALOLA' })).toEqual([true, true]);
    expect(bothEngines([], ['Fire'], { pokemon_id: 37, form_code: null })).toEqual([false, false]);
    expect(bothEngines([], ['Fire'], { pokemon_id: 37, form_code: 'ALOLA' })).toEqual([true, true]);
  });

  it('a gained type needs the form, and a NULL form code never gains it: Rotom / Heat Rotom', () => {
    expect(bothEngines(['Fire'], [], { pokemon_id: 479, form_code: null })).toEqual([false, false]);
    expect(bothEngines(['Fire'], [], { pokemon_id: 479, form_code: 'HEAT' })).toEqual([true, true]);
    expect(bothEngines([], ['Fire'], { pokemon_id: 479, form_code: null })).toEqual([true, true]); // NULL survives
    expect(bothEngines([], ['Fire'], { pokemon_id: 479, form_code: 'HEAT' })).toEqual([false, false]);
  });

  it('a creature with no known typing never matches an include and is never dropped by an exclude', () => {
    const synthetic: Row = { pokemon_id: 10188, form_code: 'CROWNED_SWORD' };
    for (const type of POKEMON_TYPES) {
      expect(bothEngines([type], [], synthetic)).toEqual([false, false]);
      expect(bothEngines([], [type], synthetic)).toEqual([true, true]);
    }
    expect(bothEngines([], [...POKEMON_TYPES], synthetic)).toEqual([true, true]);
    expect(bothEngines([...POKEMON_TYPES], [], synthetic)).toEqual([false, false]);
  });
});

// ——— the algebra underneath ———

/** A membership in the same canonical shape `unionMembership` returns (ascending, sorted codes). */
function canonical(m: UnionMembership | ReturnType<typeof typeMembership>): UnionMembership {
  const byId = <T extends { pokemonId: number }>(a: T, b: T) => a.pokemonId - b.pokemonId;
  return {
    allForms: [...m.allForms].sort((a, b) => a - b),
    exceptForms: m.exceptForms.map((e) => ({ pokemonId: e.pokemonId, formCodes: [...e.formCodes].sort() })).sort(byId),
    onlyForms: m.onlyForms.map((e) => ({ pokemonId: e.pokemonId, formCodes: [...e.formCodes].sort() })).sort(byId),
  };
}

function hasMembership(m: UnionMembership, row: Row): boolean {
  if (m.allForms.includes(row.pokemon_id)) return true;
  const except = m.exceptForms.find((e) => e.pokemonId === row.pokemon_id);
  if (except) return row.form_code === null || !except.formCodes.includes(row.form_code);
  const only = m.onlyForms.find((e) => e.pokemonId === row.pokemon_id);
  return only !== undefined && row.form_code !== null && only.formCodes.includes(row.form_code);
}

describe('unionMembership / satisfyingMembership', () => {
  it('the union of one type is exactly typeMembership(type)', () => {
    for (const type of POKEMON_TYPES) expect(unionMembership([type])).toEqual(canonical(typeMembership(type)));
  });

  it('is the creatures with any of the types, for the whole universe (random unions)', () => {
    for (const subset of randomSubsets(25, 11)) {
      const membership = unionMembership(subset);
      for (const row of CREATURES) {
        const expected = subset.some((type) => creatureHasType({ pokemonId: row.pokemon_id, formCode: row.form_code }, type));
        if (hasMembership(membership, row) !== expected) throw new Error(`union [${subset}] #${row.pokemon_id} ${row.form_code}`);
      }
    }
  });

  it('satisfyingMembership is "some of `any` and none of `none`", for the whole universe', () => {
    for (const subset of randomSubsets(25, 21)) {
      const none = POKEMON_TYPES.filter((type) => !subset.includes(type)).slice(0, 5);
      const membership = satisfyingMembership(subset, none);
      for (const row of CREATURES) {
        const creature = { pokemonId: row.pokemon_id, formCode: row.form_code };
        const expected = subset.some((t) => creatureHasType(creature, t)) && !none.some((t) => creatureHasType(creature, t));
        if (hasMembership(membership, row) !== expected) throw new Error(`[${subset}] minus [${none}] #${row.pokemon_id} ${row.form_code}`);
      }
    }
  });

  it('keeps the groups disjoint, ascending and duplicate-free', () => {
    for (const subset of randomSubsets(25, 5)) {
      const none = POKEMON_TYPES.filter((type) => !subset.includes(type)).slice(0, 3);
      for (const m of [unionMembership(subset), satisfyingMembership(subset, none)]) {
        const ids = [...m.allForms, ...m.exceptForms.map((e) => e.pokemonId), ...m.onlyForms.map((e) => e.pokemonId)];
        expect(new Set(ids).size).toBe(ids.length);
        expect(m.allForms).toEqual([...m.allForms].sort((a, b) => a - b));
        for (const group of [...m.exceptForms, ...m.onlyForms]) expect(group.formCodes.length).toBeGreaterThan(0);
      }
    }
  });

  it('a species partial for one type and whole for another is whole in the union', () => {
    // Find a real species that is in `exceptForms` for one type and `allForms` for another, so this test
    // can never pass vacuously if the data changes.
    let found: { pokemonId: number; partial: PokemonType; whole: PokemonType } | undefined;
    for (const partial of POKEMON_TYPES) {
      for (const whole of POKEMON_TYPES) {
        const species = typeMembership(partial).exceptForms.find((e) => typeMembership(whole).allForms.includes(e.pokemonId));
        if (species && !found) found = { pokemonId: species.pokemonId, partial, whole };
      }
    }
    expect(found).toBeDefined();
    const { pokemonId, partial, whole } = found!;
    const union = unionMembership([partial, whole]);
    expect(union.allForms).toContain(pokemonId);
    expect(union.exceptForms.some((e) => e.pokemonId === pokemonId)).toBe(false);
    // ... and it is emitted once, as a plain id, never as a form-dependent clause.
    expect(typeFilterClauses([partial, whole], []).or.join(',')).not.toMatch(new RegExp(`pokemon_id\\.eq\\.${pokemonId}\\b`));
  });

  it('a type that drops a form and a type that gains it together cover every form: Vulpix is Fire or Ice', () => {
    const union = unionMembership(['Fire', 'Ice']);
    expect(union.allForms).toContain(37);
    expect(union.exceptForms.some((e) => e.pokemonId === 37)).toBe(false);
  });

  it('subtracting a type removes exactly the forms that have it', () => {
    // Heat Rotom is Electric/Fire. Include Fire, exclude Electric: Heat Rotom is gone entirely.
    const gone = satisfyingMembership(['Fire'], ['Electric']);
    expect(gone.onlyForms.some((e) => e.pokemonId === 479)).toBe(false);
    expect(gone.allForms).toContain(4); // Charmander is Fire only
    // Include Flying, exclude Dragon: Charizard stays Flying in every form but MEGA_X (Fire/Dragon).
    const flying = satisfyingMembership(['Flying'], ['Dragon']);
    expect(flying.exceptForms).toContainEqual({ pokemonId: 6, formCodes: ['MEGA_X'] });
    expect(flying.allForms).not.toContain(149); // Dragonite is Dragon/Flying
  });
});

/**
 * The algebra on synthetic data, exhaustively. Real data can't reach every case (e.g. two types that are both
 * partial for one species with DIFFERENT dropped forms may not occur in the dex at all), so this builds every
 * kind of per-species form set over three form codes and checks union and subtraction against a brute-force
 * reading of the three-group rules, for every pair, and every triple for the union.
 */
describe('the form algebra, on every synthetic membership of one species', () => {
  const CODES = ['A', 'B', 'C'];
  const ROWS: (string | null)[] = [null, ...CODES, 'UNKNOWN_FORM'];

  const subsets = (): string[][] => {
    const result: string[][] = [];
    for (let mask = 1; mask < 1 << CODES.length; mask++) result.push(CODES.filter((_, i) => mask & (1 << i)));
    return result;
  };

  /** Every distinct kind of set: nothing, every form, every form but S, only S (S non-empty). */
  const STATES: UnionMembership[] = [
    { allForms: [], exceptForms: [], onlyForms: [] },
    { allForms: [1], exceptForms: [], onlyForms: [] },
    ...subsets().map((formCodes): UnionMembership => ({ allForms: [], exceptForms: [{ pokemonId: 1, formCodes }], onlyForms: [] })),
    ...subsets().map((formCodes): UnionMembership => ({ allForms: [], exceptForms: [], onlyForms: [{ pokemonId: 1, formCodes }] })),
  ];

  const has = (m: UnionMembership, formCode: string | null) => hasMembership(m, { pokemon_id: 1, form_code: formCode });

  const wellFormed = (m: UnionMembership) => {
    const entries = [...m.exceptForms, ...m.onlyForms];
    expect(entries.length + m.allForms.length).toBeLessThanOrEqual(1); // one species
    for (const entry of entries) expect(entry.formCodes.length).toBeGreaterThan(0);
  };

  it('has the 16 distinct states the argument rests on', () => {
    expect(STATES).toHaveLength(2 + 7 + 7);
  });

  it('union of any two or three memberships holds for exactly the forms any of them holds for', () => {
    for (const a of STATES) {
      for (const b of STATES) {
        const ab = unionOfMemberships([a, b]);
        wellFormed(ab);
        for (const row of ROWS) expect(has(ab, row), `${JSON.stringify([a, b])} form ${row}`).toBe(has(a, row) || has(b, row));
        for (const c of STATES) {
          const abc = unionOfMemberships([a, b, c]);
          wellFormed(abc);
          for (const row of ROWS) {
            expect(has(abc, row), `${JSON.stringify([a, b, c])} form ${row}`).toBe(has(a, row) || has(b, row) || has(c, row));
          }
        }
      }
    }
  });

  it('subtraction holds for exactly the forms in the first and not in the second', () => {
    for (const base of STATES) {
      for (const removed of STATES) {
        const difference = subtractMembership(base, removed);
        wellFormed(difference);
        for (const row of ROWS) {
          expect(has(difference, row), `${JSON.stringify([base, removed])} form ${row}`).toBe(has(base, row) && !has(removed, row));
        }
      }
    }
  });

  it('leaves species the other side never mentions alone, and ignores species it has no use for', () => {
    const base: UnionMembership = { allForms: [1, 3], exceptForms: [{ pokemonId: 2, formCodes: ['A'] }], onlyForms: [] };
    const removed: UnionMembership = { allForms: [3], exceptForms: [], onlyForms: [{ pokemonId: 9, formCodes: ['B'] }] };
    expect(subtractMembership(base, removed)).toEqual({
      allForms: [1],
      exceptForms: [{ pokemonId: 2, formCodes: ['A'] }],
      onlyForms: [],
    });
  });
});

// ——— the emitted strings ———

describe('typeFilterClauses', () => {
  it('adds nothing for an empty filter', () => {
    expect(typeFilterClauses([], [])).toEqual({ or: [], notInPokemonIds: [] });
    expect(paramsOf(builtUrl([], []))).toEqual([]);
  });

  it('an include is exactly ONE or=(...), however many types, and never a not.in param', () => {
    for (const types of [['Fire'], ['Fire', 'Water'], [...POKEMON_TYPES]] as PokemonType[][]) {
      const clauses = typeFilterClauses(types, []);
      expect(clauses.or).toHaveLength(1);
      expect(clauses.notInPokemonIds).toEqual([]);
    }
  });

  it('an include with an exclude is still ONE or=(...) (the exclusion is folded in per species)', () => {
    const clauses = typeFilterClauses(['Fire', 'Water'], ['Flying', 'Ice', 'Dark']);
    expect(clauses.or).toHaveLength(1);
    expect(clauses.notInPokemonIds).toEqual([]);
  });

  it('never emits a form code that needs PostgREST quoting', () => {
    for (const type of POKEMON_TYPES) {
      const m = typeMembership(type);
      for (const group of [...m.exceptForms, ...m.onlyForms]) {
        for (const code of group.formCodes) expect(code, `${type} #${group.pokemonId}`).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });

  it('only ever writes the grammar the evaluator implements, with balanced parentheses', () => {
    for (const subset of [...randomSubsets(15, 1), [...POKEMON_TYPES]]) {
      const rest = POKEMON_TYPES.filter((type) => !subset.includes(type));
      for (const clauses of [typeFilterClauses(subset, []), typeFilterClauses([], subset), typeFilterClauses(subset, rest)]) {
        for (const body of clauses.or) expect(() => compileParams([['or', `(${body})`]])).not.toThrow();
        if (clauses.notInPokemonIds.length > 0) {
          expect(() => compileParams([['pokemon_id', `not.in.(${clauses.notInPokemonIds.join(',')})`]])).not.toThrow();
        }
        expect(JSON.stringify(clauses)).not.toMatch(/undefined|NaN|null,null/);
      }
    }
  });

  it('every type has creatures, so an include of any single type is never the empty set', () => {
    for (const type of POKEMON_TYPES) {
      const clauses = typeFilterClauses([type], []);
      expect(clauses.or[0]).not.toBe('and(pokemon_id.lt.0,pokemon_id.gt.0)');
    }
  });
});

describe('through postgrest-js', () => {
  it('writes the include as one `or=(...)` query parameter, byte for byte what the compiler built', () => {
    const clauses = typeFilterClauses(['Fire', 'Ice'], []);
    const url = builtUrl(['Fire', 'Ice'], []);
    expect(url.searchParams.getAll('or')).toEqual(clauses.or.map((body) => `(${body})`));
    expect(paramsOf(url).map(([key]) => key)).toEqual(['or']);
  });

  it('writes an exclude as top-level or=(...) params plus a pokemon_id=not.in.(...) leaf', () => {
    const clauses = typeFilterClauses([], ['Fire']);
    const url = builtUrl([], ['Fire']);
    expect(url.searchParams.getAll('or')).toEqual(clauses.or.map((body) => `(${body})`));
    expect(url.searchParams.getAll('pokemon_id')).toEqual(
      clauses.notInPokemonIds.length > 0 ? [`not.in.(${clauses.notInPokemonIds.join(',')})`] : [],
    );
  });

  it('survives the URL round trip: what the server decodes is what was built', () => {
    for (const [any, none] of [
      [['Fire', 'Ice'], ['Flying']],
      [[], ['Water', 'Grass', 'Dark']],
      [[...POKEMON_TYPES], []],
    ] as [PokemonType[], PokemonType[]][]) {
      const url = builtUrl(any, none);
      const reparsed = new URL(url.toString());
      expect(paramsOf(reparsed)).toEqual(paramsOf(url));
    }
  });
});

// ——— URL length ———

/** postgrest-js starts warning when the URL exceeds this many characters (its `urlLengthLimit` default). */
const POSTGREST_JS_URL_LIMIT = 8000;
/** The feed's own query (`select=<LISTING_COLUMNS>&status=in.(...)&loc=eq.…&order=…` and the other chips)
 *  is about 500-700 characters once encoded; keep this much of the budget free for it. */
const REST_OF_FEED_QUERY = 1000;
/** What the type filter alone may cost. The worst case measured over the whole space of include/exclude
 *  combinations (hill-climbing over all 3^18 chip states, and every one of the 2^18 single-sided ones) is about
 *  5.3 KB, so this leaves ~13% headroom: a few dozen new species do not trip it, while a regression to
 *  uncompressed `in.(...)` lists (~7 KB for a big union, ~11 KB for a mixed include/exclude) does. */
const TYPE_FILTER_BUDGET = POSTGREST_JS_URL_LIMIT - REST_OF_FEED_QUERY - 1000;

/** Encoded length of just the type filter's parameters in the final URL. */
function encodedLength(any: readonly PokemonType[], none: readonly PokemonType[]): number {
  const base = client.from('listings').select('id');
  const baseLength = (base as unknown as { url: URL }).url.toString().length;
  return builtUrl(any, none).toString().length - baseLength;
}

describe('URL length', () => {
  it('stays tiny when a filter covers every species: all 18 included, all 18 excluded', () => {
    expect(encodedLength([...POKEMON_TYPES], [])).toBeLessThan(500);
    expect(encodedLength([], [...POKEMON_TYPES])).toBeLessThan(500);
  });

  it('stays inside the budget for single-sided filters of every shape (seeded random subsets)', () => {
    let worst = 0;
    for (const subset of randomSubsets(300, 12345)) {
      worst = Math.max(worst, encodedLength(subset, []), encodedLength([], subset));
    }
    expect(worst).toBeLessThan(TYPE_FILTER_BUDGET);
  });

  it('stays inside the budget when include and exclude are both heavily used (seeded random splits)', () => {
    let worst = 0;
    for (const subset of randomSubsets(300, 777)) {
      const rest = POKEMON_TYPES.filter((type) => !subset.includes(type));
      worst = Math.max(worst, encodedLength(subset, rest), encodedLength(rest, subset));
    }
    expect(worst).toBeLessThan(TYPE_FILTER_BUDGET);
  });
});
