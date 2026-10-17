import { Text, type StyleProp, type TextStyle } from 'react-native';

/** The shiny accent (the pink the glint, the sprite badge's halo and the picker's Shiny toggle all share). */
export const SHINY_PINK = '#ff6bd6';

interface ShinyGlintProps {
  /** Glyph size in px (the `fontSize`). */
  size?: number;
  /** The glyph's fill. Pink by default; pass `#fff` where it sits on a pink halo or a pink-filled toggle,
   *  the muted text color for an "off" toggle, or the gold the Create Listing attribute row is tinted
   *  with. The shape is what says "shiny"; the fill is only styling. */
  color?: string;
  /** A pink text-shadow halo, for a glint drawn straight onto a sprite tile with no halo of its own. */
  glow?: boolean;
  /** Layout only: absolute offsets for a corner badge, margins. */
  style?: StyleProp<TextStyle>;
}

/**
 * THE shiny marker, and the only place the four-point sparkle is drawn: every tile, card, picker toggle
 * and attribute row that means "shiny" renders this, and nothing else in the app may draw that shape (no
 * lucide `Sparkles`/`Sparkle`, no "✦" text). It used to be re-drawn by hand at each call site, which is
 * how the same sparkle ended up also meaning Purified, Custom Offer, "No formal offer", Lucky and "NEW".
 * `lib/shiny-glint-guard.test.ts` fails the build if the shape shows up anywhere but here, so the
 * collision can't come back silently. Give a new meaning its own icon.
 *
 * Decorative by construction: hidden from screen readers, so the shiny state has to reach them through
 * the surrounding label ("Shiny Pikachu", the toggle's `accessibilityLabel`), never through this glyph.
 */
export function ShinyGlint({ size = 12, color = SHINY_PINK, glow = false, style }: ShinyGlintProps) {
  return (
    <Text
      style={[
        { fontSize: size, color },
        // `textShadow` string, like every other web-side glow here; native ignores it, as it did before.
        glow && ({ textShadow: `0 0 ${Math.max(3, Math.round(size * 0.4))}px ${SHINY_PINK}` } as TextStyle),
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      ✦
    </Text>
  );
}
