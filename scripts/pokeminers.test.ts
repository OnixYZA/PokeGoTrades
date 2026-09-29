/**
 * Unit tests for `parsePokeMinersIcon`. Every matching-case fixture below is a REAL filename pulled
 * from a live checkout of PokeMiners/pogo_assets' `Images/Pokemon - 256x256/Addressable Assets` folder
 * (not invented) — see that file's header comment for how the grammar was derived.
 */
import { describe, expect, it } from 'vitest';

import { parsePokeMinersIcon, planMirror } from './pokeminers';

describe('parsePokeMinersIcon', () => {
  it('parses a plain base icon', () => {
    expect(parsePokeMinersIcon('pm1.icon.png')).toEqual({
      pokemonId: 1,
      form: null,
      costume: null,
      shiny: false,
      gender2: false,
    });
  });

  it('parses the shiny of a plain base icon', () => {
    expect(parsePokeMinersIcon('pm1.s.icon.png')).toEqual({
      pokemonId: 1,
      form: null,
      costume: null,
      shiny: true,
      gender2: false,
    });
  });

  it('parses a form-only icon', () => {
    expect(parsePokeMinersIcon('pm1.fFALL_2019.icon.png')).toEqual({
      pokemonId: 1,
      form: 'FALL_2019',
      costume: null,
      shiny: false,
      gender2: false,
    });
  });

  it('parses a shiny costume-only icon, underscores included', () => {
    expect(parsePokeMinersIcon('pm1.cJAN_2020_NOEVOLVE.s.icon.png')).toEqual({
      pokemonId: 1,
      form: null,
      costume: 'JAN_2020_NOEVOLVE',
      shiny: true,
      gender2: false,
    });
  });

  it('parses a bare .g2 (alternate-gender) icon', () => {
    expect(parsePokeMinersIcon('pm3.g2.icon.png')).toEqual({
      pokemonId: 3,
      form: null,
      costume: null,
      shiny: false,
      gender2: true,
    });
  });

  it('parses costume + g2 + shiny together, in the one order upstream ever uses', () => {
    expect(parsePokeMinersIcon('pm12.cFASHION_2021_NOEVOLVE.g2.s.icon.png')).toEqual({
      pokemonId: 12,
      form: null,
      costume: 'FASHION_2021_NOEVOLVE',
      shiny: true,
      gender2: true,
    });
  });

  it('parses form + costume together (Galarian Sirfetchd in a Go Fest outfit)', () => {
    expect(parsePokeMinersIcon('pm263.fGALARIAN.cGOFEST_2021_NOEVOLVE.icon.png')).toEqual({
      pokemonId: 263,
      form: 'GALARIAN',
      costume: 'GOFEST_2021_NOEVOLVE',
      shiny: false,
      gender2: false,
    });
  });

  it('extracts a bad-cased costume verbatim rather than rejecting it — planMirror decides', () => {
    expect(parsePokeMinersIcon('pm133.cMay_2023.icon.png')).toEqual({
      pokemonId: 133,
      form: null,
      costume: 'May_2023',
      shiny: false,
      gender2: false,
    });
  });

  it('rejects the .portrait.png sibling asset', () => {
    expect(parsePokeMinersIcon('pm3.fMEGA.portrait.png')).toBeNull();
    expect(parsePokeMinersIcon('pm3.fMEGA.s.portrait.png')).toBeNull();
  });

  it('rejects a real upstream oddity: an empty form token', () => {
    expect(parsePokeMinersIcon('pm479.f.icon.png')).toBeNull();
  });

  it('rejects anything that is not a pm-prefixed icon filename', () => {
    expect(parsePokeMinersIcon('README.md')).toBeNull();
    expect(parsePokeMinersIcon('pm25.png')).toBeNull();
    expect(parsePokeMinersIcon('not-a-pokemon-file.png')).toBeNull();
  });
});

describe('planMirror', () => {
  // Real upstream names (see this file's header), including the bad-cased Eevee costume.
  const EEVEE = ['pm133.icon.png', 'pm133.s.icon.png', 'pm133.cMay_2023.icon.png', 'pm133.cMAY_2023.s.icon.png'];
  const BASE_ONLY = { forms: false, costumes: false, range: null };

  it('default scope is base + shiny only; costume files are out of scope, not refused', () => {
    const plan = planMirror(EEVEE, { ...BASE_ONLY, range: [133, 133] });
    expect(plan.uploads.map((u) => u.key)).toEqual(['pokemon/133.png', 'pokemon/133.s.png']);
    expect(plan.invalidCode).toEqual([]);
  });

  it('refuses a bad-cased code instead of folding it onto the base key, so the real base still uploads', () => {
    const plan = planMirror(EEVEE, { forms: true, costumes: true, range: [133, 133] });
    expect(plan.uploads).toEqual([
      { key: 'pokemon/133.cMAY_2023.s.png', sourceFile: 'pm133.cMAY_2023.s.icon.png' },
      { key: 'pokemon/133.png', sourceFile: 'pm133.icon.png' },
      { key: 'pokemon/133.s.png', sourceFile: 'pm133.s.icon.png' },
    ]);
    expect(plan.invalidCode).toEqual(['pm133.cMay_2023.icon.png']);
    expect(plan.collisions).toEqual([]);
  });

  it('drops .g2, synthetic ids, out-of-range ids and non-icons', () => {
    const plan = planMirror(
      ['pm3.icon.png', 'pm3.g2.icon.png', 'pm10188.icon.png', 'pm4.icon.png', 'pm3.fMEGA.portrait.png'],
      { ...BASE_ONLY, range: [1, 3] },
    );
    expect(plan.uploads.map((u) => u.key)).toEqual(['pokemon/3.png']);
  });

  it('reports in-range Pokédex ids with no base icon upstream', () => {
    const plan = planMirror(['pm1.icon.png', 'pm2.s.icon.png'], { ...BASE_ONLY, range: [1, 3] });
    expect(plan.missingBase).toEqual([2, 3]);
  });
});
