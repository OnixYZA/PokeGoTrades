/**
 * Unit tests for `lib/api/creature-ref.ts` — the one shared parse/serialize pair for the app's
 * `CreatureRef` jsonb shape (`listings.looking`, `trainer_creatures.creature`, `chat_messages.offer`,
 * `my_trade_history`'s `gave`/`got`). Covers round-tripping through `creatureRefToJson` ->
 * `parseCreatureRef`, rejecting malformed input, and the omit-vs-null rules for `formCode`/`costumeCode`
 * (the DB's `creature_ref_is_valid` rejects an explicit JSON `null` for either key).
 */
import { describe, expect, it } from 'vitest';

import type { CreatureRef } from '@/data/types';

import { creatureRefToJson, parseCreatureRef, parseCreatureRefs } from './creature-ref';

describe('parseCreatureRef', () => {
  it('parses a minimal valid ref, omitting every optional field', () => {
    expect(parseCreatureRef({ name: 'Bulbasaur', pokemonId: 1, hue: 120 })).toEqual({
      name: 'Bulbasaur',
      pokemonId: 1,
      hue: 120,
    });
  });

  it('keeps shiny/lucky only when they are literally true, not any other truthy value', () => {
    expect(parseCreatureRef({ name: 'X', pokemonId: 1, hue: 1, shiny: true, lucky: true })).toEqual({
      name: 'X',
      pokemonId: 1,
      hue: 1,
      shiny: true,
      lucky: true,
    });
    expect(parseCreatureRef({ name: 'X', pokemonId: 1, hue: 1, shiny: 'yes', lucky: 1 })).toEqual({
      name: 'X',
      pokemonId: 1,
      hue: 1,
    });
    expect(parseCreatureRef({ name: 'X', pokemonId: 1, hue: 1, shiny: false, lucky: false })).toEqual({
      name: 'X',
      pokemonId: 1,
      hue: 1,
    });
  });

  it('keeps formCode/costumeCode only when they are non-empty strings', () => {
    expect(
      parseCreatureRef({ name: 'Deoxys', pokemonId: 386, hue: 220, formCode: 'ATTACK', costumeCode: 'X' }),
    ).toEqual({ name: 'Deoxys', pokemonId: 386, hue: 220, formCode: 'ATTACK', costumeCode: 'X' });

    expect(parseCreatureRef({ name: 'X', pokemonId: 1, hue: 1, formCode: '', costumeCode: null })).toEqual({
      name: 'X',
      pokemonId: 1,
      hue: 1,
    });

    expect(parseCreatureRef({ name: 'X', pokemonId: 1, hue: 1, formCode: 42 })).toEqual({
      name: 'X',
      pokemonId: 1,
      hue: 1,
    });
  });

  it('rejects a value missing name, pokemonId or hue, or of the wrong type', () => {
    expect(parseCreatureRef({ pokemonId: 1, hue: 1 })).toBeNull();
    expect(parseCreatureRef({ name: 'X', hue: 1 })).toBeNull();
    expect(parseCreatureRef({ name: 'X', pokemonId: 1 })).toBeNull();
    expect(parseCreatureRef({ name: 'X', pokemonId: '1', hue: 1 })).toBeNull();
    expect(parseCreatureRef({ name: 1, pokemonId: 1, hue: 1 })).toBeNull();
  });

  it('rejects non-record values: null, arrays, primitives', () => {
    expect(parseCreatureRef(null)).toBeNull();
    expect(parseCreatureRef(undefined)).toBeNull();
    expect(parseCreatureRef('Bulbasaur')).toBeNull();
    expect(parseCreatureRef(1)).toBeNull();
    expect(parseCreatureRef([{ name: 'X', pokemonId: 1, hue: 1 }])).toBeNull();
  });
});

describe('parseCreatureRefs', () => {
  it('parses every valid entry and skips invalid ones, preserving order', () => {
    const value = [
      { name: 'A', pokemonId: 1, hue: 1 },
      { name: 'bad' }, // missing pokemonId/hue
      { name: 'B', pokemonId: 2, hue: 2, shiny: true },
      'not a record',
    ];
    expect(parseCreatureRefs(value)).toEqual([
      { name: 'A', pokemonId: 1, hue: 1 },
      { name: 'B', pokemonId: 2, hue: 2, shiny: true },
    ]);
  });

  it('is empty for a non-array value', () => {
    expect(parseCreatureRefs(null)).toEqual([]);
    expect(parseCreatureRefs({ name: 'A', pokemonId: 1, hue: 1 })).toEqual([]);
  });
});

describe('creatureRefToJson', () => {
  it('emits only name/pokemonId/hue for a bare ref — no shiny/lucky/code keys at all', () => {
    expect(creatureRefToJson({ name: 'X', pokemonId: 1, hue: 1 })).toEqual({ name: 'X', pokemonId: 1, hue: 1 });
  });

  it('omits falsy shiny/lucky rather than sending them as false', () => {
    const ref: CreatureRef = { name: 'X', pokemonId: 1, hue: 1, shiny: false, lucky: false };
    expect(creatureRefToJson(ref)).toEqual({ name: 'X', pokemonId: 1, hue: 1 });
  });

  it('sends shiny/lucky true when set', () => {
    const ref: CreatureRef = { name: 'X', pokemonId: 1, hue: 1, shiny: true, lucky: true };
    expect(creatureRefToJson(ref)).toEqual({ name: 'X', pokemonId: 1, hue: 1, shiny: true, lucky: true });
  });

  it('omits formCode/costumeCode rather than sending an explicit null when absent', () => {
    const ref: CreatureRef = { name: 'X', pokemonId: 1, hue: 1, formCode: null, costumeCode: undefined };
    const json = creatureRefToJson(ref);
    expect(json).toEqual({ name: 'X', pokemonId: 1, hue: 1 });
    expect(json).not.toHaveProperty('formCode');
    expect(json).not.toHaveProperty('costumeCode');
  });

  it('sends formCode/costumeCode when present', () => {
    const ref: CreatureRef = { name: 'Deoxys', pokemonId: 386, hue: 220, formCode: 'ATTACK', costumeCode: 'X' };
    expect(creatureRefToJson(ref)).toEqual({
      name: 'Deoxys',
      pokemonId: 386,
      hue: 220,
      formCode: 'ATTACK',
      costumeCode: 'X',
    });
  });

  it('round-trips through parseCreatureRef', () => {
    const ref: CreatureRef = {
      name: 'Zacian',
      pokemonId: 888,
      hue: 210,
      shiny: true,
      lucky: true,
      formCode: 'CROWNED_SWORD',
    };
    expect(parseCreatureRef(creatureRefToJson(ref))).toEqual(ref);
  });
});
