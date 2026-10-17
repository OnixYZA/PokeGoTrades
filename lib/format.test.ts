/**
 * Unit tests for `lib/format.ts` — `fmtDust`'s Stardust abbreviation, `creatureDisplayName`, the one
 * place a creature's displayed name is decided (the dex's name for its `pokemonId`, plus one `"Shiny "`
 * when the shiny flag is set — see that function's header comment), `speciesName` underneath it,
 * `creatureFormLabel` / `formCodeLabel`, which turn a sprite form code into display text (an official-name table
 * for the codes re-casing misnames, re-casing for the rest), and
 * `describeTypes`, the spoken wording of a typing.
 */
import { describe, expect, it } from 'vitest';

import { POKEDEX, typesOf } from '../constants/pokedex';
import { FORM_TYPE_OVERRIDES } from '../constants/pokedex-data';
import {
  FORM_LABEL_TABLE,
  creatureDisplayName,
  creatureFormLabel,
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

  it('names the Wormadam cloaks and Galarian Darmanitan modes', () => {
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

describe('FORM_LABEL_TABLE', () => {
  /** Rows for codes the app meets from hosted data / the mock listings, not from `FORM_TYPE_OVERRIDES` (which
   *  lists only forms whose TYPES differ) or `BASE_FORM_CODES`: Armored Mewtwo, `data/listings.ts` l2 and the
   *  hosted `listings.form_code`. */
  const FROM_LISTINGS = new Set(['150:A']);

  const known = new Set<string>([
    ...FORM_TYPE_OVERRIDES.map(([id, code]) => `${id}:${code}`),
    ...Object.entries(BASE_FORM_CODES).map(([id, code]) => `${id}:${code}`),
    ...FROM_LISTINGS,
  ]);

  it('only names codes the data actually has, on the species that has them', () => {
    for (const [pokemonId, code] of FORM_LABEL_TABLE) {
      if (pokemonId === '*') {
        expect(
          FORM_TYPE_OVERRIDES.some(([, c]) => c === code),
          `*:${code}`,
        ).toBe(true);
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
