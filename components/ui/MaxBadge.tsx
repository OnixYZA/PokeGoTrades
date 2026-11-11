import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { MAX_BADGE_PALETTES, MAX_BADGE_SIZES, type MaxBadgeKind, type MaxBadgeSize } from '@/constants/max-badges';

/** The one shared pill behind `GigantamaxBadge` and `DynamaxBadge`. Size, shape and colours all come from
 *  `constants/max-badges.ts`, so the two markers cannot drift apart; only the glyph differs per kind.
 *  A flat tint pill, the same shape as `LuckyBadge` but static: lucky's gold shimmer is its own signature. */
export function MaxBadge({
  kind,
  size = 'md',
  glyph,
}: {
  kind: MaxBadgeKind;
  size?: MaxBadgeSize;
  glyph: (props: { size: number; color: string }) => ReactNode;
}) {
  const palette = MAX_BADGE_PALETTES[kind];
  const { fontSize, iconSize } = MAX_BADGE_SIZES[size];
  return (
    <View
      accessible
      accessibilityLabel={palette.accessibilityLabel}
      className="flex-row items-center gap-1 rounded-full border px-2 py-[3px]"
      style={{ backgroundColor: palette.background, borderColor: palette.border }}
    >
      {glyph({ size: iconSize, color: palette.color })}
      <Text
        className="font-display uppercase"
        style={{ fontSize, letterSpacing: fontSize * 0.08, color: palette.color }}
        importantForAccessibility="no-hide-descendants"
      >
        {palette.label}
      </Text>
    </View>
  );
}
