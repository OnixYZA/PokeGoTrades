/**
 * Unit tests for `lib/creature-pick.ts`: turning a picker selection into the stored `CreatureRef` (name and hue
 * from the dex, the trainer's shiny and form carried, a refusal for a species / form that does not exist or can
 * never be traded), and keeping a wanted list free of repeats WITHOUT mistaking two forms of one species for one.
 */
import { describe, expect, it } from 'vitest';

import { POKEDEX, findPokemon, formsOf, isPokemonUntradable } from '../constants/pokedex';
import type { CreatureRef } from '../data/types';
import { creatureRefToJson, parseCreatureRef } from './api/creature-ref';
import { appendDistinctCreature, creatureRefFromPick } from './creature-pick';

/** Vulpix (#37) is the fixture: Fire, with one extra form (`ALOLA`, Ice), tradable in both. */
const VULPIX = 37;

const refOf = (pick: Parameters<typeof creatureRefFromPick>[0]): CreatureRef => {
  const result = creatureRefFromPick(pick);
  if (!result.ok) throw new Error(`expected ${JSON.stringify(pick)} to be accepted, got ${result.reason}`);
  return result.ref;
};

describe('creatureRefFromPick', () => {
  it('takes name and hue from the dex by pokemonId and carries the trainer\'s shiny and form', () => {
    const entry = findPokemon(VULPIX);
    expect(entry).toBeDefined();
    expect(refOf({ pokemonId: VULPIX, shiny: true, formCode: 'ALOLA' })).toEqual({
      name: entry!.name,
      pokemonId: VULPIX,
      hue: entry!.hue,
      shiny: true,
      formCode: 'ALOLA',
    });
    expect(entry!.name).toBe('Vulpix');
  });

  it('leaves shiny and formCode OUT for a regular, default-form pick (null, absent and empty alike)', () => {
    for (const pick of [
      { pokemonId: VULPIX, shiny: false, formCode: null },
      { pokemonId: VULPIX },
      { pokemonId: VULPIX, formCode: '' },
    ]) {
      const ref = refOf(pick);
      expect(ref).not.toHaveProperty('shiny');
      expect(ref).not.toHaveProperty('formCode');
      expect(ref).toEqual({ name: 'Vulpix', pokemonId: VULPIX, hue: findPokemon(VULPIX)!.hue });
    }
  });

  it('accepts every form the dex lists for every tradable species, and keeps it', () => {
    let checked = 0;
    for (const { pokemonId } of POKEDEX) {
      for (const formCode of formsOf(pokemonId)) {
        const result = creatureRefFromPick({ pokemonId, formCode });
        if (isPokemonUntradable(pokemonId, formCode)) {
          expect(result, `${pokemonId} ${formCode}`).toEqual({ ok: false, reason: 'untradable' });
        } else {
          expect(result.ok, `${pokemonId} ${formCode}`).toBe(true);
          if (result.ok) expect(result.ref.formCode).toBe(formCode);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('refuses an id outside the dex', () => {
    expect(creatureRefFromPick({ pokemonId: 999_999 })).toEqual({ ok: false, reason: 'unknown_species' });
    expect(creatureRefFromPick({ pokemonId: 999_999, formCode: 'ALOLA' })).toEqual({ ok: false, reason: 'unknown_species' });
  });

  it('refuses a form the species does not come in', () => {
    expect(creatureRefFromPick({ pokemonId: VULPIX, formCode: 'GALARIAN' })).toEqual({ ok: false, reason: 'unknown_form' });
    // Pikachu has no selectable forms at all, so even another species' real code is refused on it.
    expect(formsOf(25)).toEqual([]);
    expect(creatureRefFromPick({ pokemonId: 25, formCode: 'ALOLA' })).toEqual({ ok: false, reason: 'unknown_form' });
    // The code's spelling is exact: a lowercase one is not the form.
    expect(creatureRefFromPick({ pokemonId: VULPIX, formCode: 'alola' })).toEqual({ ok: false, reason: 'unknown_form' });
  });

  it('refuses an untradable creature, judged WITH its form', () => {
    // A whole species...
    expect(creatureRefFromPick({ pokemonId: 151 })).toEqual({ ok: false, reason: 'untradable' }); // Mew
    // ...a form of a species whose other forms trade...
    expect(creatureRefFromPick({ pokemonId: 646, formCode: 'WHITE' })).toEqual({ ok: false, reason: 'untradable' });
    expect(creatureRefFromPick({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toEqual({ ok: false, reason: 'untradable' });
    // ...while the same species in its default form is fine.
    expect(refOf({ pokemonId: 646 })).toMatchObject({ pokemonId: 646 });
    expect(refOf({ pokemonId: 888 })).toMatchObject({ pokemonId: 888 });
  });

  it('builds a ref that survives creatureRefToJson -> parseCreatureRef unchanged (what the insert and the read do)', () => {
    for (const pick of [
      { pokemonId: VULPIX, shiny: true, formCode: 'ALOLA' },
      { pokemonId: VULPIX, shiny: false, formCode: null },
    ]) {
      const ref = refOf(pick);
      expect(parseCreatureRef(creatureRefToJson(ref))).toEqual(ref);
    }
  });
});

describe('appendDistinctCreature', () => {
  const vulpix = (): CreatureRef => refOf({ pokemonId: VULPIX });
  const alolanVulpix = (): CreatureRef => refOf({ pokemonId: VULPIX, formCode: 'ALOLA' });
  const shinyVulpix = (): CreatureRef => refOf({ pokemonId: VULPIX, shiny: true });

  it('lets two forms of one species sit side by side, in either order', () => {
    expect(appendDistinctCreature([vulpix()], alolanVulpix(), 3).map((c) => c.formCode)).toEqual([undefined, 'ALOLA']);
    expect(appendDistinctCreature([alolanVulpix()], vulpix(), 3).map((c) => c.formCode)).toEqual(['ALOLA', undefined]);
  });

  it('treats a shiny and a regular of one species, and of one form, as different entries', () => {
    expect(appendDistinctCreature([vulpix()], shinyVulpix(), 3)).toHaveLength(2);
    expect(appendDistinctCreature([alolanVulpix()], refOf({ pokemonId: VULPIX, shiny: true, formCode: 'ALOLA' }), 3)).toHaveLength(2);
  });

  it('refuses an exact repeat, returning the same array so a state setter skips the render', () => {
    const list = [vulpix(), alolanVulpix()];
    expect(appendDistinctCreature(list, vulpix(), 3)).toBe(list);
    expect(appendDistinctCreature(list, alolanVulpix(), 3)).toBe(list);
  });

  it('refuses another entry once the list is full, even a new one', () => {
    const list = [vulpix(), alolanVulpix(), shinyVulpix()];
    expect(appendDistinctCreature(list, refOf({ pokemonId: 4 }), 3)).toBe(list);
  });

  it('does not mutate the list it is given', () => {
    const list = [vulpix()];
    const next = appendDistinctCreature(list, alolanVulpix(), 3);
    expect(list).toHaveLength(1);
    expect(next).not.toBe(list);
  });

  it('keeps every selectable form of every species apart from its default form and from each other', () => {
    for (const { pokemonId } of POKEDEX) {
      const forms = formsOf(pokemonId);
      if (forms.length === 0) continue;
      const entries: CreatureRef[] = [
        { name: 'x', pokemonId, hue: 0 },
        ...forms.map((formCode) => ({ name: 'x', pokemonId, hue: 0, formCode })),
      ];
      let list: CreatureRef[] = [];
      for (const entry of entries) list = appendDistinctCreature(list, entry, entries.length);
      expect(list, `species ${pokemonId}`).toHaveLength(entries.length);
    }
  });
});
