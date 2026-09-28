/**
 * Pure layout math for the "Share trade list" PNG export (Task 2B). `components/share/TradeListCard.tsx`
 * renders at a fixed `CARD_WIDTH` regardless of device, and `lib/share-image.ts` / `.web.ts` need the
 * card's total rendered height *before* they call `captureRef` (captureRef has to be told an output
 * size up front — see those files' own comments on why width alone isn't enough). Both are single-source
 * from the constants below rather than each hand-rolling the same pixel math, so the capture can never
 * drift from what the card actually renders.
 *
 * Deliberately no React Native / Expo import: this is plain data + arithmetic, safe to import from
 * anywhere (including this file's own Vitest unit tests, which run outside any RN environment — see
 * vitest.config.ts).
 */
import type { CreatureRef } from '@/data/types';

// ——— fixed card geometry (pt, at 1x — see SHARE_IMAGE_SCALE below for the exported pixel size) ———

/** TradeListCard always renders at this width, whatever the device — the PNG is captured at
 *  `SHARE_IMAGE_OUTPUT_WIDTH` px regardless of `PixelRatio.get()`. */
export const CARD_WIDTH = 360;
export const CARD_PADDING = 20;
export const CARD_CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2;

export const GRID_COLUMNS = 4;
export const GRID_GAP = 8;
/** (320 - 3*8) / 4 = 74 — an even number, so a Chip-sized sprite centers in it without a half-pixel edge. */
export const GRID_TILE_SIZE = (CARD_CONTENT_WIDTH - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

/** Beyond this many entries a list only shows the cap plus an "+N more" row — a trainer with 50
 *  Arsenal slots (lib/api/profile.ts's `MAX_TRAINER_CREATURE_SLOTS`) must still produce a shareable,
 *  bounded-height card. */
export const MAX_VISIBLE_PER_LIST = 24;

// ——— block heights (pt) — TradeListCard gives each of these blocks exactly this much height, so
// summing them (see `computeTradeListLayout` below) always equals the card's true rendered height ———

/** Vertical rhythm shared by every gap inside the header (wordmark -> handle -> team pill) — one
 *  number reused three times, replacing what used to be two unrelated ad-hoc margins (14, then 8),
 *  so the header reads as one consistent scale instead of two arbitrary ones. */
export const HEADER_ROW_GAP = 12;
/** Icon + wordmark row — the fixed 22pt icon square is the tallest thing in it. */
export const HEADER_WORDMARK_ROW_HEIGHT = 22;
/** Handle (+ optional LVL badge) row, sized for the fontSize-20 display handle — the tallest thing in
 *  it. Fixed rather than left to the text's natural line height so `computeHeaderHeight` below is exact
 *  regardless of platform font metrics, the same reasoning `CardSection`'s fixed-height rows already
 *  follow for the grid/label rows. */
export const HEADER_HANDLE_ROW_HEIGHT = 24;
/** Team pill row — rendered only when the trainer has picked a team (`team` is non-null; a live
 *  profile may not have one yet). */
export const HEADER_TEAM_ROW_HEIGHT = 22;

/**
 * The header block's rendered height: `CARD_PADDING` on top (the same inset the content wrapper below
 * uses, so the two rhythms match), the wordmark and handle rows with `HEADER_ROW_GAP` between them, and
 * — only when `hasTeam` — one more `HEADER_ROW_GAP` plus the team pill row, leaving `CARD_PADDING` of
 * clear space below whichever row is last. Without the `hasTeam` branch, a team-less profile (`team`
 * can be null) would render fewer rows inside a height still sized for the pill, leaving an arbitrary
 * gap at the bottom instead of the same breathing room every other block gets — the same reason
 * `computeSectionHeight` below takes the actual section instead of a flat constant.
 */
export function computeHeaderHeight(hasTeam: boolean): number {
  const withoutTeam = CARD_PADDING + HEADER_WORDMARK_ROW_HEIGHT + HEADER_ROW_GAP + HEADER_HANDLE_ROW_HEIGHT + CARD_PADDING;
  return hasTeam ? withoutTeam + HEADER_ROW_GAP + HEADER_TEAM_ROW_HEIGHT : withoutTeam;
}

/** `computeHeaderHeight(true)` — the common (has-a-team) case, kept as a flat constant for call sites
 *  and tests that don't need to vary it. */
export const HEADER_HEIGHT = computeHeaderHeight(true);
/** "HAVE" / "WANT" label + divider row. */
export const SECTION_LABEL_HEIGHT = 26;
/** Vertical gap between the HAVE and WANT sections. */
export const SECTION_GAP = 16;
/** The "+N more" row, shown only when a list has overflow. */
export const OVERFLOW_ROW_HEIGHT = 24;
/** "Nothing here yet" row, shown only when a list has zero entries. */
export const EMPTY_SECTION_HEIGHT = 40;
/** Watermark row + the card's bottom padding. */
export const FOOTER_HEIGHT = 44;

/** captureRef's target output width in px, fixed regardless of device (see lib/share-image.ts). */
export const SHARE_IMAGE_OUTPUT_WIDTH = 1080;
/** How much bigger the captured PNG is than the pt-sized card — also the factor `SHARE_IMAGE_OUTPUT_WIDTH`
 *  is derived from, so the two can never disagree about the card's aspect ratio. */
export const SHARE_IMAGE_SCALE = SHARE_IMAGE_OUTPUT_WIDTH / CARD_WIDTH;

/** Splits `items` into `GRID_COLUMNS`-wide rows, last row possibly shorter. Exported so
 *  TradeListCard renders the exact same rows this module used to size the card — never a
 *  CSS `flexWrap` guess that could reflow differently from the height that was computed for it. */
export function chunkIntoRows<T>(items: readonly T[], columns = GRID_COLUMNS): T[][] {
  if (columns <= 0) return items.length === 0 ? [] : [items.slice()];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

export interface TradeListSection {
  /** Capped at `MAX_VISIBLE_PER_LIST`, in the same order they were given. */
  visible: CreatureRef[];
  /** How many entries beyond the cap were left out; 0 when nothing was cut. */
  overflowCount: number;
  /** `visible`, chunked into `GRID_COLUMNS`-wide rows — render these directly, don't re-derive them. */
  rows: CreatureRef[][];
}

export interface TradeListLayout {
  arsenal: TradeListSection;
  wishlist: TradeListSection;
  /** The card's total rendered height in pt at `CARD_WIDTH` — every block height above, summed. */
  canvasHeight: number;
}

function buildSection(items: readonly CreatureRef[]): TradeListSection {
  const visible = items.slice(0, MAX_VISIBLE_PER_LIST);
  const overflowCount = Math.max(0, items.length - MAX_VISIBLE_PER_LIST);
  return { visible, overflowCount, rows: chunkIntoRows(visible) };
}

/** The height TradeListCard gives one HAVE/WANT section: label row, plus either the empty-state row
 *  or the grid's rows and (if capped) the overflow row. Exported so `TradeListCard` can give its own
 *  section Views this exact height directly, instead of re-deriving the same formula — the one way
 *  `canvasHeight` below (the sum of every block) is guaranteed to equal what the card actually renders. */
export function computeSectionHeight(section: TradeListSection): number {
  if (section.visible.length === 0) return SECTION_LABEL_HEIGHT + EMPTY_SECTION_HEIGHT;
  const gridHeight = section.rows.length * GRID_TILE_SIZE + Math.max(0, section.rows.length - 1) * GRID_GAP;
  const overflowHeight = section.overflowCount > 0 ? OVERFLOW_ROW_HEIGHT : 0;
  return SECTION_LABEL_HEIGHT + gridHeight + overflowHeight;
}

/**
 * Computes what `TradeListCard` needs to render (capped, chunked lists) and what `lib/share-image.ts`
 * / `.web.ts` need to size the capture (`canvasHeight`), from the trainer's own Arsenal + Wishlist.
 * Pure and platform-free: safe to call from the modal (to size the preview) and from the capture
 * helpers (to size captureRef's output) without either importing the other.
 *
 * `hasTeam` (the caller's `team !== null`) feeds `computeHeaderHeight` — required, not defaulted, so a
 * caller can't forget it and silently size the capture for a header the card doesn't actually render.
 */
export function computeTradeListLayout(
  arsenal: readonly CreatureRef[],
  wishlist: readonly CreatureRef[],
  hasTeam: boolean,
): TradeListLayout {
  const arsenalSection = buildSection(arsenal);
  const wishlistSection = buildSection(wishlist);
  const canvasHeight =
    computeHeaderHeight(hasTeam) +
    // Breathing room above "HAVE" and below the last WANT row — the content wrapper's own top/bottom
    // insets (TradeListCard.tsx), reusing CARD_PADDING so they match its horizontal rhythm instead of
    // sitting flush against the header/footer edges.
    CARD_PADDING +
    computeSectionHeight(arsenalSection) +
    SECTION_GAP +
    computeSectionHeight(wishlistSection) +
    CARD_PADDING +
    FOOTER_HEIGHT;
  return { arsenal: arsenalSection, wishlist: wishlistSection, canvasHeight };
}
