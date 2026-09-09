import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { hueDiscBg, hueDiscGlow } from '@/constants/theme';
import { spriteUrl } from '@/constants/pokedex';

interface SpriteProps {
  pokemonId: number;
  hue: number;
  shiny?: boolean;
  size?: number;
}

/** Circular hue-tinted sprite tile — the marketplace card / detail-sheet hero creature. */
export function Sprite({ pokemonId, hue, shiny = false, size = 72 }: SpriteProps) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: 1 },
        hueDiscBg(hue),
        hueDiscGlow(hue, shiny),
      ]}
      className="shrink-0 items-center justify-center"
    >
      <Image
        source={{ uri: spriteUrl(pokemonId, shiny) }}
        style={{ width: size * 0.72, height: size * 0.72 }}
        contentFit="contain"
        transition={150}
        accessibilityIgnoresInvertColors
      />
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
    </View>
  );
}
