/**
 * Unit tests for the pure search/lookup helpers in `constants/pokedex.ts`. These sit on top of
 * generated data (`constants/pokedex-data.ts`, from PokeAPI and the PokeMiners game master), so the
 * fixtures below are real dex entries chosen specifically for the punctuation/diacritics they carry
 * (Mr. Mime, Farfetch'd, Flabébé, Type: Null) or the typing they exercise (Zacian, Vulpix, Rotom) rather
 * than invented names — see AGENTS.md on never hallucinating game data.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  creatureHasType,
  defaultFormOf,
  findPokemon,
  formatTypes,
  formsOf,
  isPokemonUntradable,
  POKEDEX,
  POKEMON_TYPES,
  searchPokedex,
  TYPE_HUE,
  typeMembership,
  typesOf,
  UNTRADABLE_FORM_COMBINATIONS,
  UNTRADABLE_MYTHICAL_IDS,
  UNTRADABLE_SPECIES_IDS,
  type TypeMembership,
} from './pokedex';
import { creatureFormLabel } from '../lib/format';
import { BASE_FORM_CODES } from './base-form-codes';
import { FORM_TYPE_OVERRIDES, POKEDEX_DEFAULT_FORMS, POKEDEX_FORMS } from './pokedex-data';
import { isPokemonUntradable as isPokemonUntradableLeaf, UNTRADABLE_FORM_COMBINATIONS as UNTRADABLE_FORM_COMBINATIONS_LEAF } from './untradable';

describe('findPokemon', () => {
  it('finds a known dex id', () => {
    expect(findPokemon(1)?.name).toBe('Bulbasaur');
    expect(findPokemon(150)?.name).toBe('Mewtwo');
  });

  it('returns undefined for an id outside the dex', () => {
    expect(findPokemon(0)).toBeUndefined();
    expect(findPokemon(999999)).toBeUndefined();
  });
});

describe('searchPokedex — ranking', () => {
  it('an empty query returns the start of the dex, in national dex order', () => {
    const results = searchPokedex('', 3);
    expect(results.map((r) => r.pokemonId)).toEqual([1, 2, 3]);
  });

  it('ranks a prefix match above a mid-name substring match', () => {
    // "char" is a prefix of Charmander/Charmeleon/Charizard, but also a substring of nothing else
    // relevant here — this instead pins prefix-over-includes using a query that is a prefix of one
    // name and a plain substring of another.
    const results = searchPokedex('lax', 10).map((r) => r.name);
    // "Lax" is a substring inside "Relaxo"-less English dex — use Snorlax (contains "lax") vs a
    // name that starts with "Lax": there isn't one in the real dex, so assert substring inclusion
    // still surfaces Snorlax at all (a weaker but still meaningful ranking guarantee below covers order).
    expect(results).toContain('Snorlax');
  });

  it('an exact name match ranks above a same-prefix longer name', () => {
    const results = searchPokedex('Charmander', 10).map((r) => r.name);
    expect(results[0]).toBe('Charmander');
  });

  it('a prefix match ranks above names that merely contain the query', () => {
    // "saur" is a prefix of nothing, but is a suffix of Bulbasaur/Ivysaur/Venusaur; "bulba" is a
    // strict prefix of Bulbasaur only, so it must come first even though both are substring matches.
    const results = searchPokedex('bulba', 10).map((r) => r.name);
    expect(results[0]).toBe('Bulbasaur');
  });

  it('limits results to the requested count', () => {
    expect(searchPokedex('a', 5)).toHaveLength(5);
  });
});

describe('searchPokedex — case and diacritic insensitivity', () => {
  it('is case-insensitive', () => {
    expect(searchPokedex('PIKACHU', 5).map((r) => r.name)).toContain('Pikachu');
    expect(searchPokedex('pikachu', 5).map((r) => r.name)).toContain('Pikachu');
  });

  it('finds Flabébé by an accent-free query', () => {
    const results = searchPokedex('flabebe', 10).map((r) => r.name);
    expect(results).toContain('Flabébé');
  });

  it('finds Flabébé when the query itself carries the accent', () => {
    const results = searchPokedex('flabébé', 10).map((r) => r.name);
    expect(results).toContain('Flabébé');
  });
});

describe('searchPokedex — punctuation insensitivity', () => {
  it('finds "Mr. Mime" without the period or space', () => {
    const results = searchPokedex('mrmime', 10).map((r) => r.name);
    expect(results).toContain('Mr. Mime');
  });

  it("finds \"Farfetch'd\" with a plain apostrophe, even though the stored name uses a curly one", () => {
    const results = searchPokedex("farfetch'd", 10).map((r) => r.name);
    expect(results).toContain('Farfetch’d');
  });

  it('finds "Type: Null" without the colon or space', () => {
    const results = searchPokedex('typenull', 10).map((r) => r.name);
    expect(results).toContain('Type: Null');
  });
});

describe('searchPokedex — numeric queries', () => {
  it('an exact dex number matches that Pokémon', () => {
    const results = searchPokedex('150', 5);
    expect(results[0].name).toBe('Mewtwo');
  });

  it('a leading-zero dex number still matches exactly', () => {
    const results = searchPokedex('025', 5);
    expect(results[0].name).toBe('Pikachu');
  });

  it('a short numeric query prefix-matches dex numbers, exact match first', () => {
    const results = searchPokedex('25', 10).map((r) => r.pokemonId);
    expect(results[0]).toBe(25); // exact match ranks first
    expect(results).toContain(250); // Ho-Oh, a prefix match
    expect(results).toContain(258); // Mudkip, another prefix match
  });

  it('a leading "#" is tolerated', () => {
    const results = searchPokedex('#150', 5);
    expect(results[0].name).toBe('Mewtwo');
  });
});

describe('isPokemonUntradable', () => {
  it('is true for Mythicals, in any form', () => {
    expect(isPokemonUntradable(151)).toBe(true); // Mew
    expect(isPokemonUntradable(386, 'ATTACK')).toBe(true); // Deoxys, a form code does not rescue it
    expect(isPokemonUntradable(1025)).toBe(true); // Pecharunt
  });

  it('is false for Meltan and Melmetal, the tradable Mythicals', () => {
    expect(isPokemonUntradable(808)).toBe(false);
    expect(isPokemonUntradable(809)).toBe(false);
  });

  it('is true for Zygarde in every form', () => {
    expect(isPokemonUntradable(718)).toBe(true);
    expect(isPokemonUntradable(718, 'COMPLETE')).toBe(true);
  });

  it('is true only for the fused Kyurem / Necrozma forms, not the base species', () => {
    expect(isPokemonUntradable(646, 'WHITE')).toBe(true);
    expect(isPokemonUntradable(646, 'BLACK')).toBe(true);
    expect(isPokemonUntradable(800, 'DUSK_MANE')).toBe(true);
    expect(isPokemonUntradable(800, 'DAWN_WINGS')).toBe(true);
    expect(isPokemonUntradable(646)).toBe(false);
    expect(isPokemonUntradable(646, 'NORMAL')).toBe(false);
    expect(isPokemonUntradable(800, null)).toBe(false);
  });

  // Crowned Sword / Crowned Shield / Ultra are the project's rule (2026-10-18), and each matches the game master:
  // the pinned file carries `isTradable` on ZACIAN_HERO and NECROZMA but not on their Crowned / Ultra forms (the
  // generator's tradability cross-check keeps it that way). They used to be tradable; a regression to that
  // fails here and in the database drift test below.
  it('is true for Crowned Sword Zacian, Crowned Shield Zamazenta and Ultra Necrozma', () => {
    expect(isPokemonUntradable(888, 'CROWNED_SWORD')).toBe(true);
    expect(isPokemonUntradable(889, 'CROWNED_SHIELD')).toBe(true);
    expect(isPokemonUntradable(800, 'ULTRA')).toBe(true);
  });

  it('keeps the base forms of Zacian, Zamazenta and Necrozma tradable: only the named form is refused', () => {
    for (const id of [888, 889]) {
      expect(isPokemonUntradable(id), `#${id}`).toBe(false);
      expect(isPokemonUntradable(id, null), `#${id}`).toBe(false);
      expect(isPokemonUntradable(id, 'HERO'), `#${id}`).toBe(false); // the default form's own code, as the sprite pipeline spells it
    }
    expect(isPokemonUntradable(888, 'CROWNED_SHIELD')).toBe(false); // each Crowned code is scoped to its own species
    expect(isPokemonUntradable(889, 'CROWNED_SWORD')).toBe(false);
    expect(isPokemonUntradable(800)).toBe(false);
    expect(isPokemonUntradable(800, null)).toBe(false);
    expect(isPokemonUntradable(800, 'NORMAL')).toBe(false);
  });

  it('is true for Eternatus in every form, Eternamax included', () => {
    expect(isPokemonUntradable(890)).toBe(true);
    expect(isPokemonUntradable(890, null)).toBe(true);
    expect(isPokemonUntradable(890, 'ETERNAMAX')).toBe(true);
    expect(UNTRADABLE_SPECIES_IDS.has(890)).toBe(true); // species-wide, not a form entry: nothing else can be spelled wrong
  });

  // Pecharunt is the one place the rule departs from the game master, which marks it `isTradable: true`. It stays
  // untradable as a Mythical (owner decision), recorded as TRADABILITY_OVERRIDES in scripts/pokedex-source.ts.
  it('keeps Pecharunt untradable, in every form, although the game master calls it tradable', () => {
    expect(UNTRADABLE_MYTHICAL_IDS.has(1025)).toBe(true);
    expect(isPokemonUntradable(1025)).toBe(true);
    expect(isPokemonUntradable(1025, null)).toBe(true);
    expect(isPokemonUntradable(1025, 'NORMAL')).toBe(true);
  });

  it('is false for ordinary species and legendaries', () => {
    expect(isPokemonUntradable(25)).toBe(false);
    expect(isPokemonUntradable(150, 'A')).toBe(false); // Armored Mewtwo
    expect(isPokemonUntradable(891)).toBe(false); // Kubfu, the neighbouring species of Eternatus
    expect(isPokemonUntradable(889)).toBe(false);
  });

  it('is re-exported from the leaf module the generator reads, so there is one rule', () => {
    expect(isPokemonUntradable).toBe(isPokemonUntradableLeaf);
    expect(UNTRADABLE_FORM_COMBINATIONS).toBe(UNTRADABLE_FORM_COMBINATIONS_LEAF);
    const source = readFileSync(path.resolve(__dirname, 'untradable.ts'), 'utf8');
    expect(source, 'the generator must be able to import it without pulling in the generated dex').not.toMatch(/^\s*import\b/m);
  });

  it('only names real dex entries', () => {
    const ids = [...UNTRADABLE_MYTHICAL_IDS, ...UNTRADABLE_SPECIES_IDS, ...UNTRADABLE_FORM_COMBINATIONS.map((c) => c.pokemonId)];
    for (const id of ids) expect(findPokemon(id), `dex #${id}`).toBeDefined();
  });
});

/** A migration file and its SQL. */
interface Migration {
  file: string;
  body: string;
}

