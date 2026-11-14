/**
 * Unit tests for what the Pokémon picker offers and marks "ADDED" (`lib/picker-selection.ts`): which variants a
 * row stands for, when a species row counts as added, which form the form step selects, and what the picker may
 * hand its caller. The species used are chosen for the shape of their forms, and each test that leans on a shape
 * asserts it first, so a regenerated dex fails with a pointer to the assumption instead of a confusing diff.
 */
import { describe, expect, it } from 'vitest';

import { POKEDEX, defaultFormOf, formsOf, isPokemonUntradable } from '../constants/pokedex';
import {
  addedFormsOf,
  buildPick,
  excludedKeysOf,
  hasFormStep,
  isFormAdded,
  pickableForms,
  resolveFormChoice,
  resolveTap,
  speciesRowState,
  type PickerOptions,
} from './picker-selection';
import type { SpriteSubject } from './sprite-url';

// Shapes under test (see constants/pokedex-data.ts):
const BULBASAUR = 1; // no forms
const VULPIX = 37; // default + ALOLA
const MEOWTH = 52; // default + ALOLA + GALARIAN
const ROTOM = 479; // default + five tradable appliance forms
const KYUREM = 646; // default tradable; WHITE and BLACK untradable
const ZACIAN = 888; // default (HERO) and CROWNED_SWORD both tradable (the owner's decision, 2026-11-12)
const MEW = 151; // untradable as a whole, no forms
const DEOXYS = 386; // untradable as a whole, with forms

const WITH_FORMS: PickerOptions = { allowShiny: true, allowForm: true };
const WITHOUT_FORMS: PickerOptions = { allowShiny: true, allowForm: false };

/** The list the caller passes as `exclude`, as the set the picker's functions take. */
const keys = (...subjects: SpriteSubject[]) => excludedKeysOf(subjects);

describe('the dex shapes these tests lean on', () => {
  it('matches', () => {
    expect(formsOf(BULBASAUR)).toEqual([]);
    expect(formsOf(VULPIX)).toEqual(['ALOLA']);
    expect(formsOf(MEOWTH)).toEqual(['ALOLA', 'GALARIAN']);
    expect(formsOf(ROTOM).length).toBeGreaterThan(2);
    expect(formsOf(KYUREM)).toEqual(['WHITE', 'BLACK']);
    expect(formsOf(ZACIAN)).toEqual(['CROWNED_SWORD']);
    expect(defaultFormOf(ZACIAN)).toBe('HERO');
    expect(formsOf(DEOXYS).length).toBeGreaterThan(0);
    expect(isPokemonUntradable(MEW)).toBe(true);
    expect(isPokemonUntradable(DEOXYS)).toBe(true);
    expect(isPokemonUntradable(KYUREM)).toBe(false);
    expect(isPokemonUntradable(KYUREM, 'WHITE')).toBe(true);
    expect(isPokemonUntradable(ZACIAN, 'CROWNED_SWORD')).toBe(false);
  });
});

describe('pickableForms', () => {
  it('is just the default for a formless species', () => {
    expect(pickableForms(BULBASAUR, true)).toEqual([null]);
  });

  it('lists the default first, then every form in the dex order', () => {
    expect(pickableForms(MEOWTH, true)).toEqual([null, 'ALOLA', 'GALARIAN']);
  });

  it('is just the default when the caller has its own form control', () => {
    expect(pickableForms(MEOWTH, false)).toEqual([null]);
  });

  it('drops untradable forms but keeps the species pickable', () => {
    expect(pickableForms(KYUREM, true)).toEqual([null]);
    expect(pickableForms(ZACIAN, true)).toEqual([null, 'CROWNED_SWORD']); // listable now, so offered rather than dropped
  });

  it('is empty for a species that is untradable as a whole, forms or not', () => {
    for (const allowForm of [true, false]) {
      expect(pickableForms(MEW, allowForm)).toEqual([]);
      expect(pickableForms(DEOXYS, allowForm)).toEqual([]);
    }
  });
});

describe('hasFormStep', () => {
  it('is true only for a species with forms, when the caller wants one', () => {
    expect(hasFormStep(VULPIX, true)).toBe(true);
    expect(hasFormStep(VULPIX, false)).toBe(false);
    expect(hasFormStep(BULBASAUR, true)).toBe(false);
  });

  it('is true for Kyurem although only its default is tradable, so the trainer sees why White Kyurem is missing', () => {
    expect(hasFormStep(KYUREM, true)).toBe(true);
  });
});

