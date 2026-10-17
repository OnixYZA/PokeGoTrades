/**
 * Tests for the pure half of the Pokédex generator (`scripts/pokedex-source.ts`). The fixtures are tiny
 * hand-built slices of the real upstream shapes (PokeAPI CSV rows, PokeMiners game master templates) using
 * real species and forms (Zacian, Vulpix, Charizard, Wormadam, Silvally) whose typing was checked against
 * the downloaded sources, so the tests pin the generator's rules without a network or a 19 MB download.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BASE_FORM_CODES } from '../constants/base-form-codes';
import { POKEMON_TYPES, type PokemonType, type PokemonTypes } from '../constants/pokemon-types';
import { isPokemonUntradable, UNTRADABLE_FORM_COMBINATIONS } from '../constants/untradable';
import { parsePokeMinersIcon } from './pokeminers';
import {
  blockingProblems,
  buildFormCatalog,
  buildPokedexData,
  checkTradability,
  COSTUME_FORMS_KEPT_AS_FORMS,
  csvRecords,
  gameMasterDefaultTypes,
  parseAssetFormTokens,
  parseCsv,
  parseGameMaster,
  parseGameMasterForms,
  parsePokeApiSpecies,
  parseProvenance,
  renderDataFile,
  resolveFormCode,
  SHADOW_MARKER_CODES,
  TRADABILITY_OVERRIDES,
  UNFLAGGED_COSTUME_FORMS_EXCLUDED,
  type GameMasterTemplate,
  type Provenance,
  type SpeciesRow,
  type TradabilityRules,
} from './pokedex-source';

// ——— CSV ———

describe('parseCsv', () => {
  it('splits plain rows and fields', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,b,c\n1,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('handles quoted fields: commas, escaped quotes and embedded newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('accepts CRLF, a missing final newline and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('leaves non-ASCII names alone', () => {
    expect(parseCsv("id,name\n669,Flabébé\n83,Farfetch’d\n")[1]).toEqual(['669', 'Flabébé']);
  });
});

describe('csvRecords', () => {
  it('keys each row by the header', () => {
    expect(csvRecords('id,name\n1,Bulbasaur\n', 'x.csv')).toEqual([{ id: '1', name: 'Bulbasaur' }]);
  });

  it('refuses a row of the wrong width instead of misaligning columns', () => {
    expect(() => csvRecords('id,name\n1\n', 'x.csv')).toThrow(/x\.csv: row 2 has 1 fields, the header has 2/);
  });
});

// ——— PokeAPI ———

/** types.csv with the 18 standard types at ids 1..18 (in `POKEMON_TYPES` order) plus a non-standard one. */
const TYPES_CSV =
  'id,identifier,generation_id,damage_class_id\n' +
  POKEMON_TYPES.map((type, i) => `${i + 1},${type.toLowerCase()},1,2`).join('\n') +
  '\n10001,unknown,2,\n';
const typeId = (type: PokemonType) => POKEMON_TYPES.indexOf(type) + 1;

function pokeApiFixture(species: { id: number; name: string; types: PokemonType[] }[]) {
  return {
    types: TYPES_CSV,
    species: 'id,identifier\n' + species.map((s) => `${s.id},x`).join('\n') + '\n',
    // Language 9 is English; a Japanese row for each species must be ignored.
    speciesNames:
      'pokemon_species_id,local_language_id,name,genus\n' +
      species.map((s) => `${s.id},1,日本語,x\n${s.id},9,"${s.name}",x`).join('\n') +
      '\n',
    // A synthetic form row (id != species_id) must not be mistaken for the default.
    pokemon: 'id,identifier,species_id\n' + species.map((s) => `${s.id},x,${s.id}\n${s.id + 10000},x-form,${s.id}`).join('\n') + '\n',
    pokemonTypes:
      'pokemon_id,type_id,slot\n' +
      species.flatMap((s) => s.types.map((t, i) => `${s.id},${typeId(t)},${i + 1}`)).join('\n') +
      '\n',
  };
}

describe('parsePokeApiSpecies', () => {
  it('reads English names and both type slots in slot order', () => {
    const rows = parsePokeApiSpecies(
      pokeApiFixture([
        { id: 1, name: 'Bulbasaur', types: ['Grass', 'Poison'] },
        { id: 2, name: 'Mr. Mime', types: ['Psychic'] },
      ]),
    );
    expect(rows).toEqual([
      { id: 1, name: 'Bulbasaur', types: ['Grass', 'Poison'] },
      { id: 2, name: 'Mr. Mime', types: ['Psychic'] },
    ]);
  });

  it('ignores the order rows appear in the CSV: slot decides, not file order', () => {
    const fixture = pokeApiFixture([{ id: 1, name: 'Bulbasaur', types: ['Grass', 'Poison'] }]);
    fixture.pokemonTypes = `pokemon_id,type_id,slot\n1,${typeId('Poison')},2\n1,${typeId('Grass')},1\n`;
    expect(parsePokeApiSpecies(fixture)[0].types).toEqual(['Grass', 'Poison']);
  });

  it('refuses a species with no type, or a non-standard one', () => {
    const none = pokeApiFixture([{ id: 1, name: 'Bulbasaur', types: [] }]);
    expect(() => parsePokeApiSpecies(none)).toThrow(/one or two types, got 0/);
    const odd = pokeApiFixture([{ id: 1, name: 'Bulbasaur', types: ['Grass'] }]);
    odd.pokemonTypes = 'pokemon_id,type_id,slot\n1,10001,1\n';
    expect(() => parsePokeApiSpecies(odd)).toThrow(/type id 10001/);
  });

  it('refuses a dex with a hole, so a truncated download cannot shrink it', () => {
    const fixture = pokeApiFixture([
      { id: 1, name: 'Bulbasaur', types: ['Grass'] },
      { id: 3, name: 'Venusaur', types: ['Grass'] },
    ]);
    expect(() => parsePokeApiSpecies(fixture)).toThrow(/not contiguous: expected 2, found 3/);
  });

  it('refuses a species with no English name', () => {
    const fixture = pokeApiFixture([{ id: 1, name: 'Bulbasaur', types: ['Grass'] }]);
    fixture.speciesNames = 'pokemon_species_id,local_language_id,name,genus\n1,1,日本語,x\n';
    expect(() => parsePokeApiSpecies(fixture)).toThrow(/no English name/);
  });

  it('refuses a types.csv that lost one of the 18 types', () => {
    const fixture = pokeApiFixture([{ id: 1, name: 'Bulbasaur', types: ['Grass'] }]);
    fixture.types = TYPES_CSV.replace(/^\d+,fairy,.*\n/m, '');
    expect(() => parsePokeApiSpecies(fixture)).toThrow(/no "Fairy" row/);
  });
});

// ——— game master ———

const typeEnum = (type: string) => `POKEMON_TYPE_${type.toUpperCase()}`;
const pad = (id: number) => String(id).padStart(4, '0');

/** `tradable` mirrors the real file: the flag is written as `true` on a tradable template and left OUT, never
 *  `false`, on an untradable one. Most fixtures are ordinary tradable species. */
function pokemonTemplate(
  id: number,
  enumName: string,
  form: string | undefined,
  types: string[],
  tempEvoOverrides?: { tempEvoId?: string; typeOverride1?: string; typeOverride2?: string }[],
  tradable = true,
): GameMasterTemplate {
  return {
    templateId: `V${pad(id)}_POKEMON_${form ?? enumName}`,
    data: {
      pokemonSettings: {
        pokemonId: enumName,
        ...(form ? { form } : {}),
        type: typeEnum(types[0]),
        ...(types[1] ? { type2: typeEnum(types[1]) } : {}),
        ...(tradable ? { isTradable: true } : {}),
        ...(tempEvoOverrides ? { tempEvoOverrides } : {}),
      },
    },
  };
}