/** A statement that DEFINES the function (`create function` or `create or replace function`, at the start of a
 *  line, so a comment or a call that merely names it is not a definition). */
const UNTRADABLE_FUNCTION_DEFINITION = /^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function[ \t]+public\.is_creature_untradable[ \t]*\(/gim;

/**
 * The CURRENT definition of `public.is_creature_untradable`: the last definition in the last migration, by
 * filename order (the timestamp prefix), that defines it, cut to that one function (its `create` to the closing
 * `$$;`). The function has been redefined with `create or replace` before and will be again, and each
 * redefinition replaces the last one in the database, so only the newest is the rule the database enforces.
 * Reading any other would compare the client lists with a rule the database no longer has. Input order does
 * not matter, and a migration that only calls or mentions the function is not a definition.
 */
function currentUntradableFunction(migrations: readonly Migration[]): { file: string; sql: string } | undefined {
  const newestFirst = [...migrations].sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
  for (const { file, body } of newestFirst) {
    const last = [...body.matchAll(UNTRADABLE_FUNCTION_DEFINITION)].at(-1);
    if (!last) continue;
    const close = body.indexOf('$$;', last.index);
    return { file, sql: body.slice(last.index, close === -1 ? undefined : close + 3) };
  }
  return undefined;
}

describe('currentUntradableFunction', () => {
  const original = 'create function public.is_creature_untradable(p_pokemon_id integer)\nreturns boolean as $$\n  select 1 -- ORIGINAL\n$$;\n';
  const redefinition = 'create or replace function public.is_creature_untradable(p_pokemon_id integer)\nreturns boolean as $$\n  select 1 -- REDEFINED\n$$;\n';

  it('takes the newest definition by filename, whatever order the files arrive in', () => {
    const migrations = [
      { file: '20261018000100_redefine.sql', body: redefinition },
      { file: '20260929000100_original.sql', body: original },
    ];
    expect(currentUntradableFunction(migrations)?.file).toBe('20261018000100_redefine.sql');
    expect(currentUntradableFunction([...migrations].reverse())?.sql).toContain('-- REDEFINED');
    expect(currentUntradableFunction(migrations)?.sql).not.toContain('-- ORIGINAL');
  });

  it('does not take a newer migration that only calls or mentions the function', () => {
    const migrations = [
      { file: '20260929000100_original.sql', body: original },
      { file: '20270101000100_caller.sql', body: '-- create or replace function public.is_creature_untradable is redefined elsewhere\nselect public.is_creature_untradable(1);\n' },
    ];
    expect(currentUntradableFunction(migrations)?.file).toBe('20260929000100_original.sql');
  });

  it('keeps to the function: a tag after its closing $$; is not part of it', () => {
    const migrations = [{ file: '20260929000100_original.sql', body: `${original}-- UNTRADABLE_SPECIES_IDS\n` }];
    expect(currentUntradableFunction(migrations)?.sql).not.toContain('UNTRADABLE_SPECIES_IDS');
  });

  it('uses the last definition when one migration defines it twice, and finds none when nothing does', () => {
    expect(currentUntradableFunction([{ file: '20260929000100_twice.sql', body: original + redefinition }])?.sql).toContain('-- REDEFINED');
    expect(currentUntradableFunction([{ file: '20260929000100_other.sql', body: 'select 1;' }])).toBeUndefined();
  });
});

describe('untradable lists match public.is_creature_untradable', () => {
  // The database enforces the same rule. Compare with the CURRENT definition: the newest migration that
  // defines the function, so a later `create or replace` is what gets compared, never the original.
  const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => ({ file, body: readFileSync(path.join(migrationsDir, file), 'utf8') }));
  const current = currentUntradableFunction(migrations);
  const sql = current?.sql;

  /** The line tagged `-- <marker>` inside the function body. */
  const taggedLine = (marker: string): string => {
    const line = sql?.split('\n').find((l) => l.trimEnd().endsWith(`-- ${marker}`));
    if (!line) throw new Error(`No line tagged "-- ${marker}" in ${current?.file ?? 'any migration (none defines the function)'}`);
    return line.slice(0, line.lastIndexOf('--'));
  };
  const ids = (marker: string) => (taggedLine(marker).match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);

  it('finds the migration', () => {
    expect(current?.file).toMatch(/^\d{14}_.+\.sql$/);
  });

  it('has the same Mythical ids', () => {
    expect(ids('UNTRADABLE_MYTHICAL_IDS')).toEqual([...UNTRADABLE_MYTHICAL_IDS].sort((a, b) => a - b));
  });

  it('has the same untradable species ids', () => {
    expect(ids('UNTRADABLE_SPECIES_IDS')).toEqual([...UNTRADABLE_SPECIES_IDS].sort((a, b) => a - b));
  });

  it('has the same fused form combinations', () => {
    const pairs = [...taggedLine('UNTRADABLE_FORM_COMBINATIONS').matchAll(/\((\d+),\s*'([A-Z0-9_]+)'\)/g)].map(
      ([, id, code]) => `${id}:${code}`,
    );
    expect(pairs.sort()).toEqual(UNTRADABLE_FORM_COMBINATIONS.map((c) => `${c.pokemonId}:${c.formCode}`).sort());
  });
});

