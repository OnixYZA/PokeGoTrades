/**
 * Unit tests for the pure tristate filter model in `store/listing-filters.ts`. `matchesFilter` here
 * has a PostgREST twin, `applyFilterSpec` in `lib/api/listings.ts` — every semantic pinned down below
 * (OR within an enum group, a null value surviving an exclude, tags being AND'd) must hold on both.
 */
import { describe, expect, it } from 'vitest';
import type { Listing } from '@/data/types';

import { compileFilter, cycleFilter, filterKey, matchesFilter, type FilterState } from './listing-filters';

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

describe('compileFilter — empty state', () => {
  it('compiles to an empty spec that matches everything', () => {
    const spec = compileFilter({});
    expect(spec).toEqual({ flags: {}, tagsAll: [], tagsNone: [], enumIn: {}, enumNotIn: {} });
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

  it('differs when the actual filter differs', () => {
    const a = filterKey(compileFilter({ shiny: 'include' }));
    const b = filterKey(compileFilter({ shiny: 'exclude' }));
    const c = filterKey(compileFilter({}));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
