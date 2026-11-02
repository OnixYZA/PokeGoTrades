/**
 * Unit tests for `lib/dex-explorer.ts`: filter/search/sort composition, tier ranking, and the stat-bar scale.
 * The stat sorts inject a fake lookup so they do not depend on the generated stats; the ceiling test runs on the
 * real dex.
 */
import { describe, expect, it } from 'vitest';

import { canGigantamax, formsOf, isPokemonUntradable, POKEDEX, statsOf, typesOf } from '../constants/pokedex';
import { barFraction, bestTier, compareTiers, DEFAULT_DEX_QUERY, exploreDex, statCeilings, type DexQuery } from './dex-explorer';

const q = (over: Partial<DexQuery>): DexQuery => ({ ...DEFAULT_DEX_QUERY, ...over });
const ids = (list: { pokemonId: number }[]) => list.map((e) => e.pokemonId);

describe('exploreDex', () => {
  it('lists the whole dex by number when nothing is set', () => {
    const all = ids(exploreDex(DEFAULT_DEX_QUERY));
    expect(all.length).toBe(POKEDEX.length);
    expect(all).toEqual([...all].sort((a, b) => a - b));
  });

  it('narrows by name, dex number and type through searchPokedex', () => {
    expect(ids(exploreDex(q({ query: 'charizard' })))).toContain(6);
    expect(ids(exploreDex(q({ query: '25' })))).toContain(25);
    expect(exploreDex(q({ query: 'zzzzqqq' }))).toEqual([]);
  });

  it('type chip keeps only species with that default-form type', () => {
    const fire = exploreDex(q({ type: 'Fire' }));
    expect(fire.length).toBeGreaterThan(0);
    for (const e of fire) expect(typesOf({ pokemonId: e.pokemonId })).toContain('Fire');
  });

  it('tradable only drops untradable species; G-Max keeps only Gigantamax species', () => {
    const tradable = exploreDex(q({ tradableOnly: true }));
    expect(tradable.some((e) => isPokemonUntradable(e.pokemonId))).toBe(false);
    expect(exploreDex(DEFAULT_DEX_QUERY).some((e) => isPokemonUntradable(e.pokemonId))).toBe(true);
    const gmax = exploreDex(q({ gmaxOnly: true }));
    expect(gmax.length).toBeGreaterThan(0);
    expect(gmax.every((e) => canGigantamax(e.pokemonId))).toBe(true);
  });

  it('combines filters with AND', () => {
    const list = exploreDex(q({ type: 'Fire', gmaxOnly: true, tradableOnly: true }));
    for (const e of list) {
      expect(typesOf({ pokemonId: e.pokemonId })).toContain('Fire');
      expect(canGigantamax(e.pokemonId)).toBe(true);
      expect(isPokemonUntradable(e.pokemonId)).toBe(false);
    }
  });

  it('stat sorts are descending, tie-break by dex, and put species without stats last', () => {
    const fake = (({ pokemonId }: { pokemonId: number }) =>
      pokemonId === 1 ? undefined : pokemonId === 2 ? { atk: 10, def: 1, sta: 1, maxCp: 100 } : { atk: 10, def: 1, sta: 1, maxCp: 500 }) as typeof statsOf;
    const list = ids(exploreDex(q({ query: 'saur', sort: 'maxCp' }), fake));
    expect(list.slice(0, 2)).toEqual([3, 2]); // 500 before 100
    expect(list[list.length - 1]).toBe(1); // no stats last
    const byAtk = ids(exploreDex(q({ query: 'saur', sort: 'attack' }), fake));
    expect(byAtk.slice(0, 2)).toEqual([2, 3]); // tie on 10 -> dex order
    expect(byAtk[byAtk.length - 1]).toBe(1);
  });
});

describe('bestTier', () => {
  it('picks the best tier, earliest track on a tie', () => {
    const ranks = { pve: 'A', greatLeague: 'S', ultraLeague: 'S', masterLeague: 'C' } as unknown as Parameters<typeof bestTier>[0];
    expect(bestTier(ranks)).toMatchObject({ track: 'greatLeague', tier: 'S' });
  });
  it('is undefined without ranks', () => {
    expect(bestTier(undefined)).toBeUndefined();
  });
  it('ranks S+ above S above A above B above C', () => {
    const order = ['S+', 'S', 'A', 'B', 'C'] as const;
    for (let i = 0; i < order.length - 1; i++) expect(compareTiers(order[i], order[i + 1])).toBeLessThan(0);
  });
});

describe('stat bars', () => {
  it('ceilings are the data maxima, so no species/form exceeds a full bar', () => {
    const c = statCeilings();
    for (const { pokemonId } of POKEDEX) {
      for (const formCode of [undefined, ...formsOf(pokemonId)]) {
        const s = statsOf({ pokemonId, formCode });
        if (!s) continue;
        expect(s.atk).toBeLessThanOrEqual(c.atk);
        expect(s.def).toBeLessThanOrEqual(c.def);
        expect(s.sta).toBeLessThanOrEqual(c.sta);
      }
    }
  });
  it('barFraction clamps and survives a zero ceiling', () => {
    expect(barFraction(50, 100)).toBe(0.5);
    expect(barFraction(500, 100)).toBe(1);
    expect(barFraction(-5, 100)).toBe(0);
    expect(barFraction(5, 0)).toBe(0);
  });
});
