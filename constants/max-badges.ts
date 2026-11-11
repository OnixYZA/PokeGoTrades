/**
 * The ONE visual spec for the two Max Battle listing pills (Gigantamax and Dynamax). Both are rendered by
 * the shared `MaxBadge` component from this table, so they cannot drift apart in size or shape: there is no
 * per-kind size field, and a new kind has to supply a full palette to type-check.
 *
 * The colours are chosen to stay distinct from each other, from Lucky's gold shimmer, and from the modal's
 * pink (`#ec4899`, used for Special Background / Costume). Pure and dependency-free so vitest can pin it.
 */
export type MaxBadgeKind = 'gigantamax' | 'dynamax';
export type MaxBadgeSize = 'sm' | 'md';

/** Font and icon sizes per badge size, shared by every kind. The icon is the font size + 3. */
export const MAX_BADGE_SIZES: Record<MaxBadgeSize, { fontSize: number; iconSize: number }> = {
  sm: { fontSize: 9, iconSize: 12 },
  md: { fontSize: 10, iconSize: 13 },
};

export const MAX_BADGE_PALETTES: Record<
  MaxBadgeKind,
  { color: string; background: string; border: string; label: string; accessibilityLabel: string }
> = {
  gigantamax: {
    color: '#ff2a5f',
    background: 'rgba(255,42,95,0.14)',
    border: 'rgba(255,42,95,0.38)',
    label: 'G-MAX',
    accessibilityLabel: 'Gigantamax',
  },
  dynamax: {
    color: '#d946ef',
    background: 'rgba(217,70,239,0.14)',
    border: 'rgba(217,70,239,0.38)',
    label: 'D-MAX',
    accessibilityLabel: 'Dynamax',
  },
};
