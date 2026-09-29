import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { findPokemon } from '@/constants/pokedex';
import { GO_SPRITE_ZOOM, hueChipBg, hueChipGlow } from '@/constants/theme';
import { spriteVariantOf, type SpriteSubject } from '@/lib/sprite-url';
import { useSpriteSource } from '@/lib/use-sprite-source';

interface ChipProps {
  /** Everything this tile needs to resolve a sprite and draw its shiny/lucky badges — the app's
   *  `CreatureRef`/`FormalOffer` (plus a computed `lucky`, see `FormalOfferCard`) already have this
   *  shape, so callers pass the creature straight through instead of destructuring it into flat props. */
  creature: SpriteSubject & { hue: number; lucky?: boolean };
  size?: number;
}

/** The inner clip radius for a `borderRadius: 12, borderWidth: 1` tile — see `Chip`'s no-bleed wrapper
 *  comment below. */
const INNER_RADIUS = 12 - 1;

/** Compact rounded-square sprite tile used in lists, grids, and message threads. */
export function Chip({ creature, size = 48 }: ChipProps) {
  const { uri, loaded, exhausted, onLoad, onError } = useSpriteSource(spriteVariantOf(creature));

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: 12, borderWidth: 1 },
        hueChipBg(creature.hue),
        hueChipGlow(creature.hue),
      ]}
      className="shrink-0 items-center justify-center"
    >
      <Text
        className="font-display absolute text-white"
        style={{ fontSize: size * 0.4, opacity: exhausted ? 1 : loaded ? 0 : 0.35 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {findPokemon(creature.pokemonId)?.name.charAt(0) ?? '?'}
      </Text>
      {/* No-bleed wrapper: ONLY the sprite image is scaled by GO_SPRITE_ZOOM and clipped, inset to the
       *  tile's own borderWidth so its rounded corners land on the inner edge, not the outer one. The
       *  outer tile above stays unclipped (`overflow: 'hidden'` never goes there) so `hueChipGlow`'s
       *  boxShadow isn't cut off, and the shiny/lucky badges are drawn as siblings after this wrapper
       *  so they stay on top of — and outside — the clip. */}
      <View
        pointerEvents="none"
        className="items-center justify-center"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: INNER_RADIUS, overflow: 'hidden' }}
      >
        {uri && (
          <Image
            source={{ uri }}
            recyclingKey={uri}
            style={{ width: size * 0.78, height: size * 0.78, transform: [{ scale: GO_SPRITE_ZOOM }] }}
            contentFit="contain"
            transition={150}
            onLoad={onLoad}
            onError={onError}
            accessibilityIgnoresInvertColors
            alt={`Pokemon ${creature.pokemonId} sprite`}
            accessibilityLabel={`Pokemon ${creature.pokemonId} sprite`}
          />
        )}
      </View>
      {creature.shiny && (
        <Text
          className="absolute"
          style={{ top: 4, right: 5, fontSize: 10, color: '#fff', textShadow: '0 0 4px #ff6bd6' } as any}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ✦
        </Text>
      )}
      {creature.lucky && (
        <Text
          className="absolute font-display"
          style={{ bottom: 4, left: 5, fontSize: 9, color: '#f5c518', letterSpacing: 0.45 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          L
        </Text>
      )}
    </View>
  );
}
