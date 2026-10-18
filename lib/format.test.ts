/**
 * Unit tests for `lib/format.ts` — `fmtDust`'s Stardust abbreviation, `creatureDisplayName`, the one
 * place a creature's displayed name is decided (the dex's name for its `pokemonId`, plus one `"Shiny "`
 * when the shiny flag is set — see that function's header comment), `speciesName` underneath it,
 * `creatureFormLabel` / `formCodeLabel`, which turn a sprite form code into display text (an official-name table
 * for the codes re-casing misnames, re-casing for the rest), `creatureForm`, which resolves that label together
 * with where it goes in a full name (before the species or in parentheses after it), `creatureFullName`, which
 * composes species, form and "Shiny" into the one string a header or sentence shows, and
 * `describeTypes`, the spoken wording of a typing.
 */
import { describe, expect, it } from 'vitest';

import { POKEDEX, typesOf } from '../constants/pokedex';
import { FORM_TYPE_OVERRIDES, POKEDEX_FORMS } from '../constants/pokedex-data';
import {
  FORM_LABEL_TABLE,
  creatureDisplayName,
  creatureForm,
  creatureFormLabel,
  creatureFullName,
  describeTypes,
  fmtDust,
  formCodeLabel,
  speciesName,
} from './format';
import { BASE_FORM_CODES } from './sprite-url';

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
  it('is just the dex name when not shiny', () => {
    expect(creatureDisplayName({ pokemonId: 814, name: 'Raboot' })).toBe('Raboot');
    expect(creatureDisplayName({ pokemonId: 814, name: 'Raboot', shiny: false })).toBe('Raboot');
  });

  it('prefixes "Shiny " when shiny is true', () => {
    expect(creatureDisplayName({ pokemonId: 814, name: 'Raboot', shiny: true })).toBe('Shiny Raboot');
  });

  it('treats null / undefined shiny the same as false — a valid CreatureRef value, not a truthy one', () => {
    expect(creatureDisplayName({ pokemonId: 814, name: 'Raboot', shiny: null })).toBe('Raboot');
    expect(creatureDisplayName({ pokemonId: 814, name: 'Raboot', shiny: undefined })).toBe('Raboot');
  });

  it('does not need a stored name at all: the identity is the pokemonId', () => {
    expect(creatureDisplayName({ pokemonId: 814 })).toBe('Raboot');
    expect(creatureDisplayName({ pokemonId: 814, shiny: true })).toBe('Shiny Raboot');
  });

  it('accepts a Listing, a FormalOffer, or any other { pokemonId, shiny } shaped object alike', () => {
    const listingLike = { id: 'l1', name: 'Zacian', shiny: true, pokemonId: 888 };
    const offerLike = { name: 'Deoxys A.', pokemonId: 386, hue: 220, shiny: true };
    expect(creatureDisplayName(listingLike)).toBe('Shiny Zacian');
    expect(creatureDisplayName(offerLike)).toBe('Shiny Deoxys');
  });

  it('never mutates the object it was given', () => {
    const creature = { pokemonId: 445, name: 'Sh. Garchomp', shiny: true };
    creatureDisplayName(creature);
    expect(creature).toEqual({ pokemonId: 445, name: 'Sh. Garchomp', shiny: true });
  });

  describe('a stored name that has drifted from the dex (the "Shiny Shiny Kyogre" bug)', () => {
    it('shows exactly one "Shiny" when the stored name already says it', () => {
      expect(creatureDisplayName({ pokemonId: 382, name: 'Shiny Kyogre', shiny: true })).toBe('Shiny Kyogre');
      expect(creatureDisplayName({ pokemonId: 484, name: 'Shiny Palkia', shiny: true })).toBe('Shiny Palkia');
    });

    it('shows one "Shiny" for the abbreviated spelling too, not "Shiny Sh. Mewtwo"', () => {
      expect(creatureDisplayName({ pokemonId: 150, name: 'Sh. Mewtwo', shiny: true })).toBe('Shiny Mewtwo');
      expect(creatureDisplayName({ pokemonId: 151, name: 'sh. mew', shiny: true })).toBe('Shiny Mew');
    });

    it('is not fooled by a prefix stacked on a prefix', () => {
      expect(creatureDisplayName({ pokemonId: 382, name: 'Shiny Shiny Kyogre', shiny: true })).toBe('Shiny Kyogre');
    });

    it('is the shiny FLAG that decides, not the spelling of the name', () => {
      expect(creatureDisplayName({ pokemonId: 382, name: 'Shiny Kyogre', shiny: false })).toBe('Kyogre');
      expect(creatureDisplayName({ pokemonId: 382, name: 'Shiny Kyogre' })).toBe('Kyogre');
    });

    it('drops every other attribute typed into the name, shiny or not', () => {
      expect(creatureDisplayName({ pokemonId: 149, name: 'Legacy Dnite' })).toBe('Dragonite');
      expect(creatureDisplayName({ pokemonId: 149, name: 'Legacy Dragonite', shiny: true })).toBe('Shiny Dragonite');
      expect(creatureDisplayName({ pokemonId: 250, name: 'Purified Apex Ho-Oh' })).toBe('Ho-Oh');
      expect(creatureDisplayName({ pokemonId: 384, name: 'Mega Rayquaza IV' })).toBe('Rayquaza');
      expect(creatureDisplayName({ pokemonId: 150, name: 'Armored Mewtwo' })).toBe('Mewtwo');
      expect(creatureDisplayName({ pokemonId: 374, name: 'Shiny Beldum Comm.', shiny: true })).toBe('Shiny Beldum');
    });
  });

  describe('an id the dex does not have (synthetic / mock ids)', () => {
    const UNKNOWN_ID = 999_999;

    it('falls back to the stored name', () => {
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Mystery' })).toBe('Mystery');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Mystery', shiny: true })).toBe('Shiny Mystery');
    });

    it('strips any leading shiny marker from that name, then adds the prefix once', () => {
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Shiny Mystery', shiny: true })).toBe('Shiny Mystery');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Sh. Mystery', shiny: true })).toBe('Shiny Mystery');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'shiny SH. Mystery', shiny: true })).toBe('Shiny Mystery');
    });

    it('strips the marker when NOT shiny as well — the flag, not the text, is the authority', () => {
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Shiny Mystery', shiny: false })).toBe('Mystery');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Sh. Mystery' })).toBe('Mystery');
    });

    it('only strips a marker at the start, and only a whole word', () => {
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Shinx' })).toBe('Shinx');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Mystery Shiny' })).toBe('Mystery Shiny');
    });

    it('never renders an empty name', () => {
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID })).toBe('Pokémon #999999');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: '  ' })).toBe('Pokémon #999999');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, name: 'Sh. ' })).toBe('Pokémon #999999');
      expect(creatureDisplayName({ pokemonId: UNKNOWN_ID, shiny: true })).toBe('Shiny Pokémon #999999');
    });
  });
});

