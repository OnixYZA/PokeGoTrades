import { describe, expect, it } from 'vitest';

import { availableMaxForms, coerceMaxForm, maxFormFlags, maxFormOf, type MaxForm } from './max-form';

const FORMS: MaxForm[] = ['standard', 'dynamax', 'gigantamax'];

describe('max form', () => {
  it('round-trips through the flags', () => {
    for (const f of FORMS) expect(maxFormOf(maxFormFlags(f))).toBe(f);
  });

  it('never yields both flags true', () => {
    for (const f of FORMS) {
      const { isDynamax, isGigantamax } = maxFormFlags(f);
      expect(isDynamax && isGigantamax).toBe(false);
    }
  });

  it('offers Gigantamax only to species that can', () => {
    expect(availableMaxForms(false)).toEqual(['standard', 'dynamax']);
    expect(availableMaxForms(true)).toEqual(['standard', 'dynamax', 'gigantamax']);
  });

  it('coerces an ineligible Gigantamax to standard and leaves the rest', () => {
    expect(coerceMaxForm('gigantamax', false)).toBe('standard');
    expect(coerceMaxForm('dynamax', false)).toBe('dynamax');
    expect(coerceMaxForm('gigantamax', true)).toBe('gigantamax');
    expect(coerceMaxForm('standard', false)).toBe('standard');
  });

  it('lets Gigantamax win if both flags are somehow true', () => {
    expect(maxFormOf({ isDynamax: true, isGigantamax: true })).toBe('gigantamax');
  });
});