describe('resolveTap', () => {
  it('picks a formless species straight away, with formCode null', () => {
    expect(resolveTap(BULBASAUR, false, WITH_FORMS)).toEqual({ kind: 'pick', pick: { pokemonId: BULBASAUR, shiny: false, formCode: null } });
  });

  it('carries the Shiny toggle into an immediate pick', () => {
    expect(resolveTap(BULBASAUR, true, WITH_FORMS)).toEqual({ kind: 'pick', pick: { pokemonId: BULBASAUR, shiny: true, formCode: null } });
  });

  it('forces shiny off when the picker has no Shiny toggle, whatever state the toggle was left in', () => {
    const noShiny: PickerOptions = { allowShiny: false, allowForm: true };
    expect(resolveTap(BULBASAUR, true, noShiny)).toEqual({ kind: 'pick', pick: { pokemonId: BULBASAUR, shiny: false, formCode: null } });
  });

  it('opens the form step for a species with forms', () => {
    expect(resolveTap(VULPIX, false, WITH_FORMS)).toEqual({ kind: 'choose-form' });
    expect(resolveTap(KYUREM, false, WITH_FORMS)).toEqual({ kind: 'choose-form' });
    expect(resolveTap(ZACIAN, false, WITH_FORMS)).toEqual({ kind: 'choose-form' });
  });

  it('picks a species with forms straight away, as the default form, when the caller has its own form control', () => {
    expect(resolveTap(VULPIX, true, WITHOUT_FORMS)).toEqual({ kind: 'pick', pick: { pokemonId: VULPIX, shiny: true, formCode: null } });
    expect(resolveTap(KYUREM, false, WITHOUT_FORMS)).toEqual({ kind: 'pick', pick: { pokemonId: KYUREM, shiny: false, formCode: null } });
  });

  it('refuses a species that is untradable as a whole, with or without forms', () => {
    for (const options of [WITH_FORMS, WITHOUT_FORMS]) {
      expect(resolveTap(MEW, false, options)).toEqual({ kind: 'refuse' });
      expect(resolveTap(DEOXYS, false, options)).toEqual({ kind: 'refuse' });
    }
  });
});

describe('speciesRowState', () => {
  it('is untradable for a species nothing about which can be picked', () => {
    expect(speciesRowState(MEW, false, keys(), true)).toBe('untradable');
    expect(speciesRowState(DEOXYS, false, keys(), true)).toBe('untradable');
  });

  it('keeps the untradable refusal even when the list somehow holds the species', () => {
    expect(speciesRowState(MEW, false, keys({ pokemonId: MEW }), true)).toBe('untradable');
  });

  describe('a formless species', () => {
    it('is open until it is in the list, then added', () => {
      expect(speciesRowState(BULBASAUR, false, keys(), true)).toBe('open');
      expect(speciesRowState(BULBASAUR, false, keys({ pokemonId: BULBASAUR }), true)).toBe('added');
    });

    it('keeps shiny and non-shiny distinct', () => {
      const shinyOnly = keys({ pokemonId: BULBASAUR, shiny: true });
      expect(speciesRowState(BULBASAUR, true, shinyOnly, true)).toBe('added');
      expect(speciesRowState(BULBASAUR, false, shinyOnly, true)).toBe('open');
      const plainOnly = keys({ pokemonId: BULBASAUR });
      expect(speciesRowState(BULBASAUR, false, plainOnly, true)).toBe('added');
      expect(speciesRowState(BULBASAUR, true, plainOnly, true)).toBe('open');
    });

    it('is not stopped by a costume entry, which is a different variant', () => {
      expect(speciesRowState(BULBASAUR, false, keys({ pokemonId: BULBASAUR, costumeCode: 'JAN_2020_NOEVOLVE' }), true)).toBe('open');
    });
  });

  describe('a species with forms', () => {
    it('is open when nothing is added', () => {
      expect(speciesRowState(MEOWTH, false, keys(), true)).toBe('open');
    });

    it('stays open while any form is missing, however many are added', () => {
      expect(speciesRowState(MEOWTH, false, keys({ pokemonId: MEOWTH }), true)).toBe('open');
      expect(speciesRowState(MEOWTH, false, keys({ pokemonId: MEOWTH }, { pokemonId: MEOWTH, formCode: 'ALOLA' }), true)).toBe('open');
      expect(speciesRowState(MEOWTH, false, keys({ pokemonId: MEOWTH, formCode: 'ALOLA' }, { pokemonId: MEOWTH, formCode: 'GALARIAN' }), true)).toBe('open');
    });

    it('is added once every form is, including the default', () => {
      const all = keys({ pokemonId: MEOWTH }, { pokemonId: MEOWTH, formCode: 'ALOLA' }, { pokemonId: MEOWTH, formCode: 'GALARIAN' });
      expect(speciesRowState(MEOWTH, false, all, true)).toBe('added');
    });

    it('is open if only the default of the OTHER shiny state is added', () => {
      const all = keys({ pokemonId: VULPIX }, { pokemonId: VULPIX, formCode: 'ALOLA' });
      expect(speciesRowState(VULPIX, false, all, true)).toBe('added');
      expect(speciesRowState(VULPIX, true, all, true)).toBe('open');
      const allShiny = keys({ pokemonId: VULPIX, shiny: true }, { pokemonId: VULPIX, shiny: true, formCode: 'ALOLA' });
      expect(speciesRowState(VULPIX, true, allShiny, true)).toBe('added');
      expect(speciesRowState(VULPIX, false, allShiny, true)).toBe('open');
    });

    it('is added when its many forms are all in the list (Rotom)', () => {
      const every = keys({ pokemonId: ROTOM }, ...formsOf(ROTOM).map((formCode) => ({ pokemonId: ROTOM, formCode })));
      expect(speciesRowState(ROTOM, false, every, true)).toBe('added');
      const missingOne = keys({ pokemonId: ROTOM }, ...formsOf(ROTOM).slice(1).map((formCode) => ({ pokemonId: ROTOM, formCode })));
      expect(speciesRowState(ROTOM, false, missingOne, true)).toBe('open');
    });

    it('does not count untradable forms: Kyurem is added once plain Kyurem is', () => {
      expect(speciesRowState(KYUREM, false, keys(), true)).toBe('open');
      expect(speciesRowState(KYUREM, false, keys({ pokemonId: KYUREM }), true)).toBe('added');
    });

    it('when the caller picks no form, only the default counts', () => {
      expect(speciesRowState(VULPIX, false, keys({ pokemonId: VULPIX }), false)).toBe('added');
      expect(speciesRowState(VULPIX, false, keys({ pokemonId: VULPIX, formCode: 'ALOLA' }), false)).toBe('open');
    });
  });
});

