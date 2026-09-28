/**
 * Unit tests for `lib/format.ts` — `fmtDust`'s Stardust abbreviation and `creatureDisplayName`, the one
 * place the shiny `"Shiny "` display prefix is decided (see that function's header comment).
 */
import { describe, expect, it } from 'vitest';

import { creatureDisplayName, fmtDust } from './format';

describe('fmtDust', () => {
  it('leaves small numbers as-is', () => {
    expect(fmtDust(100)).toBe('100');
  });

  it('abbreviates thousands, dropping a trailing .0', () => {
    expect(fmtDust(1000)).toBe('1K');
    expect(fmtDust(1600)).toBe('1.6K');
  });

  it('abbreviates millions, dropping a trailing .0', () => {
    expect(fmtDust(1_000_000)).toBe('1M');
    expect(fmtDust(1_250_000)).toBe('1.3M');
  });
});

describe('creatureDisplayName', () => {
  it('is just the name when not shiny', () => {
    expect(creatureDisplayName({ name: 'Raboot' })).toBe('Raboot');
    expect(creatureDisplayName({ name: 'Raboot', shiny: false })).toBe('Raboot');
  });

  it('prefixes "Shiny " when shiny is true', () => {
    expect(creatureDisplayName({ name: 'Raboot', shiny: true })).toBe('Shiny Raboot');
  });

  it('treats a null shiny the same as absent — a valid CreatureRef value, not a truthy one', () => {
    expect(creatureDisplayName({ name: 'Raboot', shiny: null })).toBe('Raboot');
  });

  it('accepts a Listing, a FormalOffer, or any other { name, shiny } shaped object alike', () => {
    const listingLike = { id: 'l1', name: 'Zacian', shiny: true, pokemonId: 888 };
    const offerLike = { name: 'Deoxys A.', pokemonId: 386, hue: 220, shiny: true };
    expect(creatureDisplayName(listingLike)).toBe('Shiny Zacian');
    expect(creatureDisplayName(offerLike)).toBe('Shiny Deoxys A.');
  });

  it('never mutates the object it was given', () => {
    const creature = { name: 'Garchomp', shiny: true };
    creatureDisplayName(creature);
    expect(creature).toEqual({ name: 'Garchomp', shiny: true });
  });
});
