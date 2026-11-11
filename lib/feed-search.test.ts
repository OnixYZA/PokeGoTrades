/**
 * Unit tests for `lib/feed-search.ts`: the trending-species derivation (species-level sum, untradable and
 * unknown ids dropped, stable order, cap, curated top-up).
 */
import { describe, expect, it } from 'vitest';

import { marketSignalKey, type MarketSignal } from '../constants/market';
import { isPokemonUntradable } from '../constants/pokedex';
import { TRENDING_FALLBACK_IDS, TRENDING_LIMIT, trendingSpecies } from './feed-search';

const sig = (wanted: number): MarketSignal => ({ wanted, offered: 0, ratio: wanted });

describe('trendingSpecies', () => {
  it('ranks species by wanted count, summing a species\' normal and shiny rows into one entry', () => {
    const signals = new Map([
      [marketSignalKey(25, false), sig(3)],
      [marketSignalKey(25, true), sig(4)],
      [marketSignalKey(150, false), sig(5)],
      [marketSignalKey(6, false), sig(1)],
    ]);
    expect(trendingSpecies(signals, 3)).toEqual([25, 150, 6]);
  });

  it('accepts the mock fixtures\' plain-object shape', () => {
    expect(trendingSpecies({ [marketSignalKey(6, false)]: sig(9) }, 1)).toEqual([6]);
  });

  it('breaks ties by dex number', () => {
    const signals = new Map([
      [marketSignalKey(150, false), sig(2)],
      [marketSignalKey(6, false), sig(2)],
    ]);
    expect(trendingSpecies(signals, 2)).toEqual([6, 150]);
  });

  it('never suggests an untradable or unknown species', () => {
    const untradable = 151; // Mew
    expect(isPokemonUntradable(untradable)).toBe(true);
    const signals = new Map([
      [marketSignalKey(untradable, false), sig(99)],
      [marketSignalKey(999999, false), sig(98)],
      [marketSignalKey(25, false), sig(1)],
    ]);
    const out = trendingSpecies(signals, 2);
    expect(out[0]).toBe(25);
    expect(out).not.toContain(untradable);
    expect(out).not.toContain(999999);
  });

  it('tops up from the curated list when the market has too little, without duplicates', () => {
    const out = trendingSpecies(new Map([[marketSignalKey(TRENDING_FALLBACK_IDS[2], false), sig(5)]]));
    expect(out[0]).toBe(TRENDING_FALLBACK_IDS[2]);
    expect(new Set(out).size).toBe(out.length);
    expect(out).toHaveLength(Math.min(TRENDING_LIMIT, TRENDING_FALLBACK_IDS.length));
  });

  it('falls back to the curated list for an empty market and caps at the limit', () => {
    const out = trendingSpecies(new Map());
    expect(out).toEqual(TRENDING_FALLBACK_IDS.slice(0, TRENDING_LIMIT));
    expect(out.every((id) => !isPokemonUntradable(id))).toBe(true);
  });

  it('ignores rows with nothing wanted', () => {
    expect(trendingSpecies(new Map([[marketSignalKey(25, false), sig(0)]]), 1)).toEqual([TRENDING_FALLBACK_IDS[0]]);
  });
});