describe('addedFormsOf', () => {
  it('lists the added forms for the shiny state, the default as null', () => {
    const list = keys({ pokemonId: MEOWTH }, { pokemonId: MEOWTH, formCode: 'GALARIAN', shiny: true }, { pokemonId: MEOWTH, formCode: 'ALOLA' });
    expect(addedFormsOf(MEOWTH, false, list)).toEqual([null, 'ALOLA']);
    expect(addedFormsOf(MEOWTH, true, list)).toEqual(['GALARIAN']);
  });

  it('is empty when nothing is added', () => {
    expect(addedFormsOf(MEOWTH, false, keys())).toEqual([]);
  });
});

describe('isFormAdded', () => {
  it('treats the default form (null) and a named form as different variants', () => {
    const list = keys({ pokemonId: VULPIX });
    expect(isFormAdded(list, VULPIX, false, null)).toBe(true);
    expect(isFormAdded(list, VULPIX, false, 'ALOLA')).toBe(false);
  });
});

describe('resolveFormChoice', () => {
  it('starts on the default form', () => {
    expect(resolveFormChoice(null, MEOWTH, false, keys())).toEqual({ formCode: null });
  });

  it('keeps the form the trainer asked for while it is open', () => {
    expect(resolveFormChoice('GALARIAN', MEOWTH, false, keys())).toEqual({ formCode: 'GALARIAN' });
  });

  it('falls back to the first open form when the default is already added', () => {
    expect(resolveFormChoice(null, MEOWTH, false, keys({ pokemonId: MEOWTH }))).toEqual({ formCode: 'ALOLA' });
  });

  it('falls back when the asked-for form is added, and returns to it once it is open again (shiny flipped)', () => {
    const list = keys({ pokemonId: MEOWTH, formCode: 'ALOLA' });
    expect(resolveFormChoice('ALOLA', MEOWTH, false, list)).toEqual({ formCode: null });
    expect(resolveFormChoice('ALOLA', MEOWTH, true, list)).toEqual({ formCode: 'ALOLA' });
  });

  it('never selects an untradable form, even if asked', () => {
    expect(resolveFormChoice('WHITE', KYUREM, false, keys())).toEqual({ formCode: null });
    expect(resolveFormChoice('CROWNED_SWORD', ZACIAN, false, keys())).toEqual({ formCode: 'CROWNED_SWORD' }); // tradable: selectable
  });

  it('never selects a code that is not one of the species forms (the default stands in)', () => {
    expect(resolveFormChoice('GALARIAN', VULPIX, false, keys())).toEqual({ formCode: null });
  });

  it('is null when every form is added, so the step can disable its confirm button', () => {
    const all = keys({ pokemonId: VULPIX }, { pokemonId: VULPIX, formCode: 'ALOLA' });
    expect(resolveFormChoice(null, VULPIX, false, all)).toBeNull();
    expect(resolveFormChoice(null, VULPIX, true, all)).toEqual({ formCode: null });
  });
});

