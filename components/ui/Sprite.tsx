import { Image } from 'expo-image';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { findPokemon } from '@/constants/pokedex';
import { hueDiscBg, hueDiscGlow } from '@/constants/theme';
import { backgroundObjectKey, storagePublicUrl } from '@/lib/sprite-url';
import { useSpriteSource } from '@/lib/use-sprite-source';

interface SpriteProps {
  pokemonId: number;
  hue: number;
  shiny?: boolean;
  /** Regional/mega/gigantamax/size form code (`lib/sprite-url.ts`, e.g. `'ALOLA'`). */
  form?: string | null;
  /** Event costume code (`lib/sprite-url.ts`, e.g. `'JAN_2020_NOEVOLVE'`). */
  costume?: string | null;
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
export function Sprite({
  pokemonId,
  hue,
  shiny = false,
  form = null,
  costume = null,
  purified = false,
  background = null,
  size = 72,
}: SpriteProps) {
  const { uri, loaded, exhausted, onLoad, onError } = useSpriteSource({ pokemonId, shiny, form, costume });

  const bgKey = background != null ? backgroundObjectKey(background) : null;
  const bgUrl = bgKey ? storagePublicUrl(bgKey) : null;

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: 1 },
        hueDiscBg(hue),
        hueDiscGlow(hue, shiny),
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
        {findPokemon(pokemonId)?.name.charAt(0) ?? '?'}
      </Text>

      {uri && (
        <Image
          source={{ uri }}
          recyclingKey={uri}
          style={{ width: size * 0.72, height: size * 0.72 }}
          contentFit="contain"
          transition={150}
          onLoad={onLoad}
          onError={onError}
          accessibilityIgnoresInvertColors
          alt={`Pokemon ${pokemonId} sprite`}
          accessibilityLabel={`Pokemon ${pokemonId} sprite`}
        />
      )}

      {shiny && (
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
