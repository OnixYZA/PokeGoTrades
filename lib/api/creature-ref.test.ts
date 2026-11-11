/**
 * Unit tests for `lib/api/creature-ref.ts` — the one shared parse/serialize pair for the app's
 * `CreatureRef` jsonb shape (`listings.looking`, `trainer_creatures.creature`, `chat_messages.offer`,
 * `my_trade_history`'s `gave`/`got`). Covers round-tripping through `creatureRefToJson` ->
 * `parseCreatureRef`, rejecting malformed input, and the omit-vs-null rules for `formCode`/`costumeCode`
 * (the DB's `creature_ref_is_valid` rejects an explicit JSON `null` for either key).
 */
import { describe, expect, it } from 'vitest';

import type { CreatureRef } from '@/data/types';

import { creatureRefToJson, creatureToOffer, parseCreatureRef, parseCreatureRefs } from './creature-ref';

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
    expect(creatureRefToJson({ name: 'Bulbasaur', pokemonId: 1, hue: 1 })).toEqual({ name: 'Bulbasaur', pokemonId: 1, hue: 1 });
  });

  it('omits falsy shiny/lucky rather than sending them as false', () => {
    const ref: CreatureRef = { name: 'Bulbasaur', pokemonId: 1, hue: 1, shiny: false, lucky: false };
    expect(creatureRefToJson(ref)).toEqual({ name: 'Bulbasaur', pokemonId: 1, hue: 1 });
  });

  it('sends shiny/lucky true when set', () => {
    const ref: CreatureRef = { name: 'Bulbasaur', pokemonId: 1, hue: 1, shiny: true, lucky: true };
    expect(creatureRefToJson(ref)).toEqual({ name: 'Bulbasaur', pokemonId: 1, hue: 1, shiny: true, lucky: true });
  });

  it('omits formCode/costumeCode rather than sending an explicit null when absent', () => {
    const ref: CreatureRef = { name: 'Bulbasaur', pokemonId: 1, hue: 1, formCode: null, costumeCode: undefined };
    const json = creatureRefToJson(ref);
    expect(json).toEqual({ name: 'Bulbasaur', pokemonId: 1, hue: 1 });
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

  describe('the written name is the dex name for the id, never the caller\'s string', () => {
    it('strips an attribute typed into the name (the drift that produced "Shiny Shiny Kyogre")', () => {
      for (const [stored, pokemonId, dexName] of [
        ['Shiny Kyogre', 382, 'Kyogre'],
        ['Sh. Mewtwo', 150, 'Mewtwo'],
        ['Legacy Dnite', 149, 'Dragonite'],
        ['Purified Apex Ho-Oh', 250, 'Ho-Oh'],
        ['Mega Rayquaza IV', 384, 'Rayquaza'],
        ['Armored Mewtwo', 150, 'Mewtwo'],
      ] as const) {
        expect(creatureRefToJson({ name: stored, pokemonId, hue: 1 }).name).toBe(dexName);
      }
    });

    it('keeps the structured keys that carry what the name used to say', () => {
      const ref: CreatureRef = { name: 'Shiny Mega Rayquaza', pokemonId: 384, hue: 145, shiny: true, formCode: 'MEGA' };
      expect(creatureRefToJson(ref)).toEqual({ name: 'Rayquaza', pokemonId: 384, hue: 145, shiny: true, formCode: 'MEGA' });
    });

    it('re-sending a ref read back from a polluted row repairs it instead of copying the pollution', () => {
      const polluted = parseCreatureRef({ name: 'Sh. Mewtwo', pokemonId: 150, hue: 275, shiny: true });
      expect(polluted).not.toBeNull();
      expect(creatureRefToJson(polluted!)).toEqual({ name: 'Mewtwo', pokemonId: 150, hue: 275, shiny: true });
    });

    it('for an id outside the dex, keeps the stored name minus any shiny marker', () => {
      expect(creatureRefToJson({ name: 'Sh. Mystery', pokemonId: 999_999, hue: 1, shiny: true }).name).toBe('Mystery');
      expect(creatureRefToJson({ name: 'Mystery', pokemonId: 999_999, hue: 1 }).name).toBe('Mystery');
    });
  });
});

describe('formCode through the jsonb pair', () => {
  // A trainer_creatures / looking[] entry is written by `creatureRefToJson` and read back by `parseCreatureRef`;
  // the form must survive that trip, and a default form must come back as ABSENT, never as an explicit null.
  const alolanVulpix: CreatureRef = { name: 'Vulpix', pokemonId: 37, hue: 18, formCode: 'ALOLA' };
  const vulpix: CreatureRef = { name: 'Vulpix', pokemonId: 37, hue: 18 };

  it('round-trips a form, and keeps it alongside shiny', () => {
    expect(parseCreatureRef(creatureRefToJson(alolanVulpix))).toEqual(alolanVulpix);
    const shiny: CreatureRef = { ...alolanVulpix, shiny: true };
    expect(parseCreatureRef(creatureRefToJson(shiny))).toEqual(shiny);
  });

  it('round-trips a default form as no formCode at all, whether it was null or absent', () => {
    for (const ref of [vulpix, { ...vulpix, formCode: null }]) {
      const json = creatureRefToJson(ref);
      expect(json).not.toHaveProperty('formCode');
      const parsed = parseCreatureRef(json);
      expect(parsed).toEqual(vulpix);
      expect(parsed).not.toHaveProperty('formCode');
    }
  });

  it('reads an explicit stored null, an empty string and a non-string formCode as no form', () => {
    for (const formCode of [null, '', 42, true, {}, []]) {
      const parsed = parseCreatureRef({ name: 'Vulpix', pokemonId: 37, hue: 18, formCode });
      expect(parsed, `formCode ${JSON.stringify(formCode)}`).toEqual(vulpix);
      expect(parsed).not.toHaveProperty('formCode');
    }
  });

  it('keeps two forms of one species distinct through a list', () => {
    const stored = [alolanVulpix, vulpix].map(creatureRefToJson);
    expect(parseCreatureRefs(stored).map((r) => r.formCode)).toEqual(['ALOLA', undefined]);
  });
});

