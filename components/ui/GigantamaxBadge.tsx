import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** The Gigantamax marker's icon: a bold four-armed burst (an X whose arms flare outward) over a
 *  puffy cloud-like crown, evoking raw "power" billowing up. It is an ORIGINAL drawing made for this app;
 *  it is not traced from, and does not reproduce, Nintendo's or The Pokémon Company's official Gigantamax
 *  artwork. It deliberately avoids the sparkle shape, which is the shiny marker (`ShinyGlint`).
 *  Decorative: the "G-MAX" text beside it, or the badge's own label, is what a screen reader gets. */
export function GigantamaxSymbol({ size, color }: { size: number; color: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no">
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Flared X: each arm is a thick stroke that widens toward the corner. */}
        <Path
          d="M4 21 L10.5 13.5 M20 21 L13.5 13.5 M4 9 L9.5 12 M20 9 L14.5 12"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Cloud crown: three overlapping bumps rising from the centre. */}
        <Path
          d="M7.5 9.5 C5.5 9.5 5.5 6.5 8 6.5 C8.4 4 11.6 3 13 5 C15 3.8 17.6 5.4 16.8 7.6 C18.8 8 18.6 10 16.5 10 L8 10"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** "Can Gigantamax" listing marker. A flat crimson tint pill, the same pill shape as `LuckyBadge`, but
 *  static: lucky's gold shimmer is its own signature, and the crimson is its own colour so the two never
 *  read as one marker. */
export function GigantamaxBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const fontSize = size === 'sm' ? 9 : 10;
  return (
    <View
      accessible
      accessibilityLabel="Gigantamax"
      className="flex-row items-center gap-1 rounded-full border px-2 py-[3px]"
      style={{ backgroundColor: 'rgba(255,42,95,0.14)', borderColor: 'rgba(255,42,95,0.38)' }}
    >
      <GigantamaxSymbol size={fontSize + 3} color="#ff2a5f" />
      <Text
        className="font-display uppercase"
        style={{ fontSize, letterSpacing: fontSize * 0.08, color: '#ff2a5f' }}
        importantForAccessibility="no-hide-descendants"
      >
        G-MAX
      </Text>
    </View>
  );
}
