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
 * decides. `planMirror` upper-cases a code when that alone makes it pass `isSpriteCode` (`May_2023` ->
 * `MAY_2023`, the same costume: checked by eye against its shiny on 2026-09-29), and REFUSES any other bad
 * code. It must never hand a bad code to `spriteObjectKey`, which would fold it away and upload Eevee's
 * May 2023 costume as Eevee's base sprite.
 */
import { findPokemon } from '../constants/pokedex';
import { BASE_FORM_CODES, isSpriteCode, spriteObjectKey } from '../lib/sprite-url';

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
  /** Plain species keys (`pokemon/{id}[.s].png`) that upstream has no plain file for, filled from the
   *  species' default-form file instead (`BASE_FORM_CODES`). They are also in `uploads`. */
  defaultFormFills: string[];
  /** `key <- file` for each in-scope source file whose code was upper-cased to become valid (the real
   *  `pm133.cMay_2023.icon.png`). They are also in `uploads`. */
  caseFixes: string[];
  /** In-scope source files refused because a form/costume code fails `isSpriteCode` even upper-cased. */
  invalidCode: string[];
  /** Two distinct source files tied for one key. With invalid codes refused up front this should never
   *  happen; it stays as a guard, and neither file is uploaded. */
  collisions: string[];
  /** In-range Pokédex ids with no base (non-shiny, no form/costume) icon upstream, not even a default-form
   *  one. They render the initial-letter placeholder in the app. */
  missingBase: number[];
}

function inRange(pokemonId: number, range: [number, number] | null): boolean {
  return range === null || (pokemonId >= range[0] && pokemonId <= range[1]);
}

/** Upstream's code as-is when valid, else ASCII-upper-cased when that alone makes it valid (`May_2023`),
 *  else `null`. Case never changes which game enum a code names, so the fix can't pick the wrong art. */
function canonicalCode(code: string): string | null {
  if (isSpriteCode(code)) return code;
  const upper = code.replace(/[a-z]/g, (c) => c.toUpperCase());
  return isSpriteCode(upper) ? upper : null;
}

/** How a source file came to be offered for a key. When several files could fill one key, the lowest rank
 *  wins, so a correctly named file always beats a case-fixed one, which beats a default-form fill. Files
 *  tied at the winning rank are a collision. */
type SourceTier = 'exact' | 'caseFixed' | 'defaultForm';
const TIER_RANK: Record<SourceTier, number> = { exact: 0, caseFixed: 1, defaultForm: 2 };

/**
 * Pure: source listing + scope -> what to upload. Every key comes from `spriteObjectKey` (R4).
 *
 * A species whose default art exists upstream only under a form token (`pm888.fHERO.s.icon.png`, with no
 * `pm888.s.icon.png`) gets its plain key filled from that default-form file, so the bucket always holds
 * `pokemon/{id}[.s].png` wherever upstream has the art at all. The fill is a BASE key, so it happens even
 * without `--forms`. See `SourceTier` for which file wins a key.
 */
export function planMirror(sourceFiles: readonly string[], scope: MirrorScope): MirrorPlan {
  /** Key -> the best tier offered for it so far, and every file offered at that tier. */
  const offers = new Map<string, { tier: SourceTier; files: string[] }>();
  const invalidCode: string[] = [];

  function offer(key: string, tier: SourceTier, file: string): void {
    const current = offers.get(key);
    if (!current || TIER_RANK[tier] < TIER_RANK[current.tier]) offers.set(key, { tier, files: [file] });
    else if (tier === current.tier) current.files.push(file);
  }

  for (const file of sourceFiles) {
    const parsed = parsePokeMinersIcon(file);
    if (!parsed || parsed.gender2) continue; // not an icon, or the alternate gender (no gender axis in the key)
    const { pokemonId, shiny } = parsed;
    if (!findPokemon(pokemonId) || !inRange(pokemonId, scope.range)) continue;
    const form = parsed.form && canonicalCode(parsed.form);
    const costume = parsed.costume && canonicalCode(parsed.costume);
    if (form && !parsed.costume && form === BASE_FORM_CODES[pokemonId]) {
      offer(spriteObjectKey({ pokemonId, shiny }), 'defaultForm', file);
    }
    if (parsed.form && !scope.forms) continue;
    if (parsed.costume && !scope.costumes) continue;
    if ((parsed.form && !form) || (parsed.costume && !costume)) {
      invalidCode.push(file);
      continue;
    }
    const tier = form === parsed.form && costume === parsed.costume ? 'exact' : 'caseFixed';
    offer(spriteObjectKey({ pokemonId, shiny, form, costume }), tier, file);
  }

  const uploads: PlannedUpload[] = [];
  const defaultFormFills: string[] = [];
  const caseFixes: string[] = [];
  const collisions: string[] = [];
  for (const [key, { tier, files }] of offers) {
    if (files.length > 1) {
      collisions.push(`${key} <- ${files.sort().join(', ')}`);
      continue;
    }
    uploads.push({ key, sourceFile: files[0] });
    if (tier === 'defaultForm') defaultFormFills.push(key);
    if (tier === 'caseFixed') caseFixes.push(`${key} <- ${files[0]}`);
  }

  const [lo, hi] = scope.range ?? [1, Infinity];
  const missingBase: number[] = [];
  for (let id = lo; id <= hi && findPokemon(id); id++) {
    if (!offers.has(spriteObjectKey({ pokemonId: id }))) missingBase.push(id);
  }

  uploads.sort((a, b) => a.key.localeCompare(b.key));
  return {
    uploads,
    defaultFormFills: defaultFormFills.sort(),
    caseFixes: caseFixes.sort(),
    invalidCode: invalidCode.sort(),
    collisions: collisions.sort(),
    missingBase,
  };
}
