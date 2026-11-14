import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { MaxBadgeSize } from '@/constants/max-badges';
import { MaxBadge } from '@/components/ui/MaxBadge';

/** The Dynamax marker's icon: an energy-aura swirl, three identical comet-like arcs spiralling clockwise out
 *  of a small bright core. It is an ORIGINAL drawing made for this app; it is not traced from, and does not
 *  reproduce, Nintendo's or The Pokémon Company's official Dynamax artwork. It deliberately avoids the
 *  sparkle shape, which is the shiny marker (`ShinyGlint`).
 *  Decorative: the "D-MAX" text beside it, or the badge's own label, is what a screen reader gets. */
export function DynamaxSymbol({ size, color }: { size: number; color: string }) {
  const arc = 'M12 9.2 C14.8 9.2 16.6 7.4 16.4 4.6';
  return (
    <View accessibilityElementsHidden importantForAccessibility="no">
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Three arcs rotated 120 degrees apart so together they read as a spiral. */}
        {[0, 120, 240].map((angle) => (
          <G key={angle} transform={`rotate(${angle} 12 12)`}>
            <Path d={arc} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          </G>
        ))}
        <Circle cx={12} cy={12} r={2} fill={color} />
      </Svg>
    </View>
  );
}

/** "Can Dynamax" listing marker: the shared `MaxBadge` pill (see `constants/max-badges.ts`) in fuchsia. */
export function DynamaxBadge({ size = 'md' }: { size?: MaxBadgeSize }) {
  return <MaxBadge kind="dynamax" size={size} glyph={DynamaxSymbol} />;
}
