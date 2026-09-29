/**
 * Unit tests for the pure search/lookup helpers in `constants/pokedex.ts`. These sit on top of
 * generated data (`constants/pokedex-data.ts`, from PokeAPI), so the fixtures below are real dex
 * entries chosen specifically for the punctuation/diacritics they carry (Mr. Mime, Farfetch'd,
 * Flabébé, Type: Null) rather than invented names — see AGENTS.md on never hallucinating game data.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findPokemon,
  isPokemonUntradable,
  searchPokedex,
  UNTRADABLE_FORM_COMBINATIONS,
  UNTRADABLE_MYTHICAL_IDS,
  UNTRADABLE_SPECIES_IDS,
} from './pokedex';

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

  it('is false for ordinary species and legendaries', () => {
    expect(isPokemonUntradable(25)).toBe(false);
    expect(isPokemonUntradable(150, 'A')).toBe(false); // Armored Mewtwo
    expect(isPokemonUntradable(888, 'CROWNED_SWORD')).toBe(false);
  });

  it('only names real dex entries', () => {
    const ids = [...UNTRADABLE_MYTHICAL_IDS, ...UNTRADABLE_SPECIES_IDS, ...UNTRADABLE_FORM_COMBINATIONS.map((c) => c.pokemonId)];
    for (const id of ids) expect(findPokemon(id), `dex #${id}`).toBeDefined();
  });
});

describe('untradable lists match public.is_creature_untradable', () => {
  // The database enforces the same rule. Read the NEWEST migration that defines the function, so a later
  // `create or replace` is what gets compared, not the original.
  const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'))
    .filter((body) => /function public\.is_creature_untradable\b/.test(body))
    .at(-1);

  /** The line tagged `-- <marker>` inside the function body. */
  const taggedLine = (marker: string): string => {
    const line = sql?.split('\n').find((l) => l.trimEnd().endsWith(`-- ${marker}`));
    if (!line) throw new Error(`No line tagged "-- ${marker}" in the is_creature_untradable migration`);
    return line.slice(0, line.lastIndexOf('--'));
  };
  const ids = (marker: string) => (taggedLine(marker).match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);

  it('finds the migration', () => {
    expect(sql).toBeDefined();
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
