import { Image } from 'expo-image';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { findPokemon } from '@/constants/pokedex';
import { GO_SPRITE_ZOOM, hueDiscBg, hueDiscGlow } from '@/constants/theme';
import { backgroundObjectKey, spriteVariantOf, storagePublicUrl, type SpriteSubject } from '@/lib/sprite-url';
import { useSpriteSource } from '@/lib/use-sprite-source';

interface SpriteProps {
  /** Everything this tile needs to resolve a sprite — the app's `CreatureRef`/`FormalOffer` (plus a
   *  computed `lucky` where a caller needs it) already have this shape. `Sprite` itself never draws a
   *  lucky marker, so `lucky` isn't part of this prop the way it is for `Chip`. */
  creature: SpriteSubject & { hue: number };
  /** Cleansed-from-Shadow overlay badge. Never a sprite key (R3): Purified never changes which image
   *  loads, only whether this badge is drawn on top of it. */
  purified?: boolean;
  /** Background item id (`backgroundObjectKey`), rendered as an underlay behind the sprite. */
  background?: string | number | null;
  size?: number;
}

/** Circular hue-tinted sprite tile — the marketplace card / detail-sheet hero creature. Layers, bottom
 *  to top: hue disc -> background underlay -> initial-letter placeholder -> sprite -> shiny/purified
 *  badges. */
export function Sprite({ creature, purified = false, background = null, size = 72 }: SpriteProps) {
  const { uri, loaded, exhausted, onLoad, onError } = useSpriteSource(spriteVariantOf(creature));

  const bgKey = background != null ? backgroundObjectKey(background) : null;
  const bgUrl = bgKey ? storagePublicUrl(bgKey) : null;
  // The inner clip radius for this tile's `borderWidth: 1` circle — see the no-bleed wrapper below.
  const innerRadius = size / 2 - 1;

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: 1 },
        hueDiscBg(creature.hue),
        hueDiscGlow(creature.hue),
      ]}
      className="shrink-0 items-center justify-center"
    >
      {/* Keyed by `url` so a change of background id starts with a clean `failed` state instead of
          carrying over the previous background's load failure. */}
      <BackgroundUnderlay key={bgUrl} url={bgUrl} size={size} />

      <Text
        className="font-display absolute text-white"
        style={{ fontSize: size * 0.4, opacity: exhausted ? 1 : loaded ? 0 : 0.35 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {findPokemon(creature.pokemonId)?.name.charAt(0) ?? '?'}
      </Text>

      {/* No-bleed wrapper: ONLY the sprite image is scaled by GO_SPRITE_ZOOM and clipped, inset to the
       *  disc's own borderWidth so its rounded corners land on the inner edge, not the outer one. The
       *  outer disc above stays unclipped (`overflow: 'hidden'` never goes there) — the shiny/purified
       *  badges below are deliberately drawn at `-4` offsets OUTSIDE the circle (see
       *  `BackgroundUnderlay`'s comment), and clipping the outer disc would cut both of them off. They
       *  render as siblings after this wrapper, so they stay on top of it either way. */}
      <View
        pointerEvents="none"
        className="items-center justify-center"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: innerRadius, overflow: 'hidden' }}
      >
        {uri && (
          <Image
            source={{ uri }}
            recyclingKey={uri}
            style={{ width: size * 0.72, height: size * 0.72, transform: [{ scale: GO_SPRITE_ZOOM }] }}
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
        <View
          className="absolute items-center justify-center"
          style={{
            top: -4,
            right: -4,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundImage: 'radial-gradient(circle, #fff 0%, #ff6bd6 50%, transparent 70%)',
          }}
        >
          <Text style={{ fontSize: 14, color: '#fff' }} accessibilityElementsHidden importantForAccessibility="no">
            ✦
          </Text>
        </View>
      )}

      {purified && (
        <View
          className="absolute items-center justify-center rounded-full"
          style={{ bottom: -4, left: -4, width: 20, height: 20, backgroundColor: 'rgba(125,255,179,0.18)' }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Sparkles size={13} color="#7dffb3" />
        </View>
      )}
    </View>
  );
}

/** Its own component only so the `onError` state lives beside the thing it guards — a background that
 *  fails to load just disappears (the hue disc underneath is already a fine backdrop on its own),
 *  never a broken-image glyph. `borderRadius` on the `Image` itself clips it to the disc's circle
 *  without needing `overflow: 'hidden'` on the outer tile (which would also clip the shiny/purified
 *  badges, both deliberately drawn slightly outside the circle). */
function BackgroundUnderlay({ url, size }: { url: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <Image
      source={{ uri: url }}
      style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
      alt=""
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