/** A form entry is its enum, or `[enum, true]` for one the game master flags `isCostume`. */
type FormSpec = string | readonly [form: string, isCostume: true];
const formsTemplate = (id: number, enumName: string, forms: FormSpec[]): GameMasterTemplate => ({
  templateId: `FORMS_V${pad(id)}_POKEMON_${enumName}`,
  data: {
    formSettings: {
      pokemon: enumName,
      forms: forms.map((spec) => (typeof spec === 'string' ? { form: spec } : { form: spec[0], isCostume: true })),
    },
  },
});

/** Zacian as the real game master has it: the FORMLESS template carries the Crowned Sword typing. */
const ZACIAN: GameMasterTemplate[] = [
  pokemonTemplate(888, 'ZACIAN', undefined, ['Fairy', 'Steel']),
  pokemonTemplate(888, 'ZACIAN', 'ZACIAN_HERO', ['Fairy']),
  pokemonTemplate(888, 'ZACIAN', 'ZACIAN_CROWNED_SWORD', ['Fairy', 'Steel'], undefined, false), // no isTradable, as in the real file
  formsTemplate(888, 'ZACIAN', ['ZACIAN_HERO', 'ZACIAN_CROWNED_SWORD']),
];
const VULPIX: GameMasterTemplate[] = [
  pokemonTemplate(37, 'VULPIX', undefined, ['Fire']),
  pokemonTemplate(37, 'VULPIX', 'VULPIX_NORMAL', ['Fire']),
  pokemonTemplate(37, 'VULPIX', 'VULPIX_ALOLA', ['Ice']),
  formsTemplate(37, 'VULPIX', ['VULPIX_NORMAL', 'VULPIX_ALOLA']),
];
const CHARIZARD_EVOS = [
  { tempEvoId: 'TEMP_EVOLUTION_MEGA_X', typeOverride1: typeEnum('Fire'), typeOverride2: typeEnum('Dragon') },
  { tempEvoId: 'TEMP_EVOLUTION_MEGA_Y', typeOverride1: typeEnum('Fire'), typeOverride2: typeEnum('Flying') },
  {}, // a camera-only entry, as the real file has: no tempEvoId, no typing
];
const CHARIZARD: GameMasterTemplate[] = [
  pokemonTemplate(6, 'CHARIZARD', undefined, ['Fire', 'Flying'], CHARIZARD_EVOS),
  pokemonTemplate(6, 'CHARIZARD', 'CHARIZARD_NORMAL', ['Fire', 'Flying'], CHARIZARD_EVOS),
  formsTemplate(6, 'CHARIZARD', ['CHARIZARD_NORMAL', 'CHARIZARD_COPY_2019']), // as the real file: the game master does not flag COPY_2019
];

const species = (id: number, name: string, types: PokemonTypes): SpeciesRow => ({ id, name, types });
const ZACIAN_ROW = species(888, 'Zacian', ['Fairy']);
const PALKIA_ROW = species(484, 'Palkia', ['Water', 'Dragon']);
const VULPIX_ROW = species(37, 'Vulpix', ['Fire']);
const CHARIZARD_ROW = species(6, 'Charizard', ['Fire', 'Flying']);

/** The app's real untradable rules, as the CLI passes them. */
const RULES: TradabilityRules = { isUntradable: isPokemonUntradable, formCombinations: UNTRADABLE_FORM_COMBINATIONS };

describe('parseGameMaster', () => {
  it('collects formless, form and temp-evolution typing per species', () => {
    const zacian = parseGameMaster(ZACIAN).get(888)!;
    expect(zacian.enumName).toBe('ZACIAN');
    expect(zacian.bare).toEqual(['Fairy', 'Steel']);
    expect(zacian.forms.get('ZACIAN_HERO')).toEqual(['Fairy']);
    expect(zacian.forms.get('ZACIAN_CROWNED_SWORD')).toEqual(['Fairy', 'Steel']);
    expect(zacian.defaultForm).toBe('ZACIAN_HERO');

    const charizard = parseGameMaster(CHARIZARD).get(6)!;
    expect([...charizard.tempEvos]).toEqual([
      ['MEGA_X', ['Fire', 'Dragon']],
      ['MEGA_Y', ['Fire', 'Flying']],
    ]);
  });

  it('reads isTradable per template, and treats an absent flag as untradable', () => {
    const zacian = parseGameMaster(ZACIAN).get(888)!;
    expect(zacian.bareTradable).toBe(true);
    expect(zacian.formTradable.get('ZACIAN_HERO')).toBe(true);
    expect(zacian.formTradable.get('ZACIAN_CROWNED_SWORD')).toBe(false); // the template has no flag
    expect([...zacian.formTradable.keys()]).toEqual([...zacian.forms.keys()]); // one verdict per form template
    const mew = parseGameMaster([pokemonTemplate(151, 'MEW', undefined, ['Psychic'], undefined, false)]).get(151)!;
    expect(mew.bareTradable).toBe(false);
  });

  it('ignores everything that is not a Pokémon template', () => {
    const noise: GameMasterTemplate[] = [
      { templateId: 'SPAWN_V0888_POKEMON_ZACIAN', data: {} },
      { templateId: 'COMBAT_V0013_MOVE_X', data: {} },
      { templateId: 'EXTENDED_V0902_POKEMON_BASCULEGION', data: {} },
      { templateId: 'FORMS_V0902_POKEMON_BASCULEGION', data: { formSettings: { forms: [{ form: 'BASCULEGION_NORMAL' }] } } },
    ];
    const gm = parseGameMaster([...noise, ...ZACIAN]);
    expect([...gm.keys()]).toEqual([888]); // a species with only stubs (Basculegion) has no entry
  });

  it('reads a default form from the first-listed form, and the formless template when there is no list', () => {
    const gm = parseGameMaster([...ZACIAN, pokemonTemplate(25, 'PIKACHU', undefined, ['Electric'])]);
    expect(gameMasterDefaultTypes(gm.get(888)!)).toEqual({ types: ['Fairy'], via: 'form' });
    expect(gameMasterDefaultTypes(gm.get(25)!)).toEqual({ types: ['Electric'], via: 'formless' });
  });

  it('refuses a type it does not know, a second formless template and a contradictory repeat', () => {
    const bad = pokemonTemplate(1, 'BULBASAUR', undefined, ['Grass']);
    bad.data!.pokemonSettings!.type = 'POKEMON_TYPE_STELLAR';
    expect(() => parseGameMaster([bad])).toThrow(/unknown type POKEMON_TYPE_STELLAR/);

    const twin = pokemonTemplate(1, 'BULBASAUR', undefined, ['Grass']);
    expect(() => parseGameMaster([twin, { ...twin }])).toThrow(/second formless template/);

    const evo = (type: string) => [{ tempEvoId: 'TEMP_EVOLUTION_MEGA', typeOverride1: typeEnum(type) }];
    expect(() =>
      parseGameMaster([
        pokemonTemplate(3, 'VENUSAUR', undefined, ['Grass'], evo('Grass')),
        pokemonTemplate(3, 'VENUSAUR', 'VENUSAUR_NORMAL', ['Grass'], evo('Fire')),
      ]),
    ).toThrow(/TEMP_EVOLUTION_MEGA has two different typings/);
  });
});

// ——— sprite listing + form codes ———

describe('parseAssetFormTokens', () => {
  it('collects form tokens per species and nothing else', () => {
    const tokens = parseAssetFormTokens([
      'pm888.fCROWNED_SWORD.icon.png',
      'pm888.fCROWNED_SWORD.s.icon.png',
      'pm888.fHERO.icon.png',
      'pm1.cJAN_2020_NOEVOLVE.icon.png', // a costume, not a form
      'pm1.fFALL_2019.cJAN_2020_NOEVOLVE.icon.png', // a form + costume pair is the costume's art
      'pm19.fALOLA.g2.icon.png',
      'pm1.icon.png',
      'pm1.portrait.png',
      'README.md',
    ]);
    expect(tokens.get(888)).toEqual(new Set(['CROWNED_SWORD', 'HERO']));
    expect(tokens.get(19)).toEqual(new Set(['ALOLA']));
    expect(tokens.has(1)).toBe(false);
  });

  it('reads filenames the same way scripts/pokeminers.ts does', () => {
    const names = [
      'pm888.fCROWNED_SWORD.s.icon.png',
      'pm201.fUNOWN_A.icon.png',
      'pm1.cJAN_2020_NOEVOLVE.icon.png',
      'pm1.fFALL_2019.cJAN_2020_NOEVOLVE.s.icon.png',
      'pm19.fALOLA.g2.s.icon.png',
      'pm479.f.icon.png', // really exists upstream, with an empty form token
      'pm25.icon.png',
      'pm25.portrait.png',
    ];
    for (const name of names) {
      const parsed = parsePokeMinersIcon(name);
      const expected = parsed?.form && !parsed.costume ? [parsed.form] : [];
      const ours = [...(parseAssetFormTokens([name]).get(parsed?.pokemonId ?? -1) ?? [])];
      expect(ours, name).toEqual(expected);
    }
  });
});

