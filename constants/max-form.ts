/**
 * A listing's Max Battle form as ONE value, so Dynamax and Gigantamax are mutually exclusive by
 * construction: there is no pair of booleans that could both be true in the UI. The DB check
 * `listings_dynamax_xor_gigantamax` is only the backstop.
 *
 * `canGigantamax` is passed in as a boolean (from `canGigantamax(pokemonId)` in `constants/pokedex`) so this
 * module stays free of the dex. There is no Dynamax eligibility data in the pinned sources (PokeAPI and the
 * PokeMiners game master), so every species is offered `'dynamax'` and it stays unchecked.
 */
export type MaxForm = 'standard' | 'dynamax' | 'gigantamax';

/** The two DB flags for a form. Never both true. */
export function maxFormFlags(form: MaxForm): { isDynamax: boolean; isGigantamax: boolean } {
  return { isDynamax: form === 'dynamax', isGigantamax: form === 'gigantamax' };
}

/** The form for a pair of DB flags. Gigantamax wins if both are somehow true (the DB forbids it). */
export function maxFormOf(flags: { isDynamax: boolean; isGigantamax: boolean }): MaxForm {
  if (flags.isGigantamax) return 'gigantamax';
  return flags.isDynamax ? 'dynamax' : 'standard';
}

/** The forms a seller may pick for a species, in display order. */
export function availableMaxForms(canGigantamax: boolean): readonly MaxForm[] {
  return canGigantamax ? ['standard', 'dynamax', 'gigantamax'] : ['standard', 'dynamax'];
}

/** Gigantamax falls back to standard when the species can't Gigantamax; anything else is unchanged. */
export function coerceMaxForm(form: MaxForm, canGigantamax: boolean): MaxForm {
  return form === 'gigantamax' && !canGigantamax ? 'standard' : form;
}
