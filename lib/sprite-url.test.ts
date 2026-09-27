/**
 * Unit tests for `lib/sprite-url.ts` — the ONE place a sprite storage key gets built (see that file's
 * header comment). Covers `spriteObjectKey`'s format/layer-order, `storagePublicUrl`'s env gate, and
 * `spriteCandidates`'s ordering/dedup/synthetic-id-exhaustion rules.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  backgroundObjectKey,
  getSpriteUrl,
  isSpriteCode,
  spriteCandidates,
  spriteObjectKey,
  storagePublicUrl,
} from './sprite-url';

const ORIGINAL_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
});

describe('spriteObjectKey', () => {
  it('is just the unpadded dex number for a plain species', () => {
    expect(spriteObjectKey({ pokemonId: 25 })).toBe('pokemon/25.png');
  });

  it('appends .s for shiny, with nothing else set', () => {
    expect(spriteObjectKey({ pokemonId: 25, shiny: true })).toBe('pokemon/25.s.png');
  });

  it('folds in a form as .f{FORM}', () => {
    expect(spriteObjectKey({ pokemonId: 19, form: 'ALOLA' })).toBe('pokemon/19.fALOLA.png');
  });

  it('folds in a costume as .c{COSTUME}, underscores included', () => {
    expect(spriteObjectKey({ pokemonId: 25, costume: 'JAN_2020_NOEVOLVE' })).toBe(
      'pokemon/25.cJAN_2020_NOEVOLVE.png',
    );
  });

  it('layers form -> costume -> shiny, regardless of field order in the input', () => {
    const withOtherFieldOrder = { shiny: true, costume: 'GOFEST_2021_NOEVOLVE', pokemonId: 263, form: 'GALARIAN' };
    expect(spriteObjectKey(withOtherFieldOrder)).toBe('pokemon/263.fGALARIAN.cGOFEST_2021_NOEVOLVE.s.png');
  });

  it('drops a form/costume code that is not bare [A-Z0-9_]+ (e.g. real upstream casing typos)', () => {
    // A live checkout of PokeMiners/pogo_assets has `pm133.cMay_2023.icon.png` right next to the
    // correctly-cased `pm133.cMAY_2023.s.icon.png` — the bad-cased one must fold back to the plain key.
    expect(spriteObjectKey({ pokemonId: 133, costume: 'May_2023' })).toBe('pokemon/133.png');
    expect(spriteObjectKey({ pokemonId: 19, form: 'Alola' })).toBe('pokemon/19.png');
  });

  it('treats null/undefined form and costume as absent', () => {
    expect(spriteObjectKey({ pokemonId: 1, form: null, costume: undefined })).toBe('pokemon/1.png');
  });
});

describe('backgroundObjectKey', () => {
  it('keys a background item by its id, string or number', () => {
    expect(backgroundObjectKey('GOFEST_2024')).toBe('backgrounds/GOFEST_2024.png');
    expect(backgroundObjectKey(3)).toBe('backgrounds/3.png');
  });

  it('is null for an id that is not a bare [A-Z0-9_]+ code, never interpolated into a key', () => {
    expect(backgroundObjectKey('meta')).toBeNull();
    expect(backgroundObjectKey('../pokemon/25')).toBeNull();
    expect(backgroundObjectKey('')).toBeNull();
  });
});

describe('isSpriteCode', () => {
  it('accepts PokeMiners-style codes and rejects bad casing / punctuation / empty', () => {
    expect(isSpriteCode('JAN_2020_NOEVOLVE')).toBe(true);
    expect(isSpriteCode('ALOLA')).toBe(true);
    expect(isSpriteCode('May_2023')).toBe(false);
    expect(isSpriteCode('A.B')).toBe(false);
    expect(isSpriteCode('')).toBe(false);
  });
});

describe('storagePublicUrl / getSpriteUrl', () => {
  it('is null when EXPO_PUBLIC_SUPABASE_URL is unset', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(storagePublicUrl('pokemon/25.png')).toBeNull();
    expect(getSpriteUrl({ pokemonId: 25 })).toBeNull();
  });

  it('builds the public Storage object URL under the sprites bucket when the env var is set', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    expect(storagePublicUrl('pokemon/25.png')).toBe(
      'https://example.supabase.co/storage/v1/object/public/sprites/pokemon/25.png',
    );
    expect(getSpriteUrl({ pokemonId: 25, shiny: true })).toBe(
      'https://example.supabase.co/storage/v1/object/public/sprites/pokemon/25.s.png',
    );
  });

  it('tolerates a trailing slash on the env value', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co/';
    expect(storagePublicUrl('pokemon/25.png')).toBe(
      'https://example.supabase.co/storage/v1/object/public/sprites/pokemon/25.png',
    );
  });
});

describe('spriteCandidates', () => {
  const BASE = 'https://example.supabase.co';
  const url = (key: string) => `${BASE}/storage/v1/object/public/sprites/${key}`;

  it('is empty when EXPO_PUBLIC_SUPABASE_URL is unset, even for a real dex id', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(spriteCandidates({ pokemonId: 25 })).toEqual([]);
  });

  it('is empty for a synthetic id with no POKEDEX entry — and exhausts instantly, not by 404ing', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    // 10188 is Zacian-Crowned's PokéAPI forme id, not a national dex number — data/listings.ts's own
    // comment on why: it has no POKEDEX row.
    expect(spriteCandidates({ pokemonId: 10188 })).toEqual([]);
  });

  it('is just the species base for a plain, non-shiny, no-form/costume request', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    expect(spriteCandidates({ pokemonId: 1 })).toEqual([url('pokemon/1.png')]);
  });

  it('tries species+shiny before falling back to the non-shiny species base', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    expect(spriteCandidates({ pokemonId: 1, shiny: true })).toEqual([
      url('pokemon/1.s.png'),
      url('pokemon/1.png'),
    ]);
  });

  it('form only: full key, then species+shiny, then species base', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    expect(spriteCandidates({ pokemonId: 19, form: 'ALOLA', shiny: true })).toEqual([
      url('pokemon/19.fALOLA.s.png'),
      url('pokemon/19.s.png'),
      url('pokemon/19.png'),
    ]);
  });

  it('form + costume, shiny: full key, then form+shiny (costume dropped), then species+shiny, then species base', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    expect(
      spriteCandidates({ pokemonId: 263, form: 'GALARIAN', costume: 'GOFEST_2021_NOEVOLVE', shiny: true }),
    ).toEqual([
      url('pokemon/263.fGALARIAN.cGOFEST_2021_NOEVOLVE.s.png'),
      url('pokemon/263.fGALARIAN.s.png'),
      url('pokemon/263.s.png'),
      url('pokemon/263.png'),
    ]);
  });

  it('form + costume, not shiny: full key, then form only, then species base (no shiny-base step)', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    expect(spriteCandidates({ pokemonId: 263, form: 'GALARIAN', costume: 'GOFEST_2021_NOEVOLVE' })).toEqual([
      url('pokemon/263.fGALARIAN.cGOFEST_2021_NOEVOLVE.png'),
      url('pokemon/263.fGALARIAN.png'),
      url('pokemon/263.png'),
    ]);
  });

  it('dedupes when an invalid form code collapses the full-key step onto the species+shiny step', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
    // form: 'May_2023'-style bad casing normalizes away, so step 1 (full key) and step 3 (species+shiny)
    // land on the identical URL — it must appear exactly once, not twice.
    expect(spriteCandidates({ pokemonId: 133, form: 'May_2023', shiny: true })).toEqual([
      url('pokemon/133.s.png'),
      url('pokemon/133.png'),
    ]);
  });
});
