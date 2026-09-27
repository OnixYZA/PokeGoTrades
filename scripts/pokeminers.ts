/**
 * Parses filenames out of PokeMiners/pogo_assets' `Images/Pokemon - 256x256/Addressable Assets`
 * folder — the source `scripts/mirror-assets.ts` mirrors into this project's `sprites` Storage bucket.
 *
 * RELATIVE IMPORTS ONLY, and no `react-native` / `expo-*` / `lib/supabase.ts` (R1): this file is
 * loaded directly by `scripts/mirror-assets.ts` under `tsx` (a plain Node process with no Metro/babel
 * `@/` alias resolution) and by vitest.
 *
 * The real naming convention (verified against a live checkout of the upstream repo while writing
 * this — not guessed) is:
 *
 *   pm{dex}[.f{FORM}][.c{COSTUME}][.g2][.s].icon.png
 *
 * — the national dex number, unpadded; an optional form code (regional/mega/gigantamax/size variants,
 * e.g. `fALOLA`, `fMEGA`); an optional costume code (event outfits, e.g. `cJAN_2020_NOEVOLVE`); an
 * optional `.g2` marking the alternate-gender icon (Pyroar, Frillish, Jellicent, ...); and an optional
 * `.s` for shiny. Form always precedes costume, which always precedes `.g2`, which always precedes
 * `.s` — no other order appears anywhere in the upstream folder. A sibling `.portrait.png` asset
 * exists per icon (the large "about to be caught" art); it is intentionally NOT matched here —
 * `spriteObjectKey` (lib/sprite-url.ts) has no equivalent key for it, so `mirror-assets.ts` has
 * nothing to do with one.
 *
 * The parser is deliberately permissive about the form/costume TEXT itself: upstream is not perfectly
 * consistent about casing (a live checkout has `pm133.cMay_2023.icon.png` sitting right next to the
 * correctly-cased `pm133.cMAY_2023.s.icon.png`), so it extracts raw tokens and `planMirror` below
 * decides. `planMirror` REFUSES a file whose code fails `isSpriteCode`. It must not hand that file to
 * `spriteObjectKey`, which would fold the bad code away and upload Eevee's May 2023 costume as Eevee's
 * base sprite.
 */
import { findPokemon } from '../constants/pokedex';
import { isSpriteCode, spriteObjectKey } from '../lib/sprite-url';

export interface ParsedPokeMinersIcon {
  pokemonId: number;
  form: string | null;
  costume: string | null;
  shiny: boolean;
  /** The alternate-gender (`.g2`) icon. `mirror-assets.ts` always drops these: `spriteObjectKey` has
   *  no gender axis, and mirroring one gender's art under the same key as the other's would be exactly
   *  the "two source files, one key" mistake that script exists to refuse. */
  gender2: boolean;
}

const ICON_NAME = /^pm(\d+)(?:\.f([^.]+))?(?:\.c([^.]+))?(?:\.(g2))?(?:\.(s))?\.icon\.png$/;

/** `null` for anything that isn't a recognized icon filename — a `.portrait.png` sibling, a stray
 *  README, or one of the handful of genuinely malformed upstream names (e.g. `pm479.f.icon.png`,
 *  which really exists, with an empty form token). Callers skip a `null` result rather than guess. */
export function parsePokeMinersIcon(fileName: string): ParsedPokeMinersIcon | null {
  const match = ICON_NAME.exec(fileName);
  if (!match) return null;
  const [, id, form, costume, gender2, shiny] = match;
  return {
    pokemonId: Number(id),
    form: form ?? null,
    costume: costume ?? null,
    shiny: shiny === 's',
    gender2: gender2 === 'g2',
  };
}

export interface MirrorScope {
  forms: boolean;
  costumes: boolean;
  /** Inclusive pokemonId bounds, or `null` for every id in the Pokédex. */
  range: [number, number] | null;
}

export interface PlannedUpload {
  key: string;
  sourceFile: string;
}

export interface MirrorPlan {
  uploads: PlannedUpload[];
  /** In-scope source files refused because a form/costume code fails `isSpriteCode` (see header). */
  invalidCode: string[];
  /** Two distinct source files resolving to one key. With invalid codes refused up front this should
   *  never happen; it stays as a guard, and neither file is uploaded. */
  collisions: string[];
  /** In-range Pokédex ids with no base (non-shiny, no form/costume) icon upstream. They render the
   *  initial-letter placeholder in the app. */
  missingBase: number[];
}

function inRange(pokemonId: number, range: [number, number] | null): boolean {
  return range === null || (pokemonId >= range[0] && pokemonId <= range[1]);
}

/** Pure: source listing + scope -> what to upload. Every key comes from `spriteObjectKey` (R4). */
export function planMirror(sourceFiles: readonly string[], scope: MirrorScope): MirrorPlan {
  const sourcesByKey = new Map<string, string[]>();
  const invalidCode: string[] = [];
  const hasBase = new Set<number>();

  for (const file of sourceFiles) {
    const parsed = parsePokeMinersIcon(file);
    if (!parsed || parsed.gender2) continue; // not an icon, or the alternate gender (no gender axis in the key)
    if (!findPokemon(parsed.pokemonId) || !inRange(parsed.pokemonId, scope.range)) continue;
    if (!parsed.form && !parsed.costume && !parsed.shiny) hasBase.add(parsed.pokemonId);
    if (parsed.form && !scope.forms) continue;
    if (parsed.costume && !scope.costumes) continue;
    if ((parsed.form && !isSpriteCode(parsed.form)) || (parsed.costume && !isSpriteCode(parsed.costume))) {
      invalidCode.push(file);
      continue;
    }
    const key = spriteObjectKey(parsed);
    sourcesByKey.set(key, [...(sourcesByKey.get(key) ?? []), file]);
  }

  const uploads: PlannedUpload[] = [];
  const collisions: string[] = [];
  for (const [key, files] of sourcesByKey) {
    if (files.length > 1) collisions.push(`${key} <- ${files.sort().join(', ')}`);
    else uploads.push({ key, sourceFile: files[0] });
  }

  const [lo, hi] = scope.range ?? [1, Infinity];
  const missingBase: number[] = [];
  for (let id = lo; id <= hi && findPokemon(id); id++) {
    if (!hasBase.has(id)) missingBase.push(id);
  }

  uploads.sort((a, b) => a.key.localeCompare(b.key));
  return { uploads, invalidCode: invalidCode.sort(), collisions: collisions.sort(), missingBase };
}
