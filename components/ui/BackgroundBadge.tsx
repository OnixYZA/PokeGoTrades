import { Text, View } from 'react-native';

import {
  SPECIAL_BACKGROUND_LABEL,
  backgroundBadgeLabel,
  hasSpecialBackground,
  listingBackgroundFromToggle,
} from '@/constants/listing-attributes';
import { hueBadgeStyle } from '@/constants/theme';
import type { BackgroundHint } from '@/data/types';

export {
  SPECIAL_BACKGROUND_LABEL,
  backgroundBadgeLabel,
  hasSpecialBackground,
  listingBackgroundFromToggle,
};

interface BackgroundBadgeProps {
  bg: BackgroundHint;
  hue: number;
  accent: string;
}

/** Uppercase tinted pill shown only when a listing carries a Special Background (`bg === 'legacy'`). */
export function BackgroundBadge({ bg, hue, accent }: BackgroundBadgeProps) {
  const label = backgroundBadgeLabel(bg);
  if (!label) return null;

  return (
    <View
      className="rounded-full border px-2 py-[3px]"
      style={hueBadgeStyle(hue)}
    >
      <Text
        className="font-display-semi uppercase"
        style={{ fontSize: 10, letterSpacing: 0.6, color: accent }}
      >
        {label}
      </Text>
    </View>
  );
}
