import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { TYPE_HUE, typesOf, type PokemonTypes, type TypedCreature } from '@/constants/pokedex';
import { hueBadgeStyle, hueBadgeText } from '@/constants/theme';
import { describeTypes } from '@/lib/format';

/** What to badge: a creature (its form-aware types are looked up here, so a call site never passes a
 *  `pokemonId` alone) or a typing the caller already resolved with `typesOf`. */
type TypeBadgeSubject =
  | { creature: TypedCreature; types?: never }
  | { types: PokemonTypes | undefined; creature?: never };

type TypeBadgeProps = TypeBadgeSubject & {
  /** `sm` is the compact density for feed cards and chat bubbles; it matches LuckyBadge's `sm` type size. */
  size?: 'default' | 'sm';
  /** Outer layout only (margins). */
  style?: StyleProp<ViewStyle>;
};

const SIZES = {
  default: { pill: 'px-2.5 py-[3px]', fontSize: 10, letterSpacing: 0.8 },
  sm: { pill: 'px-1.5 py-[2px]', fontSize: 9, letterSpacing: 0.5 },
} as const;

/**
 * One pill per type (two for a dual type, primary first), each tinted by `TYPE_HUE`. Renders nothing for a
 * creature the dex does not know (synthetic and unknown ids exist): a tile must not guess a type.
 *
 * The pills sit in a wrapping row, so a dual type that does not fit its column (large text sizes, a narrow
 * detail header) drops its second pill to the next line instead of overflowing. The label is the type's
 * own name, so the tint is never the only signal (Water and Dragon share a hue). It is display-only and
 * `pointerEvents: 'none'`, so it never swallows a tap meant for the card underlay it sits on.
 */
export function TypeBadge({ creature, types, size = 'default', style }: TypeBadgeProps) {
  const resolved = creature ? typesOf(creature) : types;
  if (!resolved) return null;

  const { pill, fontSize, letterSpacing } = SIZES[size];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={describeTypes(resolved)}
      className="flex-row flex-wrap items-center gap-1"
      style={[{ pointerEvents: 'none' }, style]}
    >
      {resolved.map((type) => (
        <View key={type} className={`rounded-full border ${pill}`} style={hueBadgeStyle(TYPE_HUE[type])}>
          <Text className="font-display-semi uppercase" style={{ fontSize, letterSpacing, color: hueBadgeText(TYPE_HUE[type]) }}>
            {type}
          </Text>
        </View>
      ))}
    </View>
  );
}
