import { Text, View } from 'react-native';

import type { MetaTier } from '@/constants/pokedex';

/** One accent per tier, best to worst. Neon for the top, muted for the bottom, so a column of tiers scans by colour. */
export const TIER_COLOR: Record<MetaTier, string> = {
  'S+': '#ff5c8a',
  S: '#f5c518',
  A: '#7dffb3',
  B: '#4fb3ff',
  C: '#8b93a7',
};

function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  return `rgba(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)}, ${alpha})`;
}

/** The meta-tier pill: the tier letter(s), optionally prefixed with the track it belongs to ("PvE S"). The parent
 *  row carries the spoken label, so the pill itself is hidden from screen readers. */
export function TierPill({ tier, prefix, size = 'sm' }: { tier: MetaTier; prefix?: string; size?: 'sm' | 'lg' }) {
  const color = TIER_COLOR[tier];
  const fontSize = size === 'lg' ? 22 : 10;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`flex-row items-center gap-1 rounded-full border ${size === 'lg' ? 'px-3 py-1' : 'px-2 py-[2px]'}`}
      style={{ backgroundColor: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.45) }}
    >
      {prefix && (
        <Text className="font-mono" style={{ fontSize: 9, letterSpacing: 0.5, color: '#8b93a7' }}>
          {prefix}
        </Text>
      )}
      <Text className="font-display" style={{ fontSize, color }}>
        {tier}
      </Text>
    </View>
  );
}
