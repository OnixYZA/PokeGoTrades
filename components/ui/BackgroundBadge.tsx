import { Text, View } from 'react-native';

import { hueBadgeStyle } from '@/constants/theme';
import type { BackgroundHint } from '@/data/types';

const LABEL: Record<BackgroundHint, string> = {
  meta: 'Meta Coverage',
  legacy: 'Legacy Move',
  shiny: 'Community Day',
  shadow: 'Rocket Origin',
};

interface BackgroundBadgeProps {
  bg: BackgroundHint;
  hue: number;
  accent: string;
}

/** Uppercase tinted pill naming the special-background reason (Meta Coverage, Legacy Move, ...). */
export function BackgroundBadge({ bg, hue, accent }: BackgroundBadgeProps) {
  return (
    <View
      className="rounded-full border px-2 py-[3px]"
      style={hueBadgeStyle(hue)}
    >
      <Text
        className="font-display-semi uppercase"
        style={{ fontSize: 10, letterSpacing: 0.6, color: accent }}
      >
        {LABEL[bg]}
      </Text>
    </View>
  );
}