describe('buildPick', () => {
  it('emits the default form as null, with the shiny flag', () => {
    expect(buildPick(VULPIX, true, null, WITH_FORMS)).toEqual({ pokemonId: VULPIX, shiny: true, formCode: null });
  });

  it('emits a chosen form by its code', () => {
    expect(buildPick(VULPIX, false, 'ALOLA', WITH_FORMS)).toEqual({ pokemonId: VULPIX, shiny: false, formCode: 'ALOLA' });
  });

  it('emits formCode null whenever the caller has its own form control', () => {
    expect(buildPick(VULPIX, false, 'ALOLA', WITHOUT_FORMS)).toEqual({ pokemonId: VULPIX, shiny: false, formCode: null });
  });

  it('forces shiny off when there is no Shiny toggle', () => {
    expect(buildPick(VULPIX, true, 'ALOLA', { allowShiny: false, allowForm: true })).toEqual({ pokemonId: VULPIX, shiny: false, formCode: 'ALOLA' });
  });

  it('refuses an untradable form, and an untradable species', () => {
    expect(buildPick(KYUREM, false, 'WHITE', WITH_FORMS)).toBeNull();
    expect(buildPick(MEW, false, null, WITH_FORMS)).toBeNull();
    expect(buildPick(DEOXYS, false, 'ATTACK', WITH_FORMS)).toBeNull();
  });

  it('emits Crowned Sword Zacian: the owner lists it', () => {
    expect(buildPick(ZACIAN, false, 'CROWNED_SWORD', WITH_FORMS)).toEqual({ pokemonId: ZACIAN, shiny: false, formCode: 'CROWNED_SWORD' });
  });

  it('still emits the tradable default of a species with untradable forms', () => {
    expect(buildPick(KYUREM, false, null, WITH_FORMS)).toEqual({ pokemonId: KYUREM, shiny: false, formCode: null });
    expect(buildPick(ZACIAN, false, null, WITH_FORMS)).toEqual({ pokemonId: ZACIAN, shiny: false, formCode: null });
  });

  it('refuses a code the species does not have, and the default form named by its code', () => {
    expect(buildPick(BULBASAUR, false, 'ALOLA', WITH_FORMS)).toBeNull();
    expect(buildPick(ZACIAN, false, 'HERO', WITH_FORMS)).toBeNull();
  });
});

describe('across the whole dex', () => {
  const variants = POKEDEX.flatMap((entry) => [null, ...formsOf(entry.pokemonId)].map((formCode) => ({ pokemonId: entry.pokemonId, formCode })));

  it('never emits an untradable creature, whichever way it is picked', () => {
    for (const { pokemonId, formCode } of variants) {
      for (const options of [WITH_FORMS, WITHOUT_FORMS]) {
        const pick = buildPick(pokemonId, false, formCode, options);
        if (pick) expect(isPokemonUntradable(pick.pokemonId, pick.formCode), `${pokemonId}:${formCode}`).toBe(false);
      }
    }
    for (const entry of POKEDEX) {
      for (const options of [WITH_FORMS, WITHOUT_FORMS]) {
        const tap = resolveTap(entry.pokemonId, false, options);
        if (tap.kind === 'pick') expect(isPokemonUntradable(tap.pick.pokemonId, tap.pick.formCode), `${entry.pokemonId}`).toBe(false);
      }
    }
  });

  it('refuses a species exactly when it is untradable with no form (the rule the species row used to apply)', () => {
    for (const entry of POKEDEX) {
      expect(resolveTap(entry.pokemonId, false, WITH_FORMS).kind === 'refuse', `${entry.pokemonId}`).toBe(isPokemonUntradable(entry.pokemonId));
    }
  });

  it('never opens the form step for a species with no forms, and always for one with forms', () => {
    for (const entry of POKEDEX) {
      const hasForms = formsOf(entry.pokemonId).length > 0;
      const tap = resolveTap(entry.pokemonId, false, WITH_FORMS);
      if (isPokemonUntradable(entry.pokemonId)) continue;
      expect(tap.kind === 'choose-form', `${entry.pokemonId}`).toBe(hasForms);
    }
  });

  it('every tradable species is open on an empty list, and every form step starts on a pickable form', () => {
    const empty = excludedKeysOf(undefined);
    for (const entry of POKEDEX) {
      if (isPokemonUntradable(entry.pokemonId)) continue;
      expect(speciesRowState(entry.pokemonId, false, empty, true), `${entry.pokemonId}`).toBe('open');
      expect(resolveFormChoice(null, entry.pokemonId, false, empty), `${entry.pokemonId}`).toEqual({ formCode: null });
    }
  });
});
