/**
 * Builds the object keys and public URLs for sprite (and background) art mirrored into this project's
 * own `sprites` Supabase Storage bucket (supabase/migrations/20260927000400_sprites_bucket.sql) by
 * `scripts/mirror-assets.ts` — the app never depends on raw.githubusercontent.com / PokeAPI at runtime.
 *
 * RELATIVE IMPORTS ONLY, and no `react-native` / `expo-*` / `lib/supabase.ts`: this file is loaded
 * directly by `scripts/mirror-assets.ts` under `tsx` (a plain Node process with no Metro/babel `@/`
 * alias resolution and no RN runtime) and by vitest.
 *
 * `spriteObjectKey` is the ONE place either the app or the mirror script may build a sprite key — see
 * this repo's agent rules on a single key function. Everything else here (`getSpriteUrl`,
 * `spriteCandidates`) is a thin wrapper around it plus `storagePublicUrl`.
 */
import { findPokemon } from '../constants/pokedex';

export const SPRITE_BUCKET = 'sprites';
/** The folder every `spriteObjectKey` lives under (the mirror lists it to skip existing keys). */
export const SPRITE_FOLDER = 'pokemon';

export interface SpriteVariant {
  pokemonId: number;
  shiny?: boolean;
  /** Regional/mega/gigantamax/size form code, PokeMiners' own naming (e.g. `'ALOLA'`, `'MEGA'`). */
  form?: string | null;
  /** Event costume code, PokeMiners' own naming (e.g. `'JAN_2020_NOEVOLVE'`). */
  costume?: string | null;
}

/**
 * The shape every creature-ish value in the app already carries (`CreatureRef`, `FormalOffer`, a
 * `PokedexEntry` plus a shiny flag, ...) — `formCode`/`costumeCode` are the app-facing field names
 * (`data/types.ts`), distinct from `SpriteVariant`'s `form`/`costume`, which are this module's own
 * internal naming carried over from before those app-facing fields existed. `spriteVariantOf` is the
 * one place that translates between the two, so nothing else has to know they're different names for
 * the same PokeMiners code.
 */
export interface SpriteSubject {
  pokemonId: number;
  shiny?: boolean;
  formCode?: string | null;
  costumeCode?: string | null;
}

/** `SpriteSubject` (app-facing field names) -> `SpriteVariant` (this module's field names). The only
 *  place that mapping happens, so a caller never hand-rolls `{ form: creature.formCode, ... }` itself. */
export function spriteVariantOf(subject: SpriteSubject): SpriteVariant {
  return {
    pokemonId: subject.pokemonId,
    shiny: subject.shiny,
    form: subject.formCode,
    costume: subject.costumeCode,
  };
}

/** A stable primitive key for `useMemo`/state-reset purposes — callers routinely pass a fresh
 *  `{ pokemonId, shiny, ... }` object literal every render, so identity can't be the dependency.
 *  Also doubles as the "same species+variant" comparison for `PokemonPickerModal`'s exclude set: two
 *  shiny/non-shiny (or form/costume) variants of the same species produce different keys on purpose. */
export function spriteVariantKey(v: SpriteVariant): string {
  return `${v.pokemonId}:${v.shiny ? 1 : 0}:${v.form ?? ''}:${v.costume ?? ''}`;
}

/**
 * A form/costume code is only ever safe to fold into a storage key if it is the bare token PokeMiners
 * itself uses — `[A-Z0-9_]+`, underscores included (`JAN_2020_NOEVOLVE`, `ALOLA`). Upstream is not
 * perfectly consistent about this (a live checkout of PokeMiners/pogo_assets turned up
 * `pm133.cMay_2023.icon.png` sitting right next to the correctly-cased `pm133.cMAY_2023.s.icon.png`),
 * so anything that doesn't match is silently dropped rather than smuggled into a key verbatim — it
 * folds back to the plain species (or species+shiny) key instead of producing a broken/unpredictable
 * one. That fold is right for a READ (the app falls back to the base sprite), but wrong for a WRITE:
 * the mirror would upload Eevee's costume art as Eevee's base. So `scripts/pokeminers.ts` checks
 * `isSpriteCode` and refuses such a source file before it is ever keyed.
 */
