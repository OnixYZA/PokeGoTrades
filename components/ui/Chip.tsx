import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { hueChipBg, hueChipGlow } from '@/constants/theme';
import { spriteUrl } from '@/constants/pokedex';

interface ChipProps {
  pokemonId: number;
  hue: number;
  shiny?: boolean;
  lucky?: boolean;
  size?: number;
}

/** Compact rounded-square sprite tile used in lists, grids, and message threads. */
export function Chip({ pokemonId, hue, shiny = false, lucky = false, size = 48 }: ChipProps) {
  return (
    <View
      style={[{ width: size, height: size, borderRadius: 12, borderWidth: 1 }, hueChipBg(hue), hueChipGlow(hue, shiny)]}
      className="shrink-0 items-center justify-center"
    >
      <Image
        source={{ uri: spriteUrl(pokemonId, shiny) }}
        style={{ width: size * 0.78, height: size * 0.78 }}
        contentFit="contain"
        transition={150}
        accessibilityIgnoresInvertColors
        alt={`Pokemon ${pokemonId} sprite`}
      />
      {shiny && (
        <Text
          className="absolute"
          style={{ top: 4, right: 5, fontSize: 10, color: '#fff', textShadowColor: '#ff6bd6', textShadowRadius: 4 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ✦
        </Text>
      )}
      {lucky && (
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
