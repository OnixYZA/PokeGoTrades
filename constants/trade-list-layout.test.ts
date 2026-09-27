/**
 * Unit tests for `computeTradeListLayout` and `chunkIntoRows` — the pure sizing math behind the
 * "Share trade list" PNG export (Task 2B). These pin down the cap/overflow/row-chunking behaviour and
 * the additive `canvasHeight` formula so `components/share/TradeListCard.tsx` and
 * `lib/share-image.ts` / `.web.ts` can trust it never silently drifts.
 */
import { describe, expect, it } from 'vitest';

import type { CreatureRef } from '@/data/types';

import {
  CARD_CONTENT_WIDTH,
  chunkIntoRows,
  computeSectionHeight,
  computeTradeListLayout,
  EMPTY_SECTION_HEIGHT,
  FOOTER_HEIGHT,
  GRID_COLUMNS,
  GRID_GAP,
  GRID_TILE_SIZE,
  HEADER_HEIGHT,
  MAX_VISIBLE_PER_LIST,
  OVERFLOW_ROW_HEIGHT,
  SECTION_GAP,
  SECTION_LABEL_HEIGHT,
  SHARE_IMAGE_OUTPUT_WIDTH,
  SHARE_IMAGE_SCALE,
} from './trade-list-layout';

const creature = (n: number, overrides: Partial<CreatureRef> = {}): CreatureRef => ({
  name: `Mon ${n}`,
  pokemonId: n,
  hue: 100,
  ...overrides,
});

const listOf = (count: number): CreatureRef[] => Array.from({ length: count }, (_, i) => creature(i + 1));

describe('GRID_TILE_SIZE', () => {
  it('exactly fills the card width across 4 columns with the grid gap between them', () => {
    expect(GRID_TILE_SIZE * GRID_COLUMNS + GRID_GAP * (GRID_COLUMNS - 1)).toBe(CARD_CONTENT_WIDTH);
  });
});

describe('SHARE_IMAGE_SCALE', () => {
  it('derives from the output width so the two can never disagree', () => {
    expect(SHARE_IMAGE_OUTPUT_WIDTH).toBe(360 * SHARE_IMAGE_SCALE);
  });
});

describe('chunkIntoRows', () => {
  it('chunks evenly when the count is a multiple of the column count', () => {
    expect(chunkIntoRows(listOf(8)).map((r) => r.length)).toEqual([4, 4]);
  });

  it('leaves a shorter last row otherwise', () => {
    expect(chunkIntoRows(listOf(5)).map((r) => r.length)).toEqual([4, 1]);
  });

  it('returns an empty array for an empty input, not a single empty row', () => {
    expect(chunkIntoRows([])).toEqual([]);
  });

  it('keeps every item in one row when there is only one column', () => {
    expect(chunkIntoRows(listOf(3), 1).map((r) => r.length)).toEqual([1, 1, 1]);
  });
});

describe('computeTradeListLayout — caps and overflow', () => {
  it('shows every entry with zero overflow when a list is under the cap', () => {
    const { arsenal } = computeTradeListLayout(listOf(10), []);
    expect(arsenal.visible).toHaveLength(10);
    expect(arsenal.overflowCount).toBe(0);
    expect(arsenal.rows.map((r) => r.length)).toEqual([4, 4, 2]);
  });

  it('shows exactly the cap with zero overflow right at the boundary', () => {
    const { arsenal } = computeTradeListLayout(listOf(MAX_VISIBLE_PER_LIST), []);
    expect(arsenal.visible).toHaveLength(MAX_VISIBLE_PER_LIST);
    expect(arsenal.overflowCount).toBe(0);
  });

  it('caps at 24 and reports the rest as overflow for a full 50-slot list', () => {
    const { wishlist } = computeTradeListLayout([], listOf(50));
    expect(wishlist.visible).toHaveLength(MAX_VISIBLE_PER_LIST);
    expect(wishlist.overflowCount).toBe(50 - MAX_VISIBLE_PER_LIST);
    // visible items are the first 24, in order — not an arbitrary subset
    expect(wishlist.visible[0].pokemonId).toBe(1);
    expect(wishlist.visible[MAX_VISIBLE_PER_LIST - 1].pokemonId).toBe(MAX_VISIBLE_PER_LIST);
  });

  it('handles both lists empty', () => {
    const layout = computeTradeListLayout([], []);
    expect(layout.arsenal.visible).toHaveLength(0);
    expect(layout.arsenal.overflowCount).toBe(0);
    expect(layout.arsenal.rows).toEqual([]);
    expect(layout.wishlist.visible).toHaveLength(0);
  });
});

describe('computeTradeListLayout — canvasHeight', () => {
  it('is exactly header + two empty sections + the gap + footer when both lists are empty', () => {
    const layout = computeTradeListLayout([], []);
    const emptySection = SECTION_LABEL_HEIGHT + EMPTY_SECTION_HEIGHT;
    expect(layout.canvasHeight).toBe(HEADER_HEIGHT + emptySection + SECTION_GAP + emptySection + FOOTER_HEIGHT);
  });

  it('grows by exactly one grid-row-and-gap when a section gains a 5th item (a 2nd row)', () => {
    const four = computeTradeListLayout(listOf(4), []);
    const five = computeTradeListLayout(listOf(5), []);
    expect(five.canvasHeight - four.canvasHeight).toBe(GRID_TILE_SIZE + GRID_GAP);
  });

  it('adds the overflow row height exactly once when a list crosses the cap', () => {
    const atCap = computeTradeListLayout(listOf(MAX_VISIBLE_PER_LIST), []);
    const overCap = computeTradeListLayout(listOf(MAX_VISIBLE_PER_LIST + 1), []);
    // The extra (25th) item is hidden, not rendered as a new row — only the overflow row's height is added.
    expect(overCap.canvasHeight - atCap.canvasHeight).toBe(OVERFLOW_ROW_HEIGHT);
  });

  it('is deterministic for the same input', () => {
    const a = computeTradeListLayout(listOf(6), listOf(3));
    const b = computeTradeListLayout(listOf(6), listOf(3));
    expect(a.canvasHeight).toBe(b.canvasHeight);
  });

  it('always equals the sum of computeSectionHeight for both sections plus the fixed blocks', () => {
    const layout = computeTradeListLayout(listOf(30), listOf(2));
    const expected =
      HEADER_HEIGHT + computeSectionHeight(layout.arsenal) + SECTION_GAP + computeSectionHeight(layout.wishlist) + FOOTER_HEIGHT;
    expect(layout.canvasHeight).toBe(expected);
  });
});