describe('speciesName', () => {
  it('is the dex name for the id, whatever name is stored beside it', () => {
    expect(speciesName({ pokemonId: 382 })).toBe('Kyogre');
    expect(speciesName({ pokemonId: 382, name: 'Shiny Kyogre' })).toBe('Kyogre');
    expect(speciesName({ pokemonId: 382, name: 'a name the dex has never heard of' })).toBe('Kyogre');
  });

  it('is exactly the dex name for every species in the dex, however it was stored', () => {
    for (const entry of POKEDEX) {
      expect(speciesName({ pokemonId: entry.pokemonId, name: `Sh. Legacy ${entry.name}` })).toBe(entry.name);
    }
  });

  it('never carries the shiny prefix', () => {
    expect(speciesName({ pokemonId: 150, name: 'Sh. Mewtwo' })).toBe('Mewtwo');
    expect(speciesName({ pokemonId: 999_999, name: 'Shiny Mystery' })).toBe('Mystery');
  });
});

describe('creatureFormLabel', () => {
  it('is undefined for the default form', () => {
    expect(creatureFormLabel({ pokemonId: 150 })).toBeUndefined();
    expect(creatureFormLabel({ pokemonId: 150, formCode: null })).toBeUndefined();
    expect(creatureFormLabel({ pokemonId: 150, formCode: '' })).toBeUndefined();
  });

  it('re-cases a code that already reads as the form name, the structured home of what a name used to say in prose', () => {
    expect(creatureFormLabel({ pokemonId: 484, formCode: 'ORIGIN' })).toBe('Origin');
    expect(creatureFormLabel({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toBe('Crowned Sword');
    expect(creatureFormLabel({ pokemonId: 383, formCode: 'PRIMAL' })).toBe('Primal');
    expect(creatureFormLabel({ pokemonId: 384, formCode: 'MEGA' })).toBe('Mega');
    expect(creatureFormLabel({ pokemonId: 52, formCode: 'GALARIAN' })).toBe('Galarian');
    expect(creatureFormLabel({ pokemonId: 58, formCode: 'HISUIAN' })).toBe('Hisuian');
  });

  it('names Armored Mewtwo, whose code is a bare "A"', () => {
    expect(creatureFormLabel({ pokemonId: 150, formCode: 'A' })).toBe('Armored');
  });

  it('scopes a species-specific code to its species: "A" on anything else is just "A"', () => {
    expect(creatureFormLabel({ pokemonId: 151, formCode: 'A' })).toBe('A');
    expect(creatureFormLabel({ pokemonId: 999_999, formCode: 'A' })).toBe('A');
  });

  it('turns a region code into its adjective, whatever the species', () => {
    expect(creatureFormLabel({ pokemonId: 19, formCode: 'ALOLA' })).toBe('Alolan');
    expect(creatureFormLabel({ pokemonId: 52, formCode: 'ALOLA' })).toBe('Alolan');
    expect(creatureFormLabel({ pokemonId: 194, formCode: 'PALDEA' })).toBe('Paldean');
  });

  it('names the three Paldean Tauros breeds', () => {
    expect(creatureFormLabel({ pokemonId: 128, formCode: 'PALDEA_COMBAT' })).toBe('Paldean Combat Breed');
    expect(creatureFormLabel({ pokemonId: 128, formCode: 'PALDEA_BLAZE' })).toBe('Paldean Blaze Breed');
    expect(creatureFormLabel({ pokemonId: 128, formCode: 'PALDEA_AQUA' })).toBe('Paldean Aqua Breed');
  });

  it('names the Burmy and Wormadam cloaks and Galarian Darmanitan modes', () => {
    expect(creatureFormLabel({ pokemonId: 412, formCode: 'BURMY_PLANT' })).toBe('Plant Cloak');
    expect(creatureFormLabel({ pokemonId: 412, formCode: 'BURMY_SANDY' })).toBe('Sandy Cloak');
    expect(creatureFormLabel({ pokemonId: 412, formCode: 'BURMY_TRASH' })).toBe('Trash Cloak');
    expect(creatureFormLabel({ pokemonId: 413, formCode: 'WORMADAM_SANDY' })).toBe('Sandy Cloak');
    expect(creatureFormLabel({ pokemonId: 413, formCode: 'WORMADAM_TRASH' })).toBe('Trash Cloak');
    expect(creatureFormLabel({ pokemonId: 555, formCode: 'GALARIAN_ZEN' })).toBe('Galarian Zen Mode');
  });

  it('drops a species name the code repeats (Unown), without needing a row per letter', () => {
    expect(creatureFormLabel({ pokemonId: 201, formCode: 'UNOWN_A' })).toBe('A');
    expect(creatureFormLabel({ pokemonId: 201, formCode: 'UNOWN_B' })).toBe('B');
    // Only the species' OWN name: the same code on another species is left whole.
    expect(creatureFormLabel({ pokemonId: 1, formCode: 'UNOWN_A' })).toBe('Unown A');
    // A code that is nothing but the name keeps it rather than rendering blank.
    expect(creatureFormLabel({ pokemonId: 201, formCode: 'UNOWN_' })).toBe('Unown');
  });

  it('re-cases a code it has no name for, instead of guessing one', () => {
    expect(creatureFormLabel({ pokemonId: 150, formCode: 'SOME_NEW_FORM' })).toBe('Some New Form');
    expect(creatureFormLabel({ pokemonId: 133, formCode: 'SPRING_2026' })).toBe('Spring 2026');
  });

  it('falls back to re-casing for a species the dex does not know', () => {
    expect(creatureFormLabel({ pokemonId: 999_999, formCode: 'ORIGIN' })).toBe('Origin');
    expect(creatureFormLabel({ pokemonId: 999_999, formCode: 'ALOLA' })).toBe('Alolan');
  });

  it('gives every form code in the data a non-empty label, so none can render blank', () => {
    const pairs: [number, string][] = [
      ...FORM_TYPE_OVERRIDES.map(([id, code]): [number, string] => [id, code]),
      ...Object.entries(BASE_FORM_CODES).map(([id, code]): [number, string] => [Number(id), code]),
    ];
    // The data really does have these to check; an empty list would make the loop below vacuous.
    expect(pairs.length).toBeGreaterThan(100);
    for (const [pokemonId, formCode] of pairs) {
      const label = creatureFormLabel({ pokemonId, formCode });
      expect(label, `${pokemonId}:${formCode}`).toBeTruthy();
      expect(label!.trim(), `${pokemonId}:${formCode}`).toBe(label);
    }
  });
});

describe('creatureForm', () => {
  it('is undefined for the default form, like creatureFormLabel', () => {
    expect(creatureForm({ pokemonId: 150 })).toBeUndefined();
    expect(creatureForm({ pokemonId: 150, formCode: null })).toBeUndefined();
    expect(creatureForm({ pokemonId: 150, formCode: '' })).toBeUndefined();
  });

  it('is the label creatureFormLabel returns, plus the placement the table row states', () => {
    expect(creatureForm({ pokemonId: 150, formCode: 'A' })).toEqual({ label: 'Armored', placement: 'prefix' });
    expect(creatureForm({ pokemonId: 413, formCode: 'WORMADAM_SANDY' })).toEqual({ label: 'Sandy Cloak', placement: 'suffix' });
    expect(creatureForm({ pokemonId: 19, formCode: 'ALOLA' })).toEqual({ label: 'Alolan', placement: 'prefix' });
  });

  it('puts a label that came from the species-prefix rule after the species: what is left is a bare token', () => {
    expect(creatureForm({ pokemonId: 201, formCode: 'UNOWN_F' })).toEqual({ label: 'F', placement: 'suffix' });
    // A Burmy code with no table row (the three cloaks have rows) still takes the rule.
    expect(creatureForm({ pokemonId: 412, formCode: 'BURMY_FUTURE' })).toEqual({ label: 'Future', placement: 'suffix' });
  });

  it('puts a re-cased label before the species by default: most codes are an adjective on it', () => {
    expect(creatureForm({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toEqual({ label: 'Crowned Sword', placement: 'prefix' });
    expect(creatureForm({ pokemonId: 479, formCode: 'HEAT' })).toEqual({ label: 'Heat', placement: 'prefix' });
    expect(creatureForm({ pokemonId: 52, formCode: 'GALARIAN' })).toEqual({ label: 'Galarian', placement: 'prefix' });
  });

  it('puts a re-cased SYMBOL (a number, a lone letter) after the species: it cannot qualify one', () => {
    expect(creatureForm({ pokemonId: 327, formCode: '01' })).toEqual({ label: '01', placement: 'suffix' });
    expect(creatureForm({ pokemonId: 151, formCode: 'A' })).toEqual({ label: 'A', placement: 'suffix' });
    // A label that merely CONTAINS a number is still a word first.
    expect(creatureForm({ pokemonId: 222, formCode: 'SPRING_2026' })).toEqual({ label: 'Spring 2026', placement: 'prefix' });
  });
});

describe('creatureFullName', () => {
  it('is exactly creatureDisplayName for the default form, shiny or not', () => {
    const creatures = [
      { pokemonId: 150 },
      { pokemonId: 150, formCode: null },
      { pokemonId: 150, formCode: '' },
      { pokemonId: 150, shiny: true, formCode: undefined },
      { pokemonId: 814, name: 'Sh. Raboot', shiny: true },
      { pokemonId: 999_999, name: 'Shiny Mystery', shiny: true },
      { pokemonId: 999_999 },
    ];
    for (const creature of creatures) {
      expect(creatureFullName(creature)).toBe(creatureDisplayName(creature));
    }
  });

  it('puts an adjective-like form before the species', () => {
    expect(creatureFullName({ pokemonId: 150, formCode: 'A' })).toBe('Armored Mewtwo');
    expect(creatureFullName({ pokemonId: 37, formCode: 'ALOLA' })).toBe('Alolan Vulpix');
    expect(creatureFullName({ pokemonId: 52, formCode: 'GALARIAN' })).toBe('Galarian Meowth');
    expect(creatureFullName({ pokemonId: 58, formCode: 'HISUIAN' })).toBe('Hisuian Growlithe');
    expect(creatureFullName({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toBe('Crowned Sword Zacian');
    expect(creatureFullName({ pokemonId: 479, formCode: 'HEAT' })).toBe('Heat Rotom');
    expect(creatureFullName({ pokemonId: 484, formCode: 'ORIGIN' })).toBe('Origin Palkia');
    expect(creatureFullName({ pokemonId: 646, formCode: 'WHITE' })).toBe('White Kyurem');
    expect(creatureFullName({ pokemonId: 800, formCode: 'ULTRA' })).toBe('Ultra Necrozma');
    expect(creatureFullName({ pokemonId: 800, formCode: 'DUSK_MANE' })).toBe('Dusk Mane Necrozma');
    expect(creatureFullName({ pokemonId: 898, formCode: 'ICE_RIDER' })).toBe('Ice Rider Calyrex');
    expect(creatureFullName({ pokemonId: 892, formCode: 'RAPID_STRIKE' })).toBe('Rapid Strike Urshifu');
    expect(creatureFullName({ pokemonId: 384, formCode: 'MEGA' })).toBe('Mega Rayquaza');
  });

  it('puts a form that names a kind of form, or is only a symbol, in parentheses after the species', () => {
    expect(creatureFullName({ pokemonId: 201, formCode: 'UNOWN_F' })).toBe('Unown (F)');
    expect(creatureFullName({ pokemonId: 201, formCode: 'UNOWN_A' })).toBe('Unown (A)');
    expect(creatureFullName({ pokemonId: 201, formCode: 'UNOWN_EXCLAMATION_POINT' })).toBe('Unown (Exclamation Point)');
    expect(creatureFullName({ pokemonId: 413, formCode: 'WORMADAM_SANDY' })).toBe('Wormadam (Sandy Cloak)');
    expect(creatureFullName({ pokemonId: 412, formCode: 'BURMY_TRASH' })).toBe('Burmy (Trash Cloak)');
    expect(creatureFullName({ pokemonId: 412, formCode: 'BURMY_SANDY', shiny: true })).toBe('Shiny Burmy (Sandy Cloak)');
    expect(creatureFullName({ pokemonId: 741, formCode: 'BAILE' })).toBe('Oricorio (Baile Style)');
    expect(creatureFullName({ pokemonId: 741, formCode: 'PAU' })).toBe("Oricorio (Pa'u Style)");
    expect(creatureFullName({ pokemonId: 128, formCode: 'PALDEA_COMBAT' })).toBe('Tauros (Paldean Combat Breed)');
    expect(creatureFullName({ pokemonId: 555, formCode: 'GALARIAN_ZEN' })).toBe('Darmanitan (Galarian Zen Mode)');
    expect(creatureFullName({ pokemonId: 555, formCode: 'ZEN' })).toBe('Darmanitan (Zen Mode)');
    expect(creatureFullName({ pokemonId: 925, formCode: 'FAMILY_OF_FOUR' })).toBe('Maushold (Family of Four)');
    expect(creatureFullName({ pokemonId: 925, formCode: 'FAMILY_OF_THREE' })).toBe('Maushold (Family of Three)');
    expect(creatureFullName({ pokemonId: 718, formCode: 'COMPLETE_TEN_PERCENT' })).toBe('Zygarde (Complete Ten Percent)');
    expect(creatureFullName({ pokemonId: 327, formCode: '07' })).toBe('Spinda (07)');
    expect(creatureFullName({ pokemonId: 6, formCode: 'MEGA_X' })).toBe('Charizard (Mega X)');
  });

  it('puts "Shiny" first, ahead of the form, wherever the form goes', () => {
    expect(creatureFullName({ pokemonId: 150, formCode: 'A', shiny: true })).toBe('Shiny Armored Mewtwo');
    expect(creatureFullName({ pokemonId: 37, formCode: 'ALOLA', shiny: true })).toBe('Shiny Alolan Vulpix');
    expect(creatureFullName({ pokemonId: 201, formCode: 'UNOWN_F', shiny: true })).toBe('Shiny Unown (F)');
    expect(creatureFullName({ pokemonId: 555, formCode: 'GALARIAN_ZEN', shiny: true })).toBe('Shiny Darmanitan (Galarian Zen Mode)');
  });

  it('is the shiny FLAG that decides, as for creatureDisplayName, and the dex that names the species', () => {
    expect(creatureFullName({ pokemonId: 150, name: 'Shiny Armored Mewtwo', formCode: 'A', shiny: true })).toBe('Shiny Armored Mewtwo');
    expect(creatureFullName({ pokemonId: 150, name: 'Shiny Armored Mewtwo', formCode: 'A', shiny: false })).toBe('Armored Mewtwo');
    expect(creatureFullName({ pokemonId: 150, name: 'Armored Mewtwo', formCode: 'A' })).toBe('Armored Mewtwo');
    // The form is the structured code, so a stored name that SAYS a form without the code shows none.
    expect(creatureFullName({ pokemonId: 150, name: 'Armored Mewtwo' })).toBe('Mewtwo');
    expect(creatureFullName({ pokemonId: 150, formCode: 'A', shiny: null })).toBe('Armored Mewtwo');
  });

  it('accepts a Listing, a FormalOffer, or any other { pokemonId, shiny, formCode } shaped object, and never mutates it', () => {
    const listingLike = { id: 'l2', name: 'Armored Mewtwo', pokemonId: 150, formCode: 'A', shiny: false };
    const offerLike = { name: 'Giratina O.', pokemonId: 487, formCode: 'ORIGIN', hue: 220, shiny: true };
    expect(creatureFullName(listingLike)).toBe('Armored Mewtwo');
    expect(creatureFullName(offerLike)).toBe('Shiny Origin Giratina');
    expect(listingLike).toEqual({ id: 'l2', name: 'Armored Mewtwo', pokemonId: 150, formCode: 'A', shiny: false });
  });

  describe('an unknown species or form code', () => {
    const UNKNOWN_ID = 999_999;

    it('still reads as a name: the stored name (or the dex number) and the re-cased code', () => {
      expect(creatureFullName({ pokemonId: UNKNOWN_ID, name: 'Mystery', formCode: 'ORIGIN' })).toBe('Origin Mystery');
      expect(creatureFullName({ pokemonId: UNKNOWN_ID, name: 'Sh. Mystery', formCode: 'ORIGIN', shiny: true })).toBe('Shiny Origin Mystery');
      expect(creatureFullName({ pokemonId: UNKNOWN_ID, formCode: 'ORIGIN' })).toBe('Origin Pokémon #999999');
      expect(creatureFullName({ pokemonId: UNKNOWN_ID, name: 'Mystery', formCode: 'ALOLA' })).toBe('Alolan Mystery');
    });

    it('re-cases a code it has no name for instead of guessing one', () => {
      expect(creatureFullName({ pokemonId: 150, formCode: 'SOME_NEW_FORM' })).toBe('Some New Form Mewtwo');
      expect(creatureFullName({ pokemonId: 150, formCode: 'SOME_NEW_FORM', shiny: true })).toBe('Shiny Some New Form Mewtwo');
    });

    it('does not leave a species-scoped code on the wrong species: "A" is Armored on Mewtwo only', () => {
      expect(creatureFullName({ pokemonId: 151, formCode: 'A' })).toBe('Mew (A)');
      expect(creatureFullName({ pokemonId: UNKNOWN_ID, name: 'Mystery', formCode: 'A' })).toBe('Mystery (A)');
    });

    it('treats a code with nothing in it as no form, never as an empty "()" or a doubled space', () => {
      expect(creatureFullName({ pokemonId: 150, formCode: '___' })).toBe('Mewtwo');
      expect(creatureFullName({ pokemonId: 150, formCode: '___', shiny: true })).toBe('Shiny Mewtwo');
    });
  });

  describe('every form in the data', () => {
    // The union of what the app can meet: the picker's catalog (POKEDEX_FORMS), the typing table, and the sprite
    // pipeline's base forms. A code in any of them must read as a name on its species.
    const pairs = new Map<string, [number, string]>();
    for (const [pokemonId, codes] of POKEDEX_FORMS) for (const code of codes) pairs.set(`${pokemonId}:${code}`, [pokemonId, code]);
    for (const [pokemonId, code] of FORM_TYPE_OVERRIDES) pairs.set(`${pokemonId}:${code}`, [pokemonId, code]);
    for (const [id, code] of Object.entries(BASE_FORM_CODES)) pairs.set(`${id}:${code}`, [Number(id), code]);

    it('has a real catalog to check (an empty one would make the loops below vacuous)', () => {
      expect(pairs.size).toBeGreaterThan(300);
      expect(POKEDEX_FORMS.length).toBeGreaterThan(100);
    });

    it('gives a clean name on its species, with and without "Shiny"', () => {
      for (const [pokemonId, formCode] of pairs.values()) {
        const species = speciesName({ pokemonId });
        const label = creatureFormLabel({ pokemonId, formCode })!;
        for (const shiny of [false, true]) {
          const name = creatureFullName({ pokemonId, formCode, shiny });
          const at = `${pokemonId}:${formCode}${shiny ? ' shiny' : ''} -> "${name}"`;
          expect(name.trim(), at).toBe(name);
          expect(name, at).not.toBe('');
          // The species exactly once: neither dropped nor repeated ("Unown Unown (A)").
          expect(name.split(species).length - 1, at).toBe(1);
          // The form is shown as its label, never as the sprite token.
          expect(name, at).not.toContain('_');
          expect(name, at).not.toMatch(/\s{2,}/);
          expect(name, at).not.toContain('()');
          expect(name, at).toContain(label);
          // Shiny leads, once, and only when asked for.
          expect(name.startsWith('Shiny '), at).toBe(shiny);
          expect(name.split('Shiny').length - 1, at).toBe(shiny ? 1 : 0);
          // A name never opens with a symbol ("01 Spinda", "A Mew"): those are placed after the species.
          expect(name.replace(/^Shiny /, ''), at).not.toMatch(/^(?:\d|\p{L}(?:\s|$))/u);
        }
      }
    });

    it('puts the label where its placement says, and nowhere else', () => {
      for (const [pokemonId, formCode] of pairs.values()) {
        const species = speciesName({ pokemonId });
        const form = creatureForm({ pokemonId, formCode })!;
        const name = creatureFullName({ pokemonId, formCode });
        const expected = form.placement === 'prefix' ? `${form.label} ${species}` : `${species} (${form.label})`;
        expect(name, `${pokemonId}:${formCode}`).toBe(expected);
      }
    });

    it('is longer than the species by its label alone, so a form can never silently vanish from a header', () => {
      for (const [pokemonId, formCode] of pairs.values()) {
        expect(creatureFullName({ pokemonId, formCode }).length, `${pokemonId}:${formCode}`).toBeGreaterThan(speciesName({ pokemonId }).length);
      }
    });
  });
});

describe('FORM_LABEL_TABLE', () => {
  /** Rows for codes the app meets from hosted data / the mock listings, not from `FORM_TYPE_OVERRIDES` (which
   *  lists only forms whose TYPES differ) or `BASE_FORM_CODES`: Armored Mewtwo, `data/listings.ts` l2 and the
   *  hosted `listings.form_code`. */
  const FROM_LISTINGS = new Set(['150:A']);

  /** Real PokeMiners codes that no data table lists, because the table that would (`FORM_TYPE_OVERRIDES`) holds
   *  only forms whose TYPING differs: Mega Y keeps Charizard's and Mewtwo's typing (`constants/pokedex.test.ts`
   *  pins `typesOf(Charizard MEGA_Y)` as "unchanged"), and its sibling `MEGA_X` is in the table. */
  const SIBLING_CODES = new Set(['MEGA_Y']);

  const known = new Set<string>([
    ...FORM_TYPE_OVERRIDES.map(([id, code]) => `${id}:${code}`),
    ...Object.entries(BASE_FORM_CODES).map(([id, code]) => `${id}:${code}`),
    ...POKEDEX_FORMS.flatMap(([id, codes]) => codes.map((code) => `${id}:${code}`)),
    ...FROM_LISTINGS,
  ]);
  const knownCodes = new Set<string>([...[...known].map((key) => key.slice(key.indexOf(':') + 1)), ...SIBLING_CODES]);

  it('only names codes the data actually has, on the species that has them', () => {
    for (const [pokemonId, code] of FORM_LABEL_TABLE) {
      if (pokemonId === '*') {
        expect(knownCodes.has(code), `*:${code}`).toBe(true);
      } else {
        expect(known.has(`${pokemonId}:${code}`), `${pokemonId}:${code}`).toBe(true);
      }
    }
  });

  it('has one row per (species, code) and no blank or code-shaped label', () => {
    const seen = new Set<string>();
    for (const [pokemonId, code, label] of FORM_LABEL_TABLE) {
      const key = `${pokemonId}:${code}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
      expect(label.trim(), key).not.toBe('');
      // A label is a name, not a re-spelled sprite token.
      expect(label, key).not.toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it('states a placement on every row, and it is one the formatter knows', () => {
    for (const [pokemonId, code, , placement] of FORM_LABEL_TABLE) {
      expect(['prefix', 'suffix'], `${pokemonId}:${code}`).toContain(placement);
    }
  });
});

describe('formCodeLabel', () => {
  it('title-cases an underscore-separated code', () => {
    expect(formCodeLabel('CROWNED_SWORD')).toBe('Crowned Sword');
    expect(formCodeLabel('ALOLA')).toBe('Alola');
  });

  it('only re-cases: digits and unknown words are kept as they are', () => {
    expect(formCodeLabel('JAN_2020_NOEVOLVE')).toBe('Jan 2020 Noevolve');
  });

  it('ignores stray underscores', () => {
    expect(formCodeLabel('_ORIGIN__')).toBe('Origin');
  });
});

describe('describeTypes', () => {
  it('names a single type, singular', () => {
    expect(describeTypes(['Fire'])).toBe('Fire type');
  });

  it('joins a dual typing with "and", primary type first', () => {
    expect(describeTypes(['Fire', 'Flying'])).toBe('Fire and Flying type');
    expect(describeTypes(['Flying', 'Fire'])).toBe('Flying and Fire type');
  });

  it('reads a creature\'s form-aware typing straight from typesOf', () => {
    const zacian = { pokemonId: 888 };
    expect(describeTypes(typesOf(zacian)!)).toBe('Fairy type');
    expect(describeTypes(typesOf({ ...zacian, formCode: 'CROWNED_SWORD' })!)).toBe('Fairy and Steel type');
  });
});
