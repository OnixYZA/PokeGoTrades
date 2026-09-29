/**
 * Unit tests for `demandTier` — the TS-side tiering of `pokemon_market_demand`'s raw counts
 * (migration …000300). The view intentionally returns counts only; these thresholds are the single
 * place that turns them into 'hot' / 'high' / 'balanced' / 'surplus' / 'new'.
 */
import { describe, expect, it } from 'vitest';

import {
  BALANCED_RATIO_THRESHOLD,
  demandTier,
  HIGH_RATIO_THRESHOLD,
  HOT_RATIO_THRESHOLD,
  marketLabel,
  type MarketSignal,
} from './market';

const signal = (partial: Partial<MarketSignal> = {}): MarketSignal => ({ wanted: 0, offered: 0, ratio: 0, ...partial });

describe('demandTier', () => {
  it('is "new" for no signal at all', () => {
    expect(demandTier(undefined)).toBe('new');
  });

  it('is "new" whenever the combined sample is below the threshold, regardless of ratio', () => {
    expect(demandTier(signal({ wanted: 2, offered: 0, ratio: 9 }))).toBe('new');
    expect(demandTier(signal({ wanted: 1, offered: 1, ratio: 1 }))).toBe('new');
  });

  it('is "hot" when nobody offers one but at least 3 want it', () => {
    // Mirrors the view's `wanted / greatest(offered, 1)`: offered = 0 still yields a finite ratio.
    expect(demandTier(signal({ wanted: 3, offered: 0, ratio: 3 }))).toBe('hot');
  });

  it('resolves the boundary at each threshold to the higher tier (>=, not >)', () => {
    expect(demandTier(signal({ wanted: 3, offered: 1, ratio: HOT_RATIO_THRESHOLD }))).toBe('hot');
    expect(demandTier(signal({ wanted: 3, offered: 1, ratio: HOT_RATIO_THRESHOLD - 0.01 }))).toBe('high');

    expect(demandTier(signal({ wanted: 3, offered: 2, ratio: HIGH_RATIO_THRESHOLD }))).toBe('high');
    expect(demandTier(signal({ wanted: 3, offered: 2, ratio: HIGH_RATIO_THRESHOLD - 0.01 }))).toBe('balanced');

    expect(demandTier(signal({ wanted: 2, offered: 3, ratio: BALANCED_RATIO_THRESHOLD }))).toBe('balanced');
    expect(demandTier(signal({ wanted: 2, offered: 3, ratio: BALANCED_RATIO_THRESHOLD - 0.01 }))).toBe('surplus');
  });

  it('is "surplus" well below the balanced threshold', () => {
    expect(demandTier(signal({ wanted: 1, offered: 10, ratio: 0.1 }))).toBe('surplus');
  });
});

describe('marketLabel', () => {
  it('gives every tier a distinct, non-empty label', () => {
    const tiers = ['hot', 'high', 'balanced', 'surplus', 'new'] as const;
    const labels = tiers.map(marketLabel);
    expect(new Set(labels).size).toBe(tiers.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });
});