describe('creatureToOffer', () => {
  // The Arsenal -> formal offer hop (`ArsenalOfferSheet` -> `creatureToOffer` -> `offerToJson`, which spreads
  // `creatureRefToJson`): a form the trainer's Arsenal entry carries has to reach the offer card and the
  // Trade Summary, which read it back with `parseCreatureRef`.
  it('carries formCode, costumeCode, shiny and lucky from the creature', () => {
    const creature: CreatureRef = {
      name: 'Vulpix',
      pokemonId: 37,
      hue: 18,
      shiny: true,
      lucky: true,
      formCode: 'ALOLA',
      costumeCode: 'JAN_2020_NOEVOLVE',
    };
    expect(creatureToOffer(creature)).toEqual(creature);
  });

  it('leaves off a null / absent form and falsy flags, as the DB check wants them absent', () => {
    const offer = creatureToOffer({ name: 'Vulpix', pokemonId: 37, hue: 18, shiny: false, lucky: false, formCode: null, costumeCode: null });
    expect(offer).toEqual({ name: 'Vulpix', pokemonId: 37, hue: 18 });
    expect(offer).not.toHaveProperty('formCode');
    expect(offer).not.toHaveProperty('costumeCode');
  });

  it('an Arsenal row survives row -> parse -> offer -> offer jsonb -> parse with its form', () => {
    const arsenalRow = { name: 'Vulpix', pokemonId: 37, hue: 18, shiny: true, formCode: 'ALOLA' };
    const creature = parseCreatureRef(arsenalRow);
    expect(creature).not.toBeNull();
    const offerJson = creatureRefToJson(creatureToOffer(creature!));
    expect(offerJson).toEqual(arsenalRow);
    expect(parseCreatureRef(offerJson)?.formCode).toBe('ALOLA');
  });

  it('does not copy the stored name pollution into the offer jsonb', () => {
    expect(creatureRefToJson(creatureToOffer({ name: 'Sh. Vulpix', pokemonId: 37, hue: 18, formCode: 'ALOLA' }))).toEqual({
      name: 'Vulpix',
      pokemonId: 37,
      hue: 18,
      formCode: 'ALOLA',
    });
  });
});

describe('formCode is canonical through every path', () => {
  const base = { name: 'Zacian', pokemonId: 888, hue: 340 };

  it('reads the game master spelling as the stored code', () => {
    expect(parseCreatureRef({ ...base, formCode: 'ZACIAN_CROWNED_SWORD' })).toEqual({ ...base, formCode: 'CROWNED_SWORD' });
    expect(parseCreatureRef({ name: 'Zamazenta', pokemonId: 889, hue: 1, formCode: 'ZAMAZENTA_CROWNED_SHIELD' })).toEqual({
      name: 'Zamazenta',
      pokemonId: 889,
      hue: 1,
      formCode: 'CROWNED_SHIELD',
    });
  });

  it('omits the key for the default form, however it is spelled', () => {
    expect(parseCreatureRef({ name: 'Zamazenta', pokemonId: 889, hue: 1, formCode: 'ZAMAZENTA_HERO' })).toEqual({ name: 'Zamazenta', pokemonId: 889, hue: 1 });
    expect(parseCreatureRef({ ...base, formCode: 'HERO' })).toEqual(base);
  });

  it('keeps a real form: Alolan Vulpix', () => {
    const vulpix = { name: 'Vulpix', pokemonId: 37, hue: 200, formCode: 'ALOLA' };
    expect(parseCreatureRef(vulpix)).toEqual(vulpix);
    expect(creatureRefToJson(vulpix)).toMatchObject({ formCode: 'ALOLA' });
  });

  it('writes the canonical code, in the jsonb and in the offer', () => {
    expect(creatureRefToJson({ ...base, formCode: 'ZACIAN_CROWNED_SWORD' })).toMatchObject({ formCode: 'CROWNED_SWORD' });
    expect(creatureRefToJson({ ...base, formCode: 'HERO' })).not.toHaveProperty('formCode');
    expect(creatureToOffer({ ...base, formCode: 'ZACIAN_CROWNED_SWORD' })).toMatchObject({ formCode: 'CROWNED_SWORD' });
    expect(creatureToOffer({ ...base, formCode: 'HERO' })).not.toHaveProperty('formCode');
  });

  it('round-trips: parse(toJson(x)) equals the normalised x', () => {
    const spellings = [
      { ...base, formCode: 'ZACIAN_CROWNED_SWORD' },
      { ...base, formCode: 'CROWNED_SWORD' },
      { ...base, formCode: 'HERO' },
      { ...base },
    ];
    for (const ref of spellings) {
      const once = parseCreatureRef(creatureRefToJson(ref));
      expect(once).not.toBeNull();
      expect(parseCreatureRef(creatureRefToJson(once!))).toEqual(once);
    }
    expect(parseCreatureRef(creatureRefToJson({ ...base, formCode: 'ZACIAN_CROWNED_SWORD' }))).toEqual({ ...base, formCode: 'CROWNED_SWORD' });
  });
});