describe('resolveFormCode', () => {
  const tokens = (...t: string[]) => new Set(t);

  it('drops the species prefix, the convention for most forms', () => {
    expect(resolveFormCode('ZACIAN', 'ZACIAN_CROWNED_SWORD', tokens('CROWNED_SWORD'))).toEqual({ code: 'CROWNED_SWORD', confirmed: true });
    expect(resolveFormCode('MR_MIME', 'MR_MIME_GALARIAN', tokens('GALARIAN'))).toEqual({ code: 'GALARIAN', confirmed: true });
  });

  it('keeps the whole enum where the sprite art does (Wormadam, Unown, Burmy)', () => {
    expect(resolveFormCode('WORMADAM', 'WORMADAM_SANDY', tokens('WORMADAM_SANDY'))).toEqual({ code: 'WORMADAM_SANDY', confirmed: true });
  });

  it('uses the convention, unconfirmed, when no art exists to say otherwise', () => {
    expect(resolveFormCode('SILVALLY', 'SILVALLY_FIRE', undefined)).toEqual({ code: 'FIRE', confirmed: false });
    expect(resolveFormCode('SILVALLY', 'SILVALLY_FIRE', tokens('GIGANTAMAX'))).toEqual({ code: 'FIRE', confirmed: false });
  });

  it('keeps a form enum that does not start with the species enum (Nidoran)', () => {
    expect(resolveFormCode('NIDORAN_FEMALE', 'NIDORAN_NORMAL', undefined)).toEqual({ code: 'NIDORAN_NORMAL', confirmed: false });
  });

  it('refuses an ambiguous spelling and one the database would reject', () => {
    expect(() => resolveFormCode('WORMADAM', 'WORMADAM_SANDY', tokens('SANDY', 'WORMADAM_SANDY'))).toThrow(/ambiguous/);
    expect(() => resolveFormCode('FOO', 'FOO_bar', undefined)).toThrow(/not a valid form code/);
  });
});

// ——— assembly ———

describe('buildPokedexData', () => {
  const build = (rows: SpeciesRow[], templates: GameMasterTemplate[], files: string[] = []) =>
    buildPokedexData({
      species: rows,
      gameMaster: parseGameMaster(templates),
      gameMasterForms: parseGameMasterForms(templates),
      assetTokens: parseAssetFormTokens(files),
      baseFormCodes: {},
      tradabilityRules: RULES,
    });

  it('records only forms whose typing differs from the species default', () => {
    const { overrides } = build([ZACIAN_ROW], ZACIAN, ['pm888.fHERO.icon.png', 'pm888.fCROWNED_SWORD.icon.png']);
    expect(overrides).toEqual([{ pokemonId: 888, formCode: 'CROWNED_SWORD', types: ['Fairy', 'Steel'], confirmed: true }]);
  });

  it('keeps a form that DROPS a type (Alolan Vulpix is Ice, not Fire/Ice)', () => {
    const { overrides } = build([VULPIX_ROW], VULPIX, ['pm37.fALOLA.icon.png']);
    expect(overrides).toEqual([{ pokemonId: 37, formCode: 'ALOLA', types: ['Ice'], confirmed: true }]);
  });

  it('reads Mega forms from tempEvoOverrides, and drops the one that keeps the species typing', () => {
    const { overrides, report } = build([CHARIZARD_ROW], CHARIZARD, ['pm6.fMEGA_X.icon.png', 'pm6.fMEGA_Y.icon.png']);
    expect(overrides).toEqual([{ pokemonId: 6, formCode: 'MEGA_X', types: ['Fire', 'Dragon'], confirmed: true }]);
    expect(report.overridesFromTempEvolutions).toBe(1);
    expect(report.overridesFromForms).toBe(0);
  });

  it('flags a spelling with no art, rather than dropping or silently trusting it', () => {
    const templates = [
      pokemonTemplate(773, 'SILVALLY', undefined, ['Normal']),
      pokemonTemplate(773, 'SILVALLY', 'SILVALLY_FIRE', ['Fire']),
      formsTemplate(773, 'SILVALLY', ['SILVALLY_NORMAL', 'SILVALLY_FIRE']),
    ];
    const { overrides } = build([species(773, 'Silvally', ['Normal'])], templates);
    expect(overrides).toEqual([{ pokemonId: 773, formCode: 'FIRE', types: ['Fire'], confirmed: false }]);
  });

  it('resolves Wormadam to the art spelling', () => {
    const templates = [
      pokemonTemplate(413, 'WORMADAM', undefined, ['Bug', 'Grass']),
      pokemonTemplate(413, 'WORMADAM', 'WORMADAM_PLANT', ['Bug', 'Grass']),
      pokemonTemplate(413, 'WORMADAM', 'WORMADAM_SANDY', ['Bug', 'Ground']),
      formsTemplate(413, 'WORMADAM', ['WORMADAM_PLANT', 'WORMADAM_SANDY']),
    ];
    const files = ['pm413.fWORMADAM_PLANT.icon.png', 'pm413.fWORMADAM_SANDY.icon.png'];
    expect(build([species(413, 'Wormadam', ['Bug', 'Grass'])], templates, files).overrides).toEqual([
      { pokemonId: 413, formCode: 'WORMADAM_SANDY', types: ['Bug', 'Ground'], confirmed: true },
    ]);
  });

  it('sorts overrides by species, then form code', () => {
    const { overrides } = build([VULPIX_ROW, ZACIAN_ROW], [...ZACIAN, ...VULPIX]);
    expect(overrides.map((o) => `${o.pokemonId}:${o.formCode}`)).toEqual(['37:ALOLA', '888:CROWNED_SWORD']);
  });

  it('agrees on Zacian despite the formless template: the default is read from the first form', () => {
    const { report } = build([ZACIAN_ROW], ZACIAN);
    expect(report.disagreements).toEqual([]);
    expect(report.formlessDisagreements).toEqual([{ pokemonId: 888, name: 'Zacian', pokeApi: ['Fairy'], gameMaster: ['Fairy', 'Steel'] }]);
  });

  it('REPORTS a default-typing disagreement between the sources instead of picking one', () => {
    const { report, overrides } = build([species(37, 'Vulpix', ['Water'])], VULPIX);
    expect(report.disagreements).toEqual([{ pokemonId: 37, name: 'Vulpix', pokeApi: ['Water'], gameMaster: ['Fire'] }]);
    expect(overrides.length).toBeGreaterThan(0); // the caller, not this function, decides to refuse
  });

  it('treats the same types in a different order as a disagreement', () => {
    const { report } = build([species(6, 'Charizard', ['Flying', 'Fire'])], CHARIZARD);
    expect(report.disagreements).toHaveLength(1);
  });

  it('names species the game master has no typing for, and gives them no overrides', () => {
    const { report, overrides } = build([species(902, 'Basculegion', ['Water', 'Ghost']), VULPIX_ROW], VULPIX);
    expect(report.missingFromGameMaster).toEqual([{ pokemonId: 902, name: 'Basculegion' }]);
    expect(report.gameMasterSpecies).toBe(1);
    expect(overrides.every((o) => o.pokemonId !== 902)).toBe(true);
  });

  it('lists sprite form tokens that have no game master typing', () => {
    const { report } = build([VULPIX_ROW], VULPIX, ['pm37.fALOLA.icon.png', 'pm37.fGIGANTAMAX.icon.png']);
    expect(report.assetFormsWithoutTypes).toEqual([{ pokemonId: 37, token: 'GIGANTAMAX' }]);
  });

  it('refuses two game master forms that collapse to one code with different typing', () => {
    const templates = [
      pokemonTemplate(37, 'VULPIX', undefined, ['Fire']),
      pokemonTemplate(37, 'VULPIX', 'VULPIX_ALOLA', ['Ice']),
      pokemonTemplate(37, 'VULPIX', 'ALOLA', ['Water']), // no species prefix to strip, so it IS `ALOLA`
    ];
    expect(() => build([VULPIX_ROW], templates)).toThrow(/collapse to one code/);
  });
});

