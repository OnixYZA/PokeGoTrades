/**
 * Unit tests for the pure tristate filter model in `store/listing-filters.ts`. `matchesFilter` here
 * has a PostgREST twin, `applyFilterSpec` in `lib/api/listings.ts` — every semantic pinned down below
 * (OR within an enum group, a null value surviving an exclude, tags being AND'd, OR across included types)
 * must hold on both. The type filter's twin is proven equal exhaustively in `lib/api/type-filter.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Listing } from '@/data/types';

import { FILTER_ATTRIBUTES, TYPE_CHIP_ORDER } from '../constants/listing-attributes';
import { POKEMON_TYPES } from '../constants/pokedex';
import { compileFilter, cycleFilter, filterKey, matchesFilter, type FilterKey, type FilterState } from './listing-filters';

function makeListing(partial: Partial<Listing> = {}): Listing {
  return {
    id: 'l1',
    name: 'Larvitar',
    hue: 0,
    pokemonId: 246,
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
    ...partial,
  };
}

describe('cycleFilter', () => {
  it('cycles neutral -> include -> exclude -> neutral', () => {
    let state: FilterState = {};
    state = cycleFilter(state, 'shiny');
    expect(state.shiny).toBe('include');
    state = cycleFilter(state, 'shiny');
    expect(state.shiny).toBe('exclude');
    state = cycleFilter(state, 'shiny');
    expect(state.shiny).toBeUndefined();
    expect(state).toEqual({});
  });

  it('does not disturb other chips', () => {
    const state = cycleFilter({ lucky: 'include' }, 'shiny');
    expect(state).toEqual({ lucky: 'include', shiny: 'include' });
  });
});

describe('compileFilter / matchesFilter — flags', () => {
  it('excluding lucky matches only lucky=false, not "absent"', () => {
    const spec = compileFilter({ lucky: 'exclude' });
    expect(spec.flags.lucky).toBe(false);
    expect(matchesFilter(makeListing({ lucky: false }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ lucky: true }), spec)).toBe(false);
  });

  it('including a flag matches only true', () => {
    const spec = compileFilter({ shiny: 'include' });
    expect(matchesFilter(makeListing({ shiny: true }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ shiny: false }), spec)).toBe(false);
  });
});

describe('compileFilter / matchesFilter — enums', () => {
  it('including two values of the same enum column ORs within the group', () => {
    const spec = compileFilter({ 'sizeClass:XXL': 'include', 'sizeClass:XXS': 'include' });
    expect(matchesFilter(makeListing({ sizeClass: 'XXL' }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ sizeClass: 'XXS' }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ sizeClass: 'XS' }), spec)).toBe(false);
    expect(matchesFilter(makeListing({ sizeClass: null }), spec)).toBe(false);
  });

  it('excluding XXL keeps null-size listings (an absent size is not "size XXL")', () => {
    const spec = compileFilter({ 'sizeClass:XXL': 'exclude' });
    expect(matchesFilter(makeListing({ sizeClass: null }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ sizeClass: 'XXS' }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ sizeClass: 'XXL' }), spec)).toBe(false);
  });

  it('applies the same OR/exclude rules to a full-coverage enum (pokeball)', () => {
    const spec = compileFilter({ 'pokeball:premier': 'include' });
    expect(matchesFilter(makeListing({ pokeball: 'premier' }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ pokeball: 'ultra' }), spec)).toBe(false);
    expect(matchesFilter(makeListing({ pokeball: null }), spec)).toBe(false);
  });
});

describe('compileFilter / matchesFilter — tags', () => {
  it('including two tags requires both (AND), unlike an enum group', () => {
    const spec = compileFilter({ 'tag:PvP Ready': 'include', 'tag:Level 1': 'include' });
    expect(matchesFilter(makeListing({ tags: ['PvP Ready', 'Level 1'] }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ tags: ['PvP Ready'] }), spec)).toBe(false);
    expect(matchesFilter(makeListing({ tags: ['Level 1'] }), spec)).toBe(false);
  });

  it('excluding a tag rejects any listing that carries it', () => {
    const spec = compileFilter({ 'tag:Hundo IV': 'exclude' });
    expect(matchesFilter(makeListing({ tags: [] }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ tags: ['Hundo IV'] }), spec)).toBe(false);
  });
});

describe('type chips in the registry', () => {
  const typeChips = FILTER_ATTRIBUTES.filter((attr) => attr.kind === 'type');

  it('has exactly one chip per Pokémon type, keyed type:<Type>, in a "Type" section', () => {
    expect(typeChips).toHaveLength(POKEMON_TYPES.length);
    expect(typeChips.map((attr) => attr.key)).toEqual(TYPE_CHIP_ORDER.map((type) => `type:${type}`));
    expect(new Set(typeChips.map((attr) => attr.section))).toEqual(new Set(['Type']));
    expect(typeChips.map((attr) => attr.label)).toEqual([...TYPE_CHIP_ORDER]);
  });

  it('TYPE_CHIP_ORDER is a permutation of POKEMON_TYPES: every type once, nothing extra', () => {
    expect([...TYPE_CHIP_ORDER].sort()).toEqual([...POKEMON_TYPES].sort());
    expect(new Set(TYPE_CHIP_ORDER).size).toBe(TYPE_CHIP_ORDER.length);
  });

  it('shows the conventional Pokédex type order, not the vocabulary order', () => {
    expect(TYPE_CHIP_ORDER.slice(0, 6)).toEqual(['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice']);
  });

  it('cycles like every other chip', () => {
    let state: FilterState = {};
    state = cycleFilter(state, 'type:Fire');
    expect(state['type:Fire']).toBe('include');
    state = cycleFilter(state, 'type:Fire');
    expect(state['type:Fire']).toBe('exclude');
    expect(cycleFilter(state, 'type:Fire')).toEqual({});
  });
});

describe('compileFilter / matchesFilter — types', () => {
  // Real dex entries (constants/pokedex-data.ts): Charmander #4 Fire, Charizard #6 Fire/Flying,
  // Squirtle #7 Water, Vulpix #37 Fire (Alolan Vulpix Ice), Rotom #479 Electric/Ghost (Heat Rotom Electric/Fire).
  const charmander = makeListing({ pokemonId: 4 });
  const charizard = makeListing({ pokemonId: 6 });
  const squirtle = makeListing({ pokemonId: 7 });

  it('compiles included types to typesAny and excluded ones to typesNone, in registry order', () => {
    const spec = compileFilter({ 'type:Ice': 'exclude', 'type:Water': 'include', 'type:Fire': 'include', 'type:Normal': 'exclude' });
    expect(spec.typesAny).toEqual(['Fire', 'Water']);
    expect(spec.typesNone).toEqual(['Normal', 'Ice']);
  });

  it('including a type matches it in either the primary or the secondary slot', () => {
    expect(matchesFilter(charizard, compileFilter({ 'type:Fire': 'include' }))).toBe(true); // primary
    expect(matchesFilter(charizard, compileFilter({ 'type:Flying': 'include' }))).toBe(true); // secondary
    expect(matchesFilter(charizard, compileFilter({ 'type:Water': 'include' }))).toBe(false);
  });

  it('including several types ORs them: Fire or Water, not both', () => {
    const spec = compileFilter({ 'type:Fire': 'include', 'type:Water': 'include' });
    expect(matchesFilter(charmander, spec)).toBe(true);
    expect(matchesFilter(squirtle, spec)).toBe(true);
    expect(matchesFilter(makeListing({ pokemonId: 25 }), spec)).toBe(false); // Pikachu
  });

  it('excluding a type drops a creature that has it in either slot, and excluding several drops any of them', () => {
    expect(matchesFilter(charizard, compileFilter({ 'type:Flying': 'exclude' }))).toBe(false);
    expect(matchesFilter(charmander, compileFilter({ 'type:Flying': 'exclude' }))).toBe(true);
    const spec = compileFilter({ 'type:Flying': 'exclude', 'type:Water': 'exclude' });
    expect(matchesFilter(charizard, spec)).toBe(false);
    expect(matchesFilter(squirtle, spec)).toBe(false);
    expect(matchesFilter(charmander, spec)).toBe(true);
  });

  it('include and exclude apply together: Fire but not Flying keeps Charmander and drops Charizard', () => {
    const spec = compileFilter({ 'type:Fire': 'include', 'type:Flying': 'exclude' });
    expect(matchesFilter(charmander, spec)).toBe(true);
    expect(matchesFilter(charizard, spec)).toBe(false);
    expect(matchesFilter(squirtle, spec)).toBe(false);
  });

  it('is form-aware: Alolan Vulpix is Ice and not Fire, and a Vulpix with no form code is Fire', () => {
    const vulpix = makeListing({ pokemonId: 37 });
    const alolanVulpix = makeListing({ pokemonId: 37, formCode: 'ALOLA' });
    const fire = compileFilter({ 'type:Fire': 'include' });
    const ice = compileFilter({ 'type:Ice': 'include' });
    expect(matchesFilter(vulpix, fire)).toBe(true);
    expect(matchesFilter(alolanVulpix, fire)).toBe(false);
    expect(matchesFilter(vulpix, ice)).toBe(false);
    expect(matchesFilter(alolanVulpix, ice)).toBe(true);
    expect(matchesFilter(alolanVulpix, compileFilter({ 'type:Fire': 'exclude' }))).toBe(true);
  });

  it('a form that gains a type needs the form: Heat Rotom is Fire, a plain Rotom is not', () => {
    const fire = compileFilter({ 'type:Fire': 'include' });
    expect(matchesFilter(makeListing({ pokemonId: 479, formCode: 'HEAT' }), fire)).toBe(true);
    expect(matchesFilter(makeListing({ pokemonId: 479 }), fire)).toBe(false);
  });

  it('a creature with no known typing never matches an include and is never dropped by an exclude', () => {
    const unknown = makeListing({ pokemonId: 10188, formCode: 'CROWNED_SWORD' }); // not a dex species
    for (const type of POKEMON_TYPES) {
      expect(matchesFilter(unknown, compileFilter({ [`type:${type}`]: 'include' } as FilterState))).toBe(false);
      expect(matchesFilter(unknown, compileFilter({ [`type:${type}`]: 'exclude' } as FilterState))).toBe(true);
    }
  });

  it('ANDs with the other chip families', () => {
    const spec = compileFilter({ 'type:Fire': 'include', shiny: 'include' });
    expect(matchesFilter(makeListing({ pokemonId: 4, shiny: true }), spec)).toBe(true);
    expect(matchesFilter(makeListing({ pokemonId: 4, shiny: false }), spec)).toBe(false);
    expect(matchesFilter(makeListing({ pokemonId: 7, shiny: true }), spec)).toBe(false);
  });
});

describe('compileFilter — empty state', () => {
  it('compiles to an empty spec that matches everything', () => {
    const spec = compileFilter({});
    expect(spec).toEqual({ flags: {}, tagsAll: [], tagsNone: [], enumIn: {}, enumNotIn: {}, typesAny: [], typesNone: [] });
    expect(matchesFilter(makeListing(), spec)).toBe(true);
    expect(matchesFilter(makeListing({ shiny: true, lucky: true, tags: ['Level 1'] }), spec)).toBe(true);
  });
});

describe('filterKey', () => {
  it('is stable regardless of the order chips were toggled in', () => {
    let a: FilterState = {};
    a = cycleFilter(a, 'shiny');
    a = cycleFilter(a, 'lucky');
    a = cycleFilter(a, 'tag:Level 1');

    let b: FilterState = {};
    b = cycleFilter(b, 'tag:Level 1');
    b = cycleFilter(b, 'shiny');
    b = cycleFilter(b, 'lucky');

    expect(filterKey(compileFilter(a))).toBe(filterKey(compileFilter(b)));
  });

  it('is stable regardless of the order type chips were toggled in', () => {
    const toggle = (keys: FilterKey[]) => keys.reduce((state, key) => cycleFilter(state, key), {} as FilterState);
    const a = toggle(['type:Water', 'type:Fire', 'type:Ice']);
    const b = toggle(['type:Ice', 'type:Fire', 'type:Water']);
    expect(filterKey(compileFilter(a))).toBe(filterKey(compileFilter(b)));
  });

  it('tells a type include from a type exclude, and one type from another', () => {
    const keys = [
      filterKey(compileFilter({ 'type:Fire': 'include' })),
      filterKey(compileFilter({ 'type:Fire': 'exclude' })),
      filterKey(compileFilter({ 'type:Water': 'include' })),
      filterKey(compileFilter({ 'type:Fire': 'include', 'type:Water': 'include' })),
      filterKey(compileFilter({})),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('differs when the actual filter differs', () => {
    const a = filterKey(compileFilter({ shiny: 'include' }));
    const b = filterKey(compileFilter({ shiny: 'exclude' }));
    const c = filterKey(compileFilter({}));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