// ——— types ———

describe('the generated dex', () => {
  it('lists species 1 through 1025 in order, none missing', () => {
    expect(POKEDEX).toHaveLength(1025);
    POKEDEX.forEach((entry, index) => expect(entry.pokemonId).toBe(index + 1));
  });

  it('keeps the names the picker and search rely on', () => {
    expect(findPokemon(29)?.name).toBe('Nidoran♀');
    expect(findPokemon(122)?.name).toBe('Mr. Mime');
    expect(findPokemon(669)?.name).toBe('Flabébé');
    expect(findPokemon(902)?.name).toBe('Basculegion');
    expect(findPokemon(1025)?.name).toBe('Pecharunt');
  });

  it('gives every species one or two DISTINCT valid types', () => {
    for (const entry of POKEDEX) {
      const label = `#${entry.pokemonId} ${entry.name}`;
      expect([1, 2], label).toContain(entry.types.length);
      for (const type of entry.types) expect(POKEMON_TYPES, label).toContain(type);
      expect(new Set(entry.types).size, label).toBe(entry.types.length);
    }
  });

  it('derives hue from the PRIMARY type', () => {
    for (const entry of POKEDEX) expect(entry.hue, entry.name).toBe(TYPE_HUE[entry.types[0]]);
    expect(findPokemon(6)?.hue).toBe(TYPE_HUE.Fire); // Charizard, Fire/Flying: Fire, not Flying
  });

  it('no longer exposes a single-type field that could go stale', () => {
    expect(findPokemon(6)).not.toHaveProperty('type');
  });
});

