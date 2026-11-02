/**
 * What the Pokémon picker (`components/modals/PokemonPickerModal.tsx`) lets a trainer pick, and what it marks
 * "ADDED", decided as pure functions so the rules can be tested without a screen.
 *
 * The picker's unit of choice is a VARIANT: `(pokemonId, shiny, formCode)`. Three rules decide which variants a
 * row stands for, and all three used to be one expression inside the modal:
 *
 *   - TRADABILITY: a variant that can never change hands is never offered (`isPokemonUntradable`). The rule
 *     itself lives in `constants/untradable.ts`; nothing here decides it, only asks it, once per variant.
 *   - FORMS: the variants of a species are its default form (`formCode: null`) plus every other form in
 *     `formsOf`. A caller that has its own form control (`allowForm: false`) gets the default form only.
 *   - "ADDED": a variant already in the caller's list (`exclude`) can't be added twice.
 *
 * A species ROW can't know which form the trainer means, so it is "added" only when EVERY variant the trainer
 * could still pick is already in the list; the form step then marks the variants one by one
 * (`addedFormsOf`).
 *
 * RELATIVE IMPORTS ONLY, no `react-native`: loaded straight by vitest, the constraint `lib/creature-list.ts`
 * explains. (`constants/pokedex.ts` and `lib/sprite-url.ts` are plain TypeScript for the same reason.)
 */
import { formsOf, isPokemonUntradable } from '../constants/pokedex';
import { spriteVariantKey, spriteVariantOf, type SpriteSubject } from './sprite-url';

/** What the picker hands its caller. */
export interface PickedCreature {
  pokemonId: number;
  /** Always `false` when the picker was opened with `allowShiny: false`. */
  shiny: boolean;
  /** A form code in PokeMiners' spelling (`CreatureRef.formCode`), or `null` for the species' default form.
   *  ALWAYS `null` when the picker was opened with `allowForm: false`, and for a species with no forms. The
   *  default form is `null` even where it has a name of its own (Hero Zacian is `null`, never `'HERO'`), so
   *  one creature is never stored two ways (`defaultFormOf`). */
  formCode: string | null;
}

/** One form a variant can be in: a PokeMiners code, or `null` for the species' default form. */
export type FormChoice = string | null;

/** The two switches a caller flips on the picker; everything here that depends on them takes them together. */
export interface PickerOptions {
  /** Whether the picker offers a Shiny toggle. Off: `PickedCreature.shiny` is `false`. */
  allowShiny: boolean;
  /** Whether the picker asks which form. Off: the caller has its own form control, and `formCode` is `null`. */
  allowForm: boolean;
}

/** Whether tapping this species opens the form step instead of picking: the caller wants a form, and the
 *  species has forms to choose from. A species with forms whose other forms are all untradable (Kyurem) still
 *  opens it: the trainer sees the dimmed White/Black Kyurem and why, instead of listing one as plain Kyurem. */
export function hasFormStep(pokemonId: number, allowForm: boolean): boolean {
  return allowForm && formsOf(pokemonId).length > 0;
}

/**
 * The forms of this species the trainer can pick, default first (`null`), in the game master's order: the default
 * plus `formsOf`, minus every one that is untradable. Only the default when `allowForm` is off.
 *
 * Empty exactly when the species is untradable as a whole (Mew, Deoxys, Zygarde, Eternatus). A species that is
 * tradable but has untradable forms (Kyurem, Necrozma, Zacian, Zamazenta) keeps its other forms and stays pickable.
 */
export function pickableForms(pokemonId: number, allowForm: boolean): FormChoice[] {
  const candidates: FormChoice[] = allowForm ? [null, ...formsOf(pokemonId)] : [null];
  return candidates.filter((formCode) => !isPokemonUntradable(pokemonId, formCode));
}

/** The caller's `exclude` as `spriteVariantKey`s, built once per list so each row's lookup is a set hit.
 *  An entry with a costume code never matches a variant here (a pick never carries one), so a costume Pikachu in
 *  the list does not stop the plain Pikachu from being added. */
export function excludedKeysOf(exclude: readonly SpriteSubject[] | undefined): ReadonlySet<string> {
  return new Set((exclude ?? []).map((subject) => spriteVariantKey(spriteVariantOf(subject))));
}

/** Whether this exact variant is already in the list. Shiny and non-shiny are different variants, and so is
 *  every form. */
