/**
 * Tests for the type vocabulary and the 1-or-2-distinct-types invariant in `constants/pokemon-types.ts`.
 * The lookups built on top of it (`typesOf`, `typeMembership`) are tested in `pokedex.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { POKEMON_TYPES, formatTypes, isPokemonType, sameTypes, toPokemonTypes } from './pokemon-types';

describe('POKEMON_TYPES', () => {
  it('is the 18 standard types, each once', () => {
    expect(POKEMON_TYPES).toHaveLength(18);
    expect(new Set(POKEMON_TYPES).size).toBe(18);
  });

  it('does not include non-standard types', () => {
    for (const name of ['Stellar', 'Unknown', 'Shadow', 'fire', 'FIRE', '']) expect(isPokemonType(name)).toBe(false);
    for (const type of POKEMON_TYPES) expect(isPokemonType(type)).toBe(true);
  });
});

describe('toPokemonTypes', () => {
  it('accepts one type or two distinct types, keeping order', () => {
    expect(toPokemonTypes(['Fire'])).toEqual(['Fire']);
    expect(toPokemonTypes(['Fire', 'Flying'])).toEqual(['Fire', 'Flying']);
    expect(toPokemonTypes(['Flying', 'Fire'])).toEqual(['Flying', 'Fire']);
  });

  it('rejects zero types', () => {
    expect(() => toPokemonTypes([])).toThrow(/one or two types, got 0/);
  });

  it('rejects three types', () => {
    expect(() => toPokemonTypes(['Fire', 'Flying', 'Water'])).toThrow(/one or two types, got 3/);
  });

  it('rejects a repeated type', () => {
    expect(() => toPokemonTypes(['Fire', 'Fire'])).toThrow(/two different types/);
  });

  it('rejects an unknown or mis-cased type in either slot', () => {
    expect(() => toPokemonTypes(['Stellar'])).toThrow(/Unknown Pokémon type "Stellar"/);
    expect(() => toPokemonTypes(['Fire', 'fire'])).toThrow(/Unknown Pokémon type "fire"/);
  });
});

describe('formatTypes', () => {
  it('formats one or two types', () => {
    expect(formatTypes(['Fire', 'Flying'])).toBe('Fire / Flying');
    expect(formatTypes(['Steel'])).toBe('Steel');
  });
});

describe('sameTypes', () => {
  it('is an ordered comparison', () => {
    expect(sameTypes(['Fire', 'Flying'], ['Fire', 'Flying'])).toBe(true);
    expect(sameTypes(['Fire', 'Flying'], ['Flying', 'Fire'])).toBe(false);
    expect(sameTypes(['Fire'], ['Fire', 'Flying'])).toBe(false);
    expect(sameTypes(['Fire'], ['Fire'])).toBe(true);
  });
});