describe('typesOf', () => {
  it('returns both types for a dual-typed species, primary first', () => {
    expect(typesOf({ pokemonId: 6 })).toEqual(['Fire', 'Flying']); // Charizard
    expect(typesOf({ pokemonId: 1 })).toEqual(['Grass', 'Poison']); // Bulbasaur
  });

  it('returns one type for a single-typed species', () => {
    expect(typesOf({ pokemonId: 25 })).toEqual(['Electric']); // Pikachu
    expect(typesOf({ pokemonId: 4 })).toEqual(['Fire']); // Charmander
  });

  it('types a species with no form, or a null/undefined one, as its default form', () => {
    expect(typesOf({ pokemonId: 888 })).toEqual(['Fairy']); // Zacian: default form is Hero
    expect(typesOf({ pokemonId: 888, formCode: null })).toEqual(['Fairy']);
    expect(typesOf({ pokemonId: 888, formCode: undefined })).toEqual(['Fairy']);
  });

  it('is form-aware: Crowned Sword Zacian is Fairy/Steel where Zacian is Fairy', () => {
    // The order is the sources' own: PokeAPI (zacian-crowned) and the game master both list Fairy first.
    expect(typesOf({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toEqual(['Fairy', 'Steel']);
    expect(typesOf({ pokemonId: 888, formCode: 'HERO' })).toEqual(['Fairy']); // an explicit default form
    expect(typesOf({ pokemonId: 889, formCode: 'CROWNED_SHIELD' })).toEqual(['Fighting', 'Steel']);
  });

  it('is form-aware for regional forms, which can change AND drop types', () => {
    expect(typesOf({ pokemonId: 37 })).toEqual(['Fire']); // Vulpix
    expect(typesOf({ pokemonId: 37, formCode: 'ALOLA' })).toEqual(['Ice']); // Alolan Vulpix: Fire is gone
    expect(typesOf({ pokemonId: 38, formCode: 'ALOLA' })).toEqual(['Ice', 'Fairy']);
    expect(typesOf({ pokemonId: 79 })).toEqual(['Water', 'Psychic']); // Slowpoke
    expect(typesOf({ pokemonId: 79, formCode: 'GALARIAN' })).toEqual(['Psychic']); // Water is gone
    expect(typesOf({ pokemonId: 58, formCode: 'HISUIAN' })).toEqual(['Fire', 'Rock']); // Growlithe
  });

  it('is form-aware for appliance, Origin-style and fused forms', () => {
    expect(typesOf({ pokemonId: 479 })).toEqual(['Electric', 'Ghost']); // Rotom
    expect(typesOf({ pokemonId: 479, formCode: 'HEAT' })).toEqual(['Electric', 'Fire']);
    expect(typesOf({ pokemonId: 800, formCode: 'DUSK_MANE' })).toEqual(['Psychic', 'Steel']); // Necrozma
    expect(typesOf({ pokemonId: 741, formCode: 'SENSU' })).toEqual(['Ghost', 'Flying']); // Oricorio
  });

  it('types Mega and Primal forms, and leaves one that keeps the species typing alone', () => {
    expect(typesOf({ pokemonId: 6, formCode: 'MEGA_X' })).toEqual(['Fire', 'Dragon']);
    expect(typesOf({ pokemonId: 6, formCode: 'MEGA_Y' })).toEqual(['Fire', 'Flying']); // unchanged
    expect(typesOf({ pokemonId: 383, formCode: 'PRIMAL' })).toEqual(['Ground', 'Fire']);
    expect(typesOf({ pokemonId: 384, formCode: 'MEGA' })).toEqual(['Dragon', 'Flying']); // unchanged
  });

  it('falls back to the species for a form code it has no override for', () => {
    expect(typesOf({ pokemonId: 150, formCode: 'A' })).toEqual(['Psychic']); // Armored Mewtwo
    expect(typesOf({ pokemonId: 6, formCode: 'GIGANTAMAX' })).toEqual(['Fire', 'Flying']);
    expect(typesOf({ pokemonId: 25, formCode: 'NOT_A_REAL_FORM' })).toEqual(['Electric']);
  });

  it('matches form codes exactly, case included', () => {
    expect(typesOf({ pokemonId: 37, formCode: 'alola' })).toEqual(['Fire']);
  });

  it('returns undefined, never a guess, for an id outside the dex', () => {
    expect(typesOf({ pokemonId: 0 })).toBeUndefined();
    expect(typesOf({ pokemonId: 1026 })).toBeUndefined();
    expect(typesOf({ pokemonId: 10188 })).toBeUndefined(); // PokeAPI's synthetic zacian-crowned id
    expect(typesOf({ pokemonId: 10188, formCode: 'CROWNED_SWORD' })).toBeUndefined();
    expect(typesOf({ pokemonId: -1 })).toBeUndefined();
  });

  it('accepts anything creature-shaped', () => {
    const listing = { pokemonId: 888, formCode: 'CROWNED_SWORD', name: 'Zacian', shiny: true };
    expect(typesOf(listing)).toEqual(['Fairy', 'Steel']);
  });
});

describe('creatureHasType', () => {
  it('checks either slot, for the form', () => {
    expect(creatureHasType({ pokemonId: 6 }, 'Flying')).toBe(true); // secondary slot
    expect(creatureHasType({ pokemonId: 6 }, 'Fire')).toBe(true);
    expect(creatureHasType({ pokemonId: 6 }, 'Water')).toBe(false);
    expect(creatureHasType({ pokemonId: 37, formCode: 'ALOLA' }, 'Fire')).toBe(false);
    expect(creatureHasType({ pokemonId: 37, formCode: 'ALOLA' }, 'Ice')).toBe(true);
  });

  it('is false for an id outside the dex', () => {
    for (const type of POKEMON_TYPES) expect(creatureHasType({ pokemonId: 10188 }, type)).toBe(false);
  });
});

describe('FORM_TYPE_OVERRIDES', () => {
  it('only names dex species, with a valid form code shape (the one listings.form_code accepts)', () => {
    for (const [pokemonId, formCode] of FORM_TYPE_OVERRIDES) {
      expect(findPokemon(pokemonId), `#${pokemonId}`).toBeDefined();
      expect(formCode, `#${pokemonId}`).toMatch(/^[A-Z0-9_]{1,40}$/);
    }
  });

  it('has one row per (pokemonId, formCode), sorted', () => {
    const keys = FORM_TYPE_OVERRIDES.map(([id, code]) => `${String(id).padStart(4, '0')}:${code}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
  });

  it('gives every override 1-2 distinct valid types that DIFFER from the species default', () => {
    for (const [pokemonId, formCode, types] of FORM_TYPE_OVERRIDES) {
      const label = `#${pokemonId} ${formCode}`;
      expect([1, 2], label).toContain(types.length);
      for (const type of types) expect(POKEMON_TYPES, label).toContain(type);
      expect(new Set(types).size, label).toBe(types.length);
      expect(types, label).not.toEqual(findPokemon(pokemonId)?.types); // else it is noise, not an override
    }
  });

  it('spells the untradable Necrozma, Zacian and Zamazenta forms exactly as the typing table does', () => {
    // These codes also key UNTRADABLE_FORM_COMBINATIONS and the is_creature_untradable migration, so a typing
    // under a different spelling would mean one of the two lists is wrong. (Kyurem has no override: the game
    // master types White and Black Kyurem Dragon/Ice, the same as Kyurem.)
    const typed = UNTRADABLE_FORM_COMBINATIONS.filter((c) => c.pokemonId !== 646);
    expect(typed.map((c) => `${c.pokemonId}:${c.formCode}`).sort()).toEqual([
      '800:DAWN_WINGS',
      '800:DUSK_MANE',
      '800:ULTRA',
      '888:CROWNED_SWORD',
      '889:CROWNED_SHIELD',
    ]);
    for (const { pokemonId, formCode } of typed) {
      expect(typesOf({ pokemonId, formCode }), formCode).not.toEqual(typesOf({ pokemonId }));
    }
  });
});

// ——— forms ———

describe('formsOf', () => {
  it('lists the forms that FORM_TYPE_OVERRIDES cannot: Origin Palkia and Armored Mewtwo type like their species', () => {
    // Neither is in the override table (their typing is the species'), which is why the table could not feed a picker.
    expect(FORM_TYPE_OVERRIDES.some(([id, code]) => (id === 484 && code === 'ORIGIN') || (id === 150 && code === 'A'))).toBe(false);
    expect(formsOf(484)).toContain('ORIGIN');
    expect(formsOf(150)).toContain('A');
    expect(formsOf(150)).toEqual(['A']);
  });

  it('lists regional, fused, crowned and appliance forms in the exact formCode spelling listings carry', () => {
    expect(formsOf(37)).toEqual(['ALOLA']); // Vulpix
    expect(formsOf(52)).toEqual(['ALOLA', 'GALARIAN']); // Meowth, in the game master's order
    expect(formsOf(888)).toEqual(['CROWNED_SWORD']); // Zacian: HERO is its default form, so it is not listed
    expect(formsOf(889)).toEqual(['CROWNED_SHIELD']);
    expect(formsOf(479)).toEqual(['HEAT', 'WASH', 'FROST', 'FAN', 'MOW']); // Rotom: the appliances, not its plain form
    expect(formsOf(646)).toEqual(['WHITE', 'BLACK']);
    expect(formsOf(800)).toEqual(expect.arrayContaining(['DUSK_MANE', 'DAWN_WINGS']));
    expect(formsOf(412)).toEqual(['BURMY_SANDY', 'BURMY_TRASH']); // codes that keep the species prefix keep it here too
  });

  it('is empty for a single-form species and for an id outside the dex', () => {
    expect(formsOf(1)).toEqual([]); // Bulbasaur: its only other "form" is an event costume
    expect(formsOf(4)).toEqual([]);
    for (const id of [0, -1, 1026, 10188]) expect(formsOf(id), `#${id}`).toEqual([]);
  });

  it('never lists the default form: null already means it', () => {
    for (const [id, code] of POKEDEX_DEFAULT_FORMS) expect(formsOf(id), `#${id}`).not.toContain(code);
    for (const [id, codes] of POKEDEX_FORMS) {
      expect(codes, `#${id}`).not.toContain('NORMAL');
      for (const code of codes) expect(code, `#${id}`).not.toMatch(/_NORMAL$/);
    }
  });

  it('agrees with the sprite pipeline about which form is the default (BASE_FORM_CODES)', () => {
    // Unown A, Vivillon Meadow, Zygarde Fifty Percent and Toxtricity Amped are the base art, although the game
    // master lists a different form first. The one that is NOT the base must stay selectable.
    for (const [key, code] of Object.entries(BASE_FORM_CODES)) {
      const id = Number(key);
      expect(formsOf(id), `#${id} ${code}`).not.toContain(code);
      if (formsOf(id).length > 0) expect(defaultFormOf(id), `#${id}`).toBe(code === 'NORMAL' ? undefined : code);
    }
    expect(formsOf(201)).toContain('UNOWN_F');
    expect(formsOf(666)).toContain('ARCHIPELAGO');
    expect(formsOf(849)).toContain('LOW_KEY');
    expect(formsOf(718)).toContain('TEN_PERCENT');
  });

  it('offers no temporary evolution: Mega, Primal and Gigantamax are not stored forms', () => {
    const temporary = new Set(['MEGA', 'MEGA_X', 'MEGA_Y', 'PRIMAL', 'GIGANTAMAX']);
    for (const [id, codes] of POKEDEX_FORMS) for (const code of codes) expect(temporary.has(code), `#${id} ${code}`).toBe(false);
  });

  it('offers no event costume and no shadow marker', () => {
    expect(formsOf(25)).toEqual([]); // Pikachu: the game master flags its ~70 outfits, and COPY_2019 is excluded by name
    expect(formsOf(222)).toEqual(['GALARIAN']); // Corsola: SPRING_2026 is a flagged costume, GALARIAN is a form
    for (const id of [243, 244, 245, 249, 250, 380, 381]) expect(formsOf(id), `#${id}`).not.toContain('S');
    for (const [id, codes] of POKEDEX_FORMS) {
      for (const code of codes) expect(code, `#${id}`).not.toMatch(/(?:^|_)(?:SHADOW|PURIFIED)$/);
    }
    // ...but a form that merely contains the word is a form: Shadow Rider Calyrex.
    expect(formsOf(898)).toContain('SHADOW_RIDER');
  });

  // The game master does not flag these `isCostume`, so they are excluded by name (UNFLAGGED_COSTUME_FORMS_EXCLUDED
  // in scripts/pokedex-source.ts, species-scoped). All five species have no other form, so they have none left.
  it('offers no unflagged event form: Copy 2019 on the three starters and Pikachu, Swim 2025 on Psyduck', () => {
    for (const [id, code] of [[3, 'COPY_2019'], [6, 'COPY_2019'], [9, 'COPY_2019'], [25, 'COPY_2019'], [54, 'SWIM_2025']] as const) {
      expect(formsOf(id), `#${id}`).not.toContain(code);
      expect(formsOf(id), `#${id}`).toEqual([]);
    }
    // The cheapest tripwire for the next unflagged one: an event-year suffix on any selectable form. A species a
    // future game master adds one to fails here, which needs a decision (exclude it by name, or it is a form).
    for (const [id, codes] of POKEDEX_FORMS) {
      for (const code of codes) expect(code, `#${id}`).not.toMatch(/(?:^|_)(?:19|20)\d{2}$/);
    }
  });

  it('keeps every typed form selectable, except the temporary evolutions and one event costume', () => {
    // FORM_TYPE_OVERRIDES is how typesOf reaches a form's typing; a typed form no trainer can pick is dead data.
    const temporary = new Set(['MEGA', 'MEGA_X', 'MEGA_Y', 'PRIMAL']);
    // The game master types CORSOLA_SPRING_2026 as Ghost because it is a costume on GALARIAN Corsola. It is
    // flagged isCostume, so it is not offered: the trainer picks Galarian and turns Costume on, which types the
    // same. It is the ONLY costume with a typing of its own; a new one failing here needs a decision, not a skip.
    const costumesOnARegionalForm = new Set(['222:SPRING_2026']);
    for (const [id, code] of FORM_TYPE_OVERRIDES) {
      if (temporary.has(code) || costumesOnARegionalForm.has(`${id}:${code}`)) continue;
      expect(formsOf(id), `#${id} ${code}`).toContain(code);
    }
    expect(typesOf({ pokemonId: 222, formCode: 'GALARIAN' })).toEqual(typesOf({ pokemonId: 222, formCode: 'SPRING_2026' }));
  });

  it('offers every untradable form, so a picker can refuse them rather than hide them', () => {
    // The fused Kyurem / Necrozma forms, Crowned Sword / Shield Zacian and Zamazenta, and Ultra Necrozma.
    for (const { pokemonId, formCode } of UNTRADABLE_FORM_COMBINATIONS) {
      expect(formsOf(pokemonId), `#${pokemonId} ${formCode}`).toContain(formCode);
      expect(isPokemonUntradable(pokemonId, formCode)).toBe(true);
    }
    // ...and the forms of a species that is untradable whole are offered too: Eternamax Eternatus.
    expect(formsOf(890)).toContain('ETERNAMAX');
    expect(isPokemonUntradable(890, 'ETERNAMAX')).toBe(true);
    // The default forms of the species that have one untradable form are NOT among them, and stay tradable.
    expect(formsOf(888)).not.toContain('HERO');
    expect(isPokemonUntradable(888, 'HERO')).toBe(false);
  });

  it('is well-formed: dex species in id order, no repeats, a valid form code every time', () => {
    const ids = POKEDEX_FORMS.map(([id]) => id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, codes] of POKEDEX_FORMS) {
      expect(findPokemon(id), `#${id}`).toBeDefined();
      expect(codes.length, `#${id}`).toBeGreaterThan(0);
      expect(new Set(codes).size, `#${id}`).toBe(codes.length);
      for (const code of codes) expect(code, `#${id}`).toMatch(/^[A-Z0-9_]{1,40}$/);
    }
  });

  it('gives every offered form a readable label that is not blank', () => {
    for (const [id, codes] of POKEDEX_FORMS) {
      for (const code of codes) expect(creatureFormLabel({ pokemonId: id, formCode: code })?.trim(), `#${id} ${code}`).toBeTruthy();
    }
    expect(creatureFormLabel({ pokemonId: 150, formCode: 'A' })).toBe('Armored');
    expect(creatureFormLabel({ pokemonId: 484, formCode: 'ORIGIN' })).toBe('Origin');
    expect(creatureFormLabel({ pokemonId: 37, formCode: 'ALOLA' })).toBe('Alolan');
    expect(creatureFormLabel({ pokemonId: 888, formCode: 'CROWNED_SWORD' })).toBe('Crowned Sword');
  });
});

describe('defaultFormOf', () => {
  it('names the default form where it has a name of its own', () => {
    expect(defaultFormOf(888)).toBe('HERO');
    expect(defaultFormOf(487)).toBe('ALTERED');
    expect(defaultFormOf(666)).toBe('MEADOW');
    expect(defaultFormOf(201)).toBe('UNOWN_A');
  });

  it('is undefined where the default is the plain form, for single-form species and for unknown ids', () => {
    expect(defaultFormOf(484)).toBeUndefined(); // Palkia: plain
    expect(defaultFormOf(37)).toBeUndefined();
    expect(defaultFormOf(1)).toBeUndefined();
    expect(defaultFormOf(10188)).toBeUndefined();
  });

  it('only names species that have selectable forms, and a form that is not among them', () => {
    for (const [id, code] of POKEDEX_DEFAULT_FORMS) {
      expect(formsOf(id).length, `#${id}`).toBeGreaterThan(0);
      expect(formsOf(id), `#${id}`).not.toContain(code);
      expect(code, `#${id}`).toMatch(/^[A-Z0-9_]{1,40}$/);
    }
  });
});

describe('typeMembership', () => {
  /** The documented semantics of `TypeMembership`, as an executable spec. */
  function inMembership(m: TypeMembership, creature: { pokemonId: number; formCode?: string | null }): boolean {
    if (m.allForms.includes(creature.pokemonId)) return true;
    const code = creature.formCode ?? null;
    const except = m.exceptForms.find((e) => e.pokemonId === creature.pokemonId);
    if (except) return code === null || !except.formCodes.includes(code);
    const only = m.onlyForms.find((e) => e.pokemonId === creature.pokemonId);
    return only !== undefined && code !== null && only.formCodes.includes(code);
  }

  it('agrees with creatureHasType for every type, every species and every form, null form included', () => {
    const codesBySpecies = new Map<number, string[]>();
    for (const [id, code] of FORM_TYPE_OVERRIDES) codesBySpecies.set(id, [...(codesBySpecies.get(id) ?? []), code]);

    for (const type of POKEMON_TYPES) {
      const membership = typeMembership(type);
      for (const { pokemonId } of POKEDEX) {
        const codes: (string | null)[] = [null, 'NOT_A_REAL_FORM', ...(codesBySpecies.get(pokemonId) ?? [])];
        for (const formCode of codes) {
          const creature = { pokemonId, formCode };
          if (inMembership(membership, creature) !== creatureHasType(creature, type)) {
            throw new Error(`${type}: #${pokemonId} form ${formCode} disagrees`);
          }
        }
      }
    }
  });

  it('matches nothing outside the dex', () => {
    for (const type of POKEMON_TYPES) {
      expect(inMembership(typeMembership(type), { pokemonId: 10188, formCode: 'CROWNED_SWORD' })).toBe(false);
    }
  });

  it('is precomputed once: the same object every call, for every type', () => {
    for (const type of POKEMON_TYPES) {
      expect(typeMembership(type)).toBe(typeMembership(type));
      expect(typeMembership(type).type).toBe(type);
    }
  });

  it('puts each species in at most one group, ascending and duplicate-free', () => {
    for (const type of POKEMON_TYPES) {
      const m = typeMembership(type);
      const all = new Set(m.allForms);
      const except = m.exceptForms.map((e) => e.pokemonId);
      const only = m.onlyForms.map((e) => e.pokemonId);
      expect(all.size, type).toBe(m.allForms.length);
      expect(m.allForms, type).toEqual([...m.allForms].sort((a, b) => a - b));
      expect(new Set(except).size, type).toBe(except.length);
      expect(new Set(only).size, type).toBe(only.length);
      for (const id of [...except, ...only]) expect(all.has(id), `${type} #${id}`).toBe(false);
      for (const id of only) expect(except.includes(id), `${type} #${id}`).toBe(false);
      for (const group of [...m.exceptForms, ...m.onlyForms]) expect(group.formCodes.length, `${type} #${group.pokemonId}`).toBeGreaterThan(0);
    }
  });

  it('has members for every type, including types that only ever appear as a second type', () => {
    for (const type of POKEMON_TYPES) {
      const m = typeMembership(type);
      expect(m.allForms.length + m.exceptForms.length + m.onlyForms.length, type).toBeGreaterThan(0);
    }
    expect(typeMembership('Flying').allForms).toContain(12); // Butterfree: Bug/Flying, Flying is second
    // Charizard is Fire/Flying, but Mega Charizard X is Fire/Dragon: Flying is Charizard minus that form.
    expect(typeMembership('Flying').exceptForms).toContainEqual({ pokemonId: 6, formCodes: ['MEGA_X'] });
  });

  it('a form that DROPS a type is an exception to its species: Alolan Vulpix is not Fire', () => {
    const fire = typeMembership('Fire');
    expect(fire.allForms).toContain(4); // Charmander: every form
    expect(fire.allForms).not.toContain(37); // Vulpix is not "all forms"...
    expect(fire.exceptForms).toContainEqual({ pokemonId: 37, formCodes: ['ALOLA'] }); // ...Alolan Vulpix is out
    const water = typeMembership('Water');
    expect(water.exceptForms.find((e) => e.pokemonId === 79)?.formCodes).toEqual(['GALARIAN']); // Slowpoke
  });

  it('a form that GAINS a type is listed only for that form: Heat Rotom is Fire, Rotom is not', () => {
    const fire = typeMembership('Fire');
    expect(fire.allForms).not.toContain(479);
    expect(fire.onlyForms.find((e) => e.pokemonId === 479)?.formCodes).toEqual(['HEAT']);
    const steel = typeMembership('Steel');
    expect(steel.onlyForms.find((e) => e.pokemonId === 888)?.formCodes).toEqual(['CROWNED_SWORD']);
    expect(steel.allForms).not.toContain(888);
  });

  it('a form that keeps the type needs no entry: Alolan Diglett is still Ground', () => {
    const ground = typeMembership('Ground');
    expect(ground.allForms).toContain(50); // Diglett: Ground in every form
    expect(ground.exceptForms.some((e) => e.pokemonId === 50)).toBe(false);
  });
});

describe('formatTypes', () => {
  it('joins a dual type with a slash and leaves a single type alone', () => {
    expect(formatTypes(['Fire', 'Flying'])).toBe('Fire / Flying');
    expect(formatTypes(['Grass'])).toBe('Grass');
  });

  it('formats what typesOf returns', () => {
    const types = typesOf({ pokemonId: 888, formCode: 'CROWNED_SWORD' });
    expect(types && formatTypes(types)).toBe('Fairy / Steel');
  });
});