export function isFormAdded(excluded: ReadonlySet<string>, pokemonId: number, shiny: boolean, formCode: FormChoice): boolean {
  return excluded.has(spriteVariantKey(spriteVariantOf({ pokemonId, shiny, formCode })));
}

/** How a species row reads. `'untradable'` wins over `'added'`: a row that can never be added says why. */
export type SpeciesRowState = 'open' | 'added' | 'untradable';

/**
 * A species row's state for the current shiny setting.
 *   - `'untradable'`: nothing about it can be picked (`pickableForms` is empty).
 *   - `'added'`: every pickable form is already in the list. A formless species has one variant, so that is just
 *     "it is in the list"; a species with forms is added only when ALL of them are, and a partly added one stays
 *     open so the remaining forms can still be reached. Untradable forms do not count (they can never be added),
 *     so Kyurem is added once plain Kyurem is.
 *   - `'open'`: otherwise.
 */
export function speciesRowState(pokemonId: number, shiny: boolean, excluded: ReadonlySet<string>, allowForm: boolean): SpeciesRowState {
  const forms = pickableForms(pokemonId, allowForm);
  if (forms.length === 0) return 'untradable';
  return forms.every((formCode) => isFormAdded(excluded, pokemonId, shiny, formCode)) ? 'added' : 'open';
}

/** The pickable forms already in the list for this shiny setting: what the form step marks "ADDED". */
export function addedFormsOf(pokemonId: number, shiny: boolean, excluded: ReadonlySet<string>): FormChoice[] {
  return pickableForms(pokemonId, true).filter((formCode) => isFormAdded(excluded, pokemonId, shiny, formCode));
}

/**
 * The form the form step has selected, given the one the trainer last asked for. Their choice stands while it is
 * still pickable and not already added; otherwise it falls back to the first form that is (the default, when it is).
 * `null` when there is nothing left to pick for this shiny setting (every form is in the list), so the step can
 * disable its confirm button instead of selecting a form that can not be added.
 *
 * Derived on every render rather than held as state, because what is pickable changes under a selection that
 * was valid a moment ago: the trainer flips Shiny, or the list behind `exclude` refreshes.
 * Pass `null` as `requested` for "the default", which is where the step starts.
 */
export function resolveFormChoice(
  requested: FormChoice,
  pokemonId: number,
  shiny: boolean,
  excluded: ReadonlySet<string>,
): { formCode: FormChoice } | null {
  const open = pickableForms(pokemonId, true).filter((formCode) => !isFormAdded(excluded, pokemonId, shiny, formCode));
  if (open.includes(requested)) return { formCode: requested };
  return open.length > 0 ? { formCode: open[0] } : null;
}

/**
 * The creature to hand the caller, or `null` when this combination must not be emitted.
 *
 * This is the ONLY place a `PickedCreature` is made, so its guarantees hold for every path (the fast path on a
 * row and the form step's confirm): the variant is tradable, `formCode` is `null` when the caller has its own form
 * control (`allowForm` off), and `shiny` is `false` when the caller has no shiny toggle. A code that is not one of
 * the species' forms (an unknown code, the name of the default form) yields `null` rather than a made-up creature.
 */
export function buildPick(pokemonId: number, shiny: boolean, formCode: FormChoice, options: PickerOptions): PickedCreature | null {
  const form = options.allowForm ? formCode : null;
  if (!pickableForms(pokemonId, options.allowForm).includes(form)) return null;
  return { pokemonId, shiny: options.allowShiny && shiny, formCode: form };
}

/** What tapping a species row does. */
export type TapResult =
  /** Nothing about it can be picked: explain why (the untradable notice). */
  | { kind: 'refuse' }
  /** It has forms and the caller wants one: open the form step. */
  | { kind: 'choose-form' }
  /** Nothing to ask: hand this to the caller now. */
  | { kind: 'pick'; pick: PickedCreature };

/** The decision behind a row tap: refuse, ask which form, or pick the species straight away. */
export function resolveTap(pokemonId: number, shiny: boolean, options: PickerOptions): TapResult {
  if (pickableForms(pokemonId, options.allowForm).length === 0) return { kind: 'refuse' };
  if (hasFormStep(pokemonId, options.allowForm)) return { kind: 'choose-form' };
  const pick = buildPick(pokemonId, shiny, null, options);
  return pick ? { kind: 'pick', pick } : { kind: 'refuse' };
}
