import { describe, expect, it } from 'vitest';

import { MAX_BADGE_PALETTES, MAX_BADGE_SIZES } from './max-badges';

// Lucky's gold (`COLORS.accentGold` in constants/theme.ts). theme.ts is not imported: it pulls in
// react-native types and an `@/` alias, which vitest does not resolve, so the value is hard-coded here.
const LUCKY_GOLD = '#f5c518';
// The modal's pink (`MODAL_COLORS.pink`), used for Special Background / Costume.
const MODAL_PINK = '#ec4899';

describe('max badge spec', () => {
  it('shares one size table between both kinds (no per-kind size field)', () => {
    for (const palette of Object.values(MAX_BADGE_PALETTES)) {
      expect(Object.keys(palette).sort()).toEqual(['accessibilityLabel', 'background', 'border', 'color', 'label']);
    }
  });

  it('sm is smaller than md for both font and icon', () => {
    expect(MAX_BADGE_SIZES.sm.fontSize).toBeLessThan(MAX_BADGE_SIZES.md.fontSize);
    expect(MAX_BADGE_SIZES.sm.iconSize).toBeLessThan(MAX_BADGE_SIZES.md.iconSize);
  });

  it('labels and accessibility labels', () => {
    expect(MAX_BADGE_PALETTES.gigantamax.label).toBe('G-MAX');
    expect(MAX_BADGE_PALETTES.dynamax.label).toBe('D-MAX');
    expect(MAX_BADGE_PALETTES.gigantamax.accessibilityLabel).toBe('Gigantamax');
    expect(MAX_BADGE_PALETTES.dynamax.accessibilityLabel).toBe('Dynamax');
  });

  it('colours are distinct from each other, Lucky gold and the modal pink', () => {
    const { gigantamax, dynamax } = MAX_BADGE_PALETTES;
    expect(gigantamax.color).not.toBe(dynamax.color);
    for (const c of [gigantamax.color, dynamax.color]) {
      expect(c).not.toBe(MODAL_PINK);
      expect(c).not.toBe(LUCKY_GOLD);
    }
  });

  it('Gigantamax keeps its original literal values (the refactor is visually identical)', () => {
    expect(MAX_BADGE_PALETTES.gigantamax).toMatchObject({
      color: '#ff2a5f',
      background: 'rgba(255,42,95,0.14)',
      border: 'rgba(255,42,95,0.38)',
    });
    expect(MAX_BADGE_SIZES.sm).toEqual({ fontSize: 9, iconSize: 12 });
    expect(MAX_BADGE_SIZES.md).toEqual({ fontSize: 10, iconSize: 13 });
  });
});