// ——— form catalog ———

describe('parseGameMasterForms', () => {
  it('keeps each species list in the game master order, with the isCostume flag', () => {
    const lists = parseGameMasterForms([formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', ['MEWTWO_A', true]])]);
    expect(lists.get(150)).toEqual({
      enumName: 'MEWTWO',
      forms: [
        { form: 'MEWTWO_NORMAL', isCostume: false },
        { form: 'MEWTWO_A', isCostume: true },
      ],
    });
  });

  it('reads a list for a species that has no pokemonSettings (Basculegion) and tolerates a missing forms array', () => {
    const lists = parseGameMasterForms([
      formsTemplate(902, 'BASCULEGION', ['BASCULEGION_MALE', 'BASCULEGION_FEMALE']),
      { templateId: 'FORMS_V0001_POKEMON_BULBASAUR', data: { formSettings: { pokemon: 'BULBASAUR' } } },
      { templateId: 'V0902_POKEMON_X', data: {} }, // not a form list
    ]);
    expect(lists.get(902)?.forms.map((f) => f.form)).toEqual(['BASCULEGION_MALE', 'BASCULEGION_FEMALE']);
    expect(lists.get(1)).toEqual({ enumName: 'BULBASAUR', forms: [] });
    expect(lists.size).toBe(2);
  });

  it('refuses a repeated list, a repeated form, a nameless form and a list with no species', () => {
    expect(() => parseGameMasterForms([formsTemplate(37, 'VULPIX', ['A']), formsTemplate(37, 'VULPIX', ['A'])])).toThrow(/second form list/);
    expect(() => parseGameMasterForms([formsTemplate(37, 'VULPIX', ['VULPIX_ALOLA', 'VULPIX_ALOLA'])])).toThrow(/listed twice/);
    const nameless = formsTemplate(37, 'VULPIX', []);
    nameless.data!.formSettings!.forms = [{}];
    expect(() => parseGameMasterForms([nameless])).toThrow(/no name/);
    expect(() => parseGameMasterForms([{ templateId: 'FORMS_V0037_POKEMON_VULPIX', data: { formSettings: {} } }])).toThrow(/no species enum/);
  });
});

describe('buildFormCatalog', () => {
  /** One species per call, with real-shaped form lists. */
  const catalog = (
    rows: SpeciesRow[],
    lists: GameMasterTemplate[],
    files: string[] = [],
    baseFormCodes: Record<number, string> = {},
  ) =>
    buildFormCatalog({
      species: rows,
      gameMasterForms: parseGameMasterForms(lists),
      assetTokens: parseAssetFormTokens(files),
      baseFormCodes,
    });
  const codes = (result: ReturnType<typeof catalog>, pokemonId: number) =>
    result.entries.find((e) => e.pokemonId === pokemonId)?.forms.map((f) => f.code);

  const PALKIA = species(484, 'Palkia', ['Water', 'Dragon']);
  const MEWTWO = species(150, 'Mewtwo', ['Psychic']);

  it('offers the non-default forms and not the default, which formCode: null already means', () => {
    const result = catalog([PALKIA], [formsTemplate(484, 'PALKIA', ['PALKIA_NORMAL', 'PALKIA_ORIGIN'])], ['pm484.fORIGIN.icon.png']);
    expect(result.entries).toEqual([{ pokemonId: 484, defaultCode: null, forms: [{ code: 'ORIGIN', confirmed: true }] }]);
  });

  it('offers a form whose typing is the species typing (Origin Palkia, Armored Mewtwo): the overrides table cannot', () => {
    const result = catalog([MEWTWO], [formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', ['MEWTWO_A', true]])]);
    expect(codes(result, 150)).toEqual(['A']);
  });

  it('names a default that has a name of its own (Zacian is Hero), and still excludes it from the list', () => {
    const result = catalog([ZACIAN_ROW], ZACIAN, ['pm888.fHERO.icon.png', 'pm888.fCROWNED_SWORD.icon.png']);
    expect(result.entries).toEqual([
      { pokemonId: 888, defaultCode: 'HERO', forms: [{ code: 'CROWNED_SWORD', confirmed: true }] },
    ]);
  });

  it('keeps the game master order, which is not alphabetical', () => {
    const rotom = formsTemplate(479, 'ROTOM', ['ROTOM_NORMAL', 'ROTOM_HEAT', 'ROTOM_WASH', 'ROTOM_FROST', 'ROTOM_FAN', 'ROTOM_MOW']);
    expect(codes(catalog([species(479, 'Rotom', ['Electric', 'Ghost'])], [rotom]), 479)).toEqual(['HEAT', 'WASH', 'FROST', 'FAN', 'MOW']);
  });

  it('takes the default from BASE_FORM_CODES over the first-listed form, so the first-listed one stays selectable', () => {
    // The real game master lists UNOWN_F first; the sprite pipeline's base form is UNOWN_A.
    const unown = formsTemplate(201, 'UNOWN', ['UNOWN_F', 'UNOWN_A', 'UNOWN_B']);
    const files = ['pm201.fUNOWN_F.icon.png', 'pm201.fUNOWN_A.icon.png', 'pm201.fUNOWN_B.icon.png'];
    const result = catalog([species(201, 'Unown', ['Psychic'])], [unown], files, { 201: 'UNOWN_A' });
    expect(result.entries[0].defaultCode).toBe('UNOWN_A');
    expect(codes(result, 201)).toEqual(['UNOWN_F', 'UNOWN_B']);
    expect(result.report.defaultsFromBaseTable).toEqual([{ pokemonId: 201, code: 'UNOWN_A', gameMasterFirst: 'UNOWN_F' }]);
    // Without the table the first-listed form would be the default.
    expect(codes(catalog([species(201, 'Unown', ['Psychic'])], [unown], files), 201)).toEqual(['UNOWN_A', 'UNOWN_B']);
  });

  it('reports, fatally, a BASE_FORM_CODES default the game master does not list', () => {
    const result = catalog([PALKIA], [formsTemplate(484, 'PALKIA', ['PALKIA_NORMAL', 'PALKIA_ORIGIN'])], [], { 484: 'ALTERED' });
    expect(result.report.baseTableConflicts).toEqual([{ pokemonId: 484, code: 'ALTERED' }]);
    expect(codes(result, 484)).toEqual(['ORIGIN']); // falls back to the first-listed default meanwhile
  });

  it('leaves out event costumes (the isCostume flag) and says which', () => {
    const pikachu = formsTemplate(25, 'PIKACHU', ['PIKACHU_NORMAL', ['PIKACHU_FALL_2019', true], 'PIKACHU_COPY_2019', ['PIKACHU_VS_2019', true]]);
    const result = catalog([species(25, 'Pikachu', ['Electric'])], [pikachu]);
    expect(codes(result, 25)).toBeUndefined(); // COPY_2019 is not flagged, but UNFLAGGED_COSTUME_FORMS_EXCLUDED names it
    expect(result.report.excludedCostumes).toEqual([
      { pokemonId: 25, code: 'FALL_2019' },
      { pokemonId: 25, code: 'VS_2019' },
    ]);
    expect(result.report.excludedUnflaggedCostumes).toEqual([{ pokemonId: 25, code: 'COPY_2019' }]);
  });

  describe('event forms the game master does not flag (UNFLAGGED_COSTUME_FORMS_EXCLUDED)', () => {
    const PSYDUCK = species(54, 'Psyduck', ['Water']);
    const BULBASAUR = species(1, 'Bulbasaur', ['Grass', 'Poison']);

    it('names COPY_2019 on the three starters and Pikachu, and SWIM_2025 on Psyduck, species by species', () => {
      expect([...UNFLAGGED_COSTUME_FORMS_EXCLUDED].map(([id, set]) => [id, [...set]])).toEqual([
        [3, ['COPY_2019']],
        [6, ['COPY_2019']],
        [9, ['COPY_2019']],
        [25, ['COPY_2019']],
        [54, ['SWIM_2025']],
      ]);
    });

    it('leaves each one out and reports it, as the species had no other selectable form', () => {
      const result = catalog(
        [CHARIZARD_ROW, PSYDUCK],
        [...CHARIZARD, formsTemplate(54, 'PSYDUCK', ['PSYDUCK_NORMAL', 'PSYDUCK_SWIM_2025'])],
      );
      expect(result.entries).toEqual([]);
      expect(result.report.excludedUnflaggedCostumes).toEqual([
        { pokemonId: 6, code: 'COPY_2019' },
        { pokemonId: 54, code: 'SWIM_2025' },
      ]);
      expect(result.report.speciesWithSeveralForms).toBe(2); // they have two forms in the game master, so they are counted
    });

    it('leaves out only the named form: the species keeps its other forms', () => {
      // Not a real list (Psyduck has no other form); it shows the exclusion removes one code, not the species.
      const result = catalog([PSYDUCK], [formsTemplate(54, 'PSYDUCK', ['PSYDUCK_NORMAL', 'PSYDUCK_SWIM_2025', 'PSYDUCK_ALOLA'])]);
      expect(codes(result, 54)).toEqual(['ALOLA']);
    });

    it('is scoped to the species: the same code on a species not listed is still a form', () => {
      // Hypothetical (no such Bulbasaur form exists upstream). A global code set would swallow it silently; the
      // species-scoped table leaves it in the output, where the generated diff shows it for review.
      const result = catalog([BULBASAUR], [formsTemplate(1, 'BULBASAUR', ['BULBASAUR_NORMAL', 'BULBASAUR_COPY_2019'])]);
      expect(codes(result, 1)).toEqual(['COPY_2019']);
      expect(result.report.excludedUnflaggedCostumes).toEqual([]);
    });

    it('throws when an entry no longer matches a form, so the table cannot go stale', () => {
      const stale = /UNFLAGGED_COSTUME_FORMS_EXCLUDED/;
      // The form was renamed or removed from the species' list...
      expect(() => catalog([CHARIZARD_ROW], [formsTemplate(6, 'CHARIZARD', ['CHARIZARD_NORMAL', 'CHARIZARD_GOGGLES_2026'])])).toThrow(stale);
      // ...the list shrank to one form, or the species lost its list altogether...
      expect(() => catalog([CHARIZARD_ROW], [formsTemplate(6, 'CHARIZARD', ['CHARIZARD_NORMAL'])])).toThrow(stale);
      expect(() => catalog([CHARIZARD_ROW], [])).toThrow(stale);
      // ...or the entry names the species' DEFAULT form, which is never listed anyway.
      expect(() => catalog([CHARIZARD_ROW], [formsTemplate(6, 'CHARIZARD', ['CHARIZARD_COPY_2019', 'CHARIZARD_NORMAL'])])).toThrow(stale);
    });

    it('throws once the game master flags the form isCostume: the entry is then redundant', () => {
      expect(() => catalog([CHARIZARD_ROW], [formsTemplate(6, 'CHARIZARD', ['CHARIZARD_NORMAL', ['CHARIZARD_COPY_2019', true]])])).toThrow(/remove the entry/);
    });

    it('does not complain about a species that is not in the input (a fixture with a few species)', () => {
      expect(() => catalog([VULPIX_ROW], VULPIX)).not.toThrow();
    });
  });

  it('keeps Armored Mewtwo although the game master flags it a costume, and says so', () => {
    expect(COSTUME_FORMS_KEPT_AS_FORMS.get(150)).toEqual(new Set(['A']));
    const result = catalog([MEWTWO], [formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', ['MEWTWO_A', true]])]);
    expect(result.report.keptCostumes).toEqual([{ pokemonId: 150, code: 'A' }]);
    expect(result.report.excludedCostumes).toEqual([]);
  });

  it('throws when a kept costume is no longer a flagged form, so the table cannot go stale', () => {
    expect(() => catalog([MEWTWO], [formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', 'MEWTWO_A'])])).toThrow(/COSTUME_FORMS_KEPT_AS_FORMS/);
    expect(() => catalog([MEWTWO], [formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', 'MEWTWO_B'])])).toThrow(/COSTUME_FORMS_KEPT_AS_FORMS/);
  });

  it('leaves out the shadow marker and _SHADOW / _PURIFIED codes, but not a form that merely contains the word', () => {
    expect(SHADOW_MARKER_CODES).toEqual(new Set(['S']));
    const raikou = formsTemplate(243, 'RAIKOU', ['RAIKOU_NORMAL', 'RAIKOU_S']);
    const mon = formsTemplate(10, 'CATERPIE', ['CATERPIE_NORMAL', 'CATERPIE_SHADOW', 'CATERPIE_PURIFIED']);
    const calyrex = formsTemplate(898, 'CALYREX', ['CALYREX_NORMAL', 'CALYREX_ICE_RIDER', 'CALYREX_SHADOW_RIDER']);
    const unown = formsTemplate(201, 'UNOWN', ['UNOWN_A', 'UNOWN_S']);
    const result = catalog(
      [species(10, 'Caterpie', ['Bug']), species(201, 'Unown', ['Psychic']), species(243, 'Raikou', ['Electric']), species(898, 'Calyrex', ['Psychic', 'Grass'])],
      [raikou, mon, calyrex, unown],
      ['pm201.fUNOWN_A.icon.png', 'pm201.fUNOWN_S.icon.png'], // the art is what says Unown keeps its prefix
    );
    expect(result.entries.map((e) => e.pokemonId)).toEqual([201, 898]); // Caterpie and Raikou have nothing left
    expect(codes(result, 898)).toEqual(['ICE_RIDER', 'SHADOW_RIDER']);
    expect(codes(result, 201)).toEqual(['UNOWN_S']); // a letter, with its species prefix: not the marker
    expect(result.report.excludedStatus).toEqual([
      { pokemonId: 10, code: 'SHADOW' },
      { pokemonId: 10, code: 'PURIFIED' },
      { pokemonId: 243, code: 'S' },
    ]);
  });

  it('never offers Mega, Primal or Gigantamax: they are not in the form lists', () => {
    // Charizard's real list is [NORMAL, COPY_2019]; Mega X/Y exist only as tempEvoOverrides.
    const result = catalog([CHARIZARD_ROW], CHARIZARD, ['pm6.fMEGA_X.icon.png', 'pm6.fGIGANTAMAX.icon.png']);
    expect(result.entries).toEqual([]);
  });

  it('offers a form once when two game master forms collapse to one spelling', () => {
    const gastrodon = formsTemplate(423, 'GASTRODON', ['GASTRODON_WEST_SEA', 'GASTRODON_EAST_SEA', 'EAST_SEA']);
    expect(codes(catalog([species(423, 'Gastrodon', ['Water', 'Ground'])], [gastrodon], ['pm423.fEAST_SEA.icon.png']), 423)).toEqual(['EAST_SEA']);
  });

  it('skips species with no list, one form, or nothing selectable, and counts those with several', () => {
    const result = catalog(
      [VULPIX_ROW, CHARIZARD_ROW, species(1, 'Bulbasaur', ['Grass', 'Poison']), species(5, 'Charmeleon', ['Fire'])],
      [...VULPIX, ...CHARIZARD, formsTemplate(1, 'BULBASAUR', ['BULBASAUR_NORMAL'])],
    );
    // Charmeleon has no list, Bulbasaur one form, Charizard two of which the only non-default is excluded.
    expect(result.entries.map((e) => e.pokemonId)).toEqual([37]);
    expect(result.report.speciesWithSeveralForms).toBe(2); // Vulpix and Charizard
  });

  it('flags a spelling with no sprite art as unconfirmed, and keeps it', () => {
    const silvally = formsTemplate(773, 'SILVALLY', ['SILVALLY_NORMAL', 'SILVALLY_FIRE']);
    expect(catalog([species(773, 'Silvally', ['Normal'])], [silvally]).entries[0].forms).toEqual([{ code: 'FIRE', confirmed: false }]);
  });

  it('puts species in id order whatever order the lists arrive in', () => {
    const result = catalog([VULPIX_ROW, ZACIAN_ROW], [...ZACIAN, ...VULPIX], ['pm37.fALOLA.icon.png']);
    expect(result.entries.map((e) => e.pokemonId)).toEqual([37, 888]);
  });
});

describe('buildPokedexData and the form catalog', () => {
  it('refuses a species whose form list and species template disagree about the enum', () => {
    const templates = [pokemonTemplate(37, 'VULPIX', undefined, ['Fire']), formsTemplate(37, 'NINETALES', ['NINETALES_NORMAL'])];
    expect(() =>
      buildPokedexData({
        species: [VULPIX_ROW],
        gameMaster: parseGameMaster(templates),
        gameMasterForms: parseGameMasterForms(templates),
        assetTokens: new Map(),
        baseFormCodes: {},
        tradabilityRules: RULES,
      }),
    ).toThrow(/form list says NINETALES but the species template says VULPIX/);
  });

  it('is consistent with the override table: a typed non-Mega form is offered, so its typing is reachable', () => {
    const templates = [...VULPIX, ...ZACIAN];
    const data = buildPokedexData({
      species: [VULPIX_ROW, ZACIAN_ROW],
      gameMaster: parseGameMaster(templates),
      gameMasterForms: parseGameMasterForms(templates),
      assetTokens: parseAssetFormTokens(['pm37.fALOLA.icon.png', 'pm888.fCROWNED_SWORD.icon.png']),
      baseFormCodes: {},
      tradabilityRules: RULES,
    });
    for (const o of data.overrides) {
      expect(data.forms.find((e) => e.pokemonId === o.pokemonId)?.forms.map((f) => f.code), `${o.pokemonId}:${o.formCode}`).toContain(o.formCode);
    }
  });

  it('reads BASE_FORM_CODES from a leaf module: the generator must run even when the generated data is stale', () => {
    const source = readFileSync(path.resolve(__dirname, '..', 'constants', 'base-form-codes.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(BASE_FORM_CODES[201]).toBe('UNOWN_A');
  });
});

// ——— tradability cross-check ———

describe('checkTradability', () => {
  const check = (rows: SpeciesRow[], templates: GameMasterTemplate[], files: string[] = [], rules: TradabilityRules = RULES) =>
    checkTradability({ species: rows, gameMaster: parseGameMaster(templates), assetTokens: parseAssetFormTokens(files), rules });

  const MEW = species(151, 'Mew', ['Psychic']);
  const PECHARUNT = species(1025, 'Pecharunt', ['Poison', 'Ghost']);
  const NECROZMA = species(800, 'Necrozma', ['Psychic']);
  const ETERNATUS = species(890, 'Eternatus', ['Poison', 'Dragon']);
  const mew = (tradable: boolean) => [
    pokemonTemplate(151, 'MEW', undefined, ['Psychic'], undefined, tradable),
    pokemonTemplate(151, 'MEW', 'MEW_NORMAL', ['Psychic'], undefined, tradable),
  ];
  const pecharunt = (tradable: boolean) => [
    pokemonTemplate(1025, 'PECHARUNT', undefined, ['Poison', 'Ghost'], undefined, tradable),
    pokemonTemplate(1025, 'PECHARUNT', 'PECHARUNT_NORMAL', ['Poison', 'Ghost'], undefined, tradable),
  ];
  /** Necrozma as the real file has it: the base and Normal tradable, the fused and Ultra forms not. */
  const necrozma = (ultraTradable = false) => [
    pokemonTemplate(800, 'NECROZMA', undefined, ['Psychic']),
    pokemonTemplate(800, 'NECROZMA', 'NECROZMA_NORMAL', ['Psychic']),
    pokemonTemplate(800, 'NECROZMA', 'NECROZMA_DUSK_MANE', ['Psychic', 'Steel'], undefined, false),
    pokemonTemplate(800, 'NECROZMA', 'NECROZMA_DAWN_WINGS', ['Psychic', 'Ghost'], undefined, false),
    pokemonTemplate(800, 'NECROZMA', 'NECROZMA_ULTRA', ['Psychic', 'Dragon'], undefined, ultraTradable),
  ];

  it('agrees on Zacian: Hero is tradable and Crowned Sword is not, each checked on its own template', () => {
    const report = check([ZACIAN_ROW], ZACIAN, ['pm888.fHERO.icon.png', 'pm888.fCROWNED_SWORD.icon.png']);
    expect(report.disagreements).toEqual([]);
    expect(report.overridden).toEqual([]);
    expect(report.checked).toBe(3); // the default form (formless), HERO, CROWNED_SWORD
  });

  it('agrees on a species untradable whole (Mew, Eternatus) and on Necrozma: base tradable, three forms not', () => {
    expect(check([MEW], mew(false)).disagreements).toEqual([]);
    const eternatus = [
      pokemonTemplate(890, 'ETERNATUS', undefined, ['Poison', 'Dragon'], undefined, false),
      pokemonTemplate(890, 'ETERNATUS', 'ETERNATUS_NORMAL', ['Poison', 'Dragon'], undefined, false),
      pokemonTemplate(890, 'ETERNATUS', 'ETERNATUS_ETERNAMAX', ['Poison', 'Dragon'], undefined, false),
    ];
    expect(check([ETERNATUS], eternatus, ['pm890.fETERNAMAX.icon.png']).disagreements).toEqual([]);
    const result = check([NECROZMA], necrozma());
    expect(result.disagreements).toEqual([]);
    expect(result.checked).toBe(4); // the default form, Dusk Mane, Dawn Wings, Ultra (NORMAL IS the default form)
  });

  it('REPORTS a form the game master calls tradable and the app refuses, per form (Ultra Necrozma)', () => {
    expect(check([NECROZMA], necrozma(true)).disagreements).toEqual([
      { pokemonId: 800, name: 'Necrozma', formCode: 'ULTRA', gameMasterTradable: true },
    ]);
  });

  it('REPORTS a form the game master calls tradable though the rule is silent about it (Crowned Sword)', () => {
    const templates = [
      pokemonTemplate(888, 'ZACIAN', undefined, ['Fairy', 'Steel']),
      pokemonTemplate(888, 'ZACIAN', 'ZACIAN_HERO', ['Fairy']),
      pokemonTemplate(888, 'ZACIAN', 'ZACIAN_CROWNED_SWORD', ['Fairy', 'Steel']), // tradable here
    ];
    const rulesWithoutCrowned: TradabilityRules = {
      isUntradable: (id, code) => isPokemonUntradable(id, code) && !(id === 888 && code === 'CROWNED_SWORD'),
      formCombinations: [],
    };
    expect(check([ZACIAN_ROW], templates, [], rulesWithoutCrowned).disagreements).toEqual([]); // the rule says tradable, the file says tradable
    // ...and with the real rule the same file is a disagreement.
    expect(check([ZACIAN_ROW], templates).disagreements).toEqual([
      { pokemonId: 888, name: 'Zacian', formCode: 'CROWNED_SWORD', gameMasterTradable: true },
    ]);
  });

  it('REPORTS a species the game master calls untradable and the app lets trade', () => {
    expect(check([VULPIX_ROW], [pokemonTemplate(37, 'VULPIX', undefined, ['Fire'], undefined, false)]).disagreements).toEqual([
      { pokemonId: 37, name: 'Vulpix', formCode: null, gameMasterTradable: false },
    ]);
  });

  it('REPORTS the opposite for a Mythical: the game master calls Mew tradable', () => {
    expect(check([MEW], mew(true)).disagreements).toEqual([{ pokemonId: 151, name: 'Mew', formCode: null, gameMasterTradable: true }]);
  });

  it('holds the game master to the rules it is GIVEN, not to a copy of its own', () => {
    const lenient: TradabilityRules = { isUntradable: () => false, formCombinations: [] };
    expect(check([MEW], mew(false), [], lenient).disagreements).toEqual([{ pokemonId: 151, name: 'Mew', formCode: null, gameMasterTradable: false }]);
  });

  describe('the override list', () => {
    it('lists exactly Pecharunt: the game master says tradable, the app says untradable', () => {
      expect(TRADABILITY_OVERRIDES).toEqual([
        { pokemonId: 1025, formCode: null, gameMasterTradable: true, reason: expect.stringContaining('Mythical') },
      ]);
      expect(isPokemonUntradable(1025)).toBe(true);
    });

    it('accepts the listed difference and reports it as overridden, not as a disagreement', () => {
      const report = check([PECHARUNT], pecharunt(true));
      expect(report.disagreements).toEqual([]);
      expect(report.overridden).toEqual([
        { pokemonId: 1025, name: 'Pecharunt', formCode: null, gameMasterTradable: true, reason: TRADABILITY_OVERRIDES[0].reason },
      ]);
      expect(report.checked).toBe(1); // the formless template and PECHARUNT_NORMAL are one entry: the default form
    });

    it('covers only the entry it names: another Pecharunt form the game master calls tradable is a disagreement', () => {
      // Hypothetical form (the pinned file has only PECHARUNT_NORMAL), to show an override is not species-wide.
      const templates = [...pecharunt(true), pokemonTemplate(1025, 'PECHARUNT', 'PECHARUNT_FOO', ['Poison', 'Ghost'])];
      expect(check([PECHARUNT], templates).disagreements).toEqual([
        { pokemonId: 1025, name: 'Pecharunt', formCode: 'FOO', gameMasterTradable: true },
      ]);
    });

    it('THROWS once the game master agrees with the app, so the entry cannot outlive the difference', () => {
      expect(() => check([PECHARUNT], pecharunt(false))).toThrow(/TRADABILITY_OVERRIDES entry #1025/);
      // ...and when the species lost its template altogether.
      expect(() => check([PECHARUNT], [])).toThrow(/TRADABILITY_OVERRIDES entry #1025/);
    });

    it('THROWS when the app stops refusing the creature the entry is about', () => {
      const rules: TradabilityRules = { isUntradable: (id, code) => id !== 1025 && isPokemonUntradable(id, code), formCombinations: [] };
      expect(() => check([PECHARUNT], pecharunt(true), [], rules)).toThrow(/TRADABILITY_OVERRIDES entry #1025/);
    });

    it('is not checked for a species outside the input (a fixture with a few species)', () => {
      expect(() => check([VULPIX_ROW], VULPIX)).not.toThrow();
    });
  });

  it('collapses the formless template and the NORMAL form into the default form, and throws when they contradict', () => {
    const contradiction = [
      pokemonTemplate(37, 'VULPIX', undefined, ['Fire']),
      pokemonTemplate(37, 'VULPIX', 'VULPIX_NORMAL', ['Fire'], undefined, false),
    ];
    expect(() => check([VULPIX_ROW], contradiction)).toThrow(/contradicts itself about the default form/);
  });

  it('names species the game master has no template for, without failing them (Basculegion)', () => {
    const report = check([species(902, 'Basculegion', ['Water', 'Ghost']), VULPIX_ROW], VULPIX);
    expect(report.unchecked).toEqual([{ pokemonId: 902, name: 'Basculegion' }]);
    expect(report.disagreements).toEqual([]);
  });

  describe('forms the rules name', () => {
    it('reports a rule whose form the game master has no template for (renamed or removed upstream)', () => {
      const withoutUltra = necrozma().filter((t) => !t.templateId.endsWith('_ULTRA'));
      expect(check([NECROZMA], withoutUltra).unmatchedFormRules).toEqual([{ pokemonId: 800, formCode: 'ULTRA' }]);
    });

    it('finds every rule when the templates are there, and ignores rules for species outside the input', () => {
      expect(check([NECROZMA], necrozma()).unmatchedFormRules).toEqual([]);
      expect(check([VULPIX_ROW], VULPIX).unmatchedFormRules).toEqual([]); // Kyurem, Zacian, ... are not in this fixture
    });

    it('matches the app spelling: a template named like the species prefix resolves through the sprite art', () => {
      // Zacian's rule is CROWNED_SWORD; the template is ZACIAN_CROWNED_SWORD.
      expect(check([ZACIAN_ROW], ZACIAN).unmatchedFormRules).toEqual([]);
    });
  });
});

describe('blockingProblems', () => {
  const build = (rows: SpeciesRow[], templates: GameMasterTemplate[], rules: TradabilityRules = RULES) =>
    buildPokedexData({
      species: rows,
      gameMaster: parseGameMaster(templates),
      gameMasterForms: parseGameMasterForms(templates),
      assetTokens: parseAssetFormTokens([]),
      baseFormCodes: {},
      tradabilityRules: rules,
    }).report;

  it('is empty for sources that agree, so the generator may write', () => {
    expect(blockingProblems(build([VULPIX_ROW, ZACIAN_ROW], [...VULPIX, ...ZACIAN]))).toEqual([]);
  });

  it('refuses a tradability disagreement the override list does not cover', () => {
    const problems = blockingProblems(build([species(151, 'Mew', ['Psychic'])], [pokemonTemplate(151, 'MEW', undefined, ['Psychic'])]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/isTradable disagrees with the app's untradable rules .* 1 entry not listed in TRADABILITY_OVERRIDES/);
  });

  it('does NOT refuse the documented override', () => {
    const report = build([species(1025, 'Pecharunt', ['Poison', 'Ghost'])], [pokemonTemplate(1025, 'PECHARUNT', undefined, ['Poison', 'Ghost'])]);
    expect(report.tradability.overridden).toHaveLength(1);
    expect(blockingProblems(report)).toEqual([]);
  });

  it('refuses a rule for a form the game master does not have', () => {
    const rules: TradabilityRules = { ...RULES, formCombinations: [{ pokemonId: 37, formCode: 'GONE' }] };
    expect(blockingProblems(build([VULPIX_ROW], VULPIX, rules))).toEqual([expect.stringMatching(/names 1 form\(s\) the game master has no template for/)]);
  });

  it('refuses the typing and default-form problems it always did', () => {
    expect(blockingProblems(build([species(37, 'Vulpix', ['Water'])], VULPIX))).toEqual([expect.stringMatching(/disagree about 1 species' default typing/)]);
    const base = buildPokedexData({
      species: [species(484, 'Palkia', ['Water', 'Dragon'])],
      gameMaster: new Map(),
      gameMasterForms: parseGameMasterForms([formsTemplate(484, 'PALKIA', ['PALKIA_NORMAL', 'PALKIA_ORIGIN'])]),
      assetTokens: new Map(),
      baseFormCodes: { 484: 'ALTERED' },
      tradabilityRules: RULES,
    }).report;
    expect(blockingProblems(base)).toEqual([expect.stringMatching(/BASE_FORM_CODES .* names 1 default form\(s\)/)]);
  });
});

describe('the generator import graph', () => {
  /** Every module specifier the file imports from. */
  const importsOf = (file: string): string[] =>
    [...readFileSync(path.resolve(__dirname, file), 'utf8').matchAll(/^\s*(?:import|export)\b[^'"\n]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

  it('never reaches the dex or the generated data it replaces, only leaf modules', () => {
    for (const file of ['pokedex-source.ts', 'generate-pokedex.ts']) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(?:^|\/)(?:pokedex|pokedex-data|sprite-url|pokeminers)$/);
      }
    }
    expect(importsOf('generate-pokedex.ts')).toContain('../constants/untradable');
  });

  it('reads the untradable rules from a leaf module, like BASE_FORM_CODES', () => {
    const source = readFileSync(path.resolve(__dirname, '..', 'constants', 'untradable.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(isPokemonUntradable(890, 'ETERNAMAX')).toBe(true);
  });
});

// ——— output ———

describe('renderDataFile', () => {
  const provenance: Provenance = {
    pokeApi: `PokeAPI/pokeapi@${'a'.repeat(40)}`,
    gameMaster: `PokeMiners/game_masters@${'b'.repeat(40)}`,
    spriteAssets: `PokeMiners/pogo_assets@${'c'.repeat(40)}`,
  };
  const text = (rows: SpeciesRow[], templates: GameMasterTemplate[], files: string[] = []) =>
    renderDataFile(
      buildPokedexData({
        species: rows,
        gameMaster: parseGameMaster(templates),
        gameMasterForms: parseGameMasterForms(templates),
        assetTokens: parseAssetFormTokens(files),
        baseFormCodes: {},
        tradabilityRules: RULES,
      }),
      provenance,
    );

  it('writes typed tuple rows, in order, and the override table', () => {
    const out = text([CHARIZARD_ROW, VULPIX_ROW, ZACIAN_ROW], [...CHARIZARD, ...VULPIX, ...ZACIAN], [
      'pm6.fMEGA_X.icon.png',
      'pm37.fALOLA.icon.png',
      'pm888.fCROWNED_SWORD.icon.png',
    ]);
    expect(out).toContain("  [6, 'Charizard', ['Fire', 'Flying']],\n  [37, 'Vulpix', ['Fire']],\n  [888, 'Zacian', ['Fairy']],\n");
    expect(out).toContain("  [6, 'MEGA_X', ['Fire', 'Dragon']],\n  [37, 'ALOLA', ['Ice']],\n  [888, 'CROWNED_SWORD', ['Fairy', 'Steel']],\n");
    expect(out).toContain("import type { PokemonTypes } from './pokemon-types';");
  });

  it('keeps the DO NOT EDIT header, the regenerate command and the exact source commits', () => {
    const out = text([VULPIX_ROW], VULPIX);
    expect(out.startsWith('/**\n * Generated Pokédex data — DO NOT EDIT BY HAND.')).toBe(true);
    expect(out).toContain('`npm run pokedex:generate`');
    for (const source of Object.values(provenance)) expect(out).toContain(source);
  });

  it('is deterministic: rendering twice gives the same bytes (no timestamps)', () => {
    expect(text([VULPIX_ROW], VULPIX)).toBe(text([VULPIX_ROW], VULPIX));
  });

  it('marks an unconfirmed spelling and states the coverage numbers', () => {
    const templates = [
      pokemonTemplate(773, 'SILVALLY', undefined, ['Normal']),
      pokemonTemplate(773, 'SILVALLY', 'SILVALLY_FIRE', ['Fire']),
    ];
    const out = text([species(773, 'Silvally', ['Normal']), species(902, 'Basculegion', ['Water', 'Ghost'])], templates);
    expect(out).toContain("[773, 'FIRE', ['Fire']], // spelling unconfirmed");
    expect(out).toContain('The game master has typing for 1; not for #902 Basculegion');
    expect(out).toContain('1 are marked "spelling unconfirmed"');
  });

  it('writes the form catalog and the named defaults, and documents the rules in the header', () => {
    const out = text([species(150, 'Mewtwo', ['Psychic']), PALKIA_ROW, ZACIAN_ROW], [
      ...ZACIAN,
      formsTemplate(484, 'PALKIA', ['PALKIA_NORMAL', 'PALKIA_ORIGIN']),
      formsTemplate(150, 'MEWTWO', ['MEWTWO_NORMAL', ['MEWTWO_A', true]]),
    ], ['pm484.fORIGIN.icon.png', 'pm888.fCROWNED_SWORD.icon.png', 'pm150.fA.icon.png']);
    expect(out).toContain('export const POKEDEX_FORMS: readonly (readonly [pokemonId: number, formCodes: readonly string[]])[] = [\n');
    expect(out).toContain("  [150, ['A']],\n  [484, ['ORIGIN']],\n  [888, ['CROWNED_SWORD']],\n];");
    expect(out).toContain('export const POKEDEX_DEFAULT_FORMS: readonly (readonly [pokemonId: number, formCode: string])[] = [\n  [888, \'HERO\'],\n];');
    expect(out).toContain('3 selectable forms on 3 species in POKEDEX_FORMS');
    expect(out).toContain('kept as forms: #150 A');
    expect(out).toContain('isCostume');
  });

  it('wraps a long row without losing a code, and says when every spelling is unconfirmed', () => {
    const types = ['FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY'];
    const silvally = formsTemplate(773, 'SILVALLY', ['SILVALLY_NORMAL', ...types.map((t) => `SILVALLY_${t}`)]);
    const out = text([species(773, 'Silvally', ['Normal'])], [silvally]);
    const start = out.indexOf('POKEDEX_FORMS: ');
    const block = out.slice(out.indexOf('= [\n', start), out.indexOf('];', start));
    expect(block.split('\n').length).toBeGreaterThan(3); // wrapped
    expect(block.split('\n').every((line) => line.length <= 140)).toBe(true);
    for (const type of types) expect(block).toContain(`'${type}'`);
    expect(block).toContain(']], // spelling unconfirmed: all');
  });

  it('lists only the unconfirmed codes of a row that has some art', () => {
    const deerling = formsTemplate(585, 'DEERLING', ['DEERLING_SPRING', 'DEERLING_SUMMER', 'DEERLING_AUTUMN', 'DEERLING_WINTER']);
    const out = text([species(585, 'Deerling', ['Normal', 'Grass'])], [deerling], ['pm585.fSUMMER.icon.png']);
    expect(out).toContain("  [585, ['SUMMER', 'AUTUMN', 'WINTER']], // spelling unconfirmed: AUTUMN, WINTER\n");
  });

  it('states the tradability check and its documented override in the header', () => {
    const out = text([species(1025, 'Pecharunt', ['Poison', 'Ghost']), VULPIX_ROW], [pokemonTemplate(1025, 'PECHARUNT', undefined, ['Poison', 'Ghost']), ...VULPIX]);
    expect(out).toContain('Tradability, game master isTradable vs the app\'s untradable rules (constants/untradable.ts): 3 species and form entries compared');
    expect(out).toContain('all agree except 1 documented override: #1025 Pecharunt: game master tradable, app untradable on purpose');
    expect(out).toContain('The generator refuses to write while any other differ (TRADABILITY_OVERRIDES).');
    expect(text([VULPIX_ROW], VULPIX)).toContain('all agree. The generator refuses');
  });

  it('says which unflagged event forms it left out, and names the table in the rules', () => {
    const out = text([CHARIZARD_ROW], CHARIZARD);
    expect(out).toContain('1 event forms the game master does not flag (#6 COPY_2019)');
    expect(out).toContain('UNFLAGGED_COSTUME_FORMS_EXCLUDED');
    expect(out).not.toContain("[6, ['COPY_2019']]"); // and it is not in POKEDEX_FORMS
  });

  it('round-trips its provenance, so --pinned can read the commits back', () => {
    expect(parseProvenance(text([VULPIX_ROW], VULPIX))).toEqual(provenance);
    expect(parseProvenance('// no provenance here')).toBeNull();
  });

  it('escapes quotes and backslashes in names but leaves a curly apostrophe alone', () => {
    const out = text([species(83, 'Farfetch’d', ['Normal', 'Flying']), species(84, "O'Brien\\", ['Normal'])], []);
    expect(out).toContain("[83, 'Farfetch’d', ['Normal', 'Flying']],");
    expect(out).toContain("[84, 'O\\'Brien\\\\', ['Normal']],");
  });
});