const CODE_RE = /^[A-Z0-9_]+$/;

export function isSpriteCode(code: string): boolean {
  return CODE_RE.test(code);
}

function normalizeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return isSpriteCode(code) ? code : null;
}

/**
 * `pokemon/{pokemonId}[.f{FORM}][.c{COSTUME}][.s].png` — unpadded national dex number, and a fixed
 * form -> costume -> shiny layer order regardless of the order fields are supplied in, so the same
 * Pokémon+variant always resolves to exactly one key no matter which caller builds it.
 */
export function spriteObjectKey(v: SpriteVariant): string {
  const form = normalizeCode(v.form);
  const costume = normalizeCode(v.costume);
  let key = `${SPRITE_FOLDER}/${v.pokemonId}`;
  if (form) key += `.f${form}`;
  if (costume) key += `.c${costume}`;
  if (v.shiny) key += '.s';
  return `${key}.png`;
}

/** Background item art (profile hero / listing backdrop), keyed by whatever id names that item —
 *  a separate, flat namespace from `pokemon/...`, with no form/costume/shiny axis of its own. `null`
 *  for an id that isn't a bare `[A-Z0-9_]+` code, for the same reason as `CODE_RE`. */
export function backgroundObjectKey(id: string | number): string | null {
  const code = String(id);
  return isSpriteCode(code) ? `backgrounds/${code}.png` : null;
}

/** `null` when `EXPO_PUBLIC_SUPABASE_URL` isn't set — callers treat that the same as "no candidates",
 *  never as a reason to fall back to some other host (R5: no PokeAPI sprites, ever). A trailing slash
 *  in the env value is tolerated rather than producing `//storage/...`. */
export function storagePublicUrl(key: string): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${SPRITE_BUCKET}/${key}`;
}

export function getSpriteUrl(v: SpriteVariant): string | null {
  return storagePublicUrl(spriteObjectKey(v));
}

/**
 * Ordered, deduplicated fallback chain from most to least specific, for `lib/use-sprite-source.ts` to
 * walk one at a time as each candidate 404s:
 *   1. the full key (only if `form` or `costume` was supplied)
 *   2. `form` + shiny, costume dropped (only if BOTH `form` and `costume` were supplied)
 *   3. species + shiny
 *   4. species base, no shiny (only if `shiny` is set)
 *
 * Steps 1/2 gate on whether `form`/`costume` were *supplied*, not whether they survive
 * `normalizeCode` — an invalid code collapses step 1 down to the same key step 3 already produces
 * (see `CODE_RE`'s doc comment), and the dedup below is what keeps that from appearing twice.
 *
 * A synthetic id with no `POKEDEX` entry (e.g. a PokéAPI-only forme id) can never have a mirrored
 * sprite, so it — and a request made with no bucket base URL at all — short-circuits to `[]`, which
 * `useSpriteSource` reads as "exhausted" on the very first render instead of ever making a request.
 */
export function spriteCandidates(v: SpriteVariant): string[] {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !findPokemon(v.pokemonId)) return [];

  const hasForm = Boolean(v.form);
  const hasCostume = Boolean(v.costume);

  const wanted: SpriteVariant[] = [];
  if (hasForm || hasCostume) wanted.push(v);
  if (hasForm && hasCostume) wanted.push({ pokemonId: v.pokemonId, shiny: v.shiny, form: v.form });
  wanted.push({ pokemonId: v.pokemonId, shiny: v.shiny });
  if (v.shiny) wanted.push({ pokemonId: v.pokemonId });

  const urls: string[] = [];
  for (const variant of wanted) {
    const url = getSpriteUrl(variant);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
