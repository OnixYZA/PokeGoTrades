import { Flame, Sparkles, TrendingDown, TrendingUp } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { demandTier, marketLabel, type MarketSignal, type MarketTier } from '@/constants/market';

const TIER_STYLE: Record<Exclude<MarketTier, 'new'>, { color: string; bg: string; border: string }> = {
  hot: { color: '#ff5c8a', bg: 'rgba(255,92,138,0.12)', border: 'rgba(255,92,138,0.35)' },
  high: { color: '#f5c518', bg: 'rgba(245,197,24,0.12)', border: 'rgba(245,197,24,0.35)' },
  balanced: { color: '#4fb3ff', bg: 'rgba(79,179,255,0.12)', border: 'rgba(79,179,255,0.35)' },
  surplus: { color: '#8b93a7', bg: 'rgba(139,147,167,0.12)', border: 'rgba(139,147,167,0.35)' },
};

const TIER_ICON: Record<Exclude<MarketTier, 'new'>, typeof Flame> = {
  hot: Flame,
  high: TrendingUp,
  balanced: TrendingUp,
  surplus: TrendingDown,
};

interface DemandBadgeProps {
  /** `undefined` until `useFeed` attaches a signal, or if that fetch failed. Unlike `demandTier`
   *  itself (which folds "no signal" into the 'new' tier so the rest of the app always has a label to
   *  show), this badge stays hidden entirely rather than guessing at a demand call for a listing it
   *  knows nothing about — see constants/market.ts's comment on `demandTier`. */
  market: MarketSignal | undefined;
}

/** Feed-card / detail-sheet want:have signal, tiered by `demandTier` (constants/market.ts). Replaces
 *  the old plain "★ <tier>" pill: a real signal (hot/high/balanced/surplus) gets its own tinted pill,
 *  while a genuinely new (or too-thin-to-call) pairing renders as a subtle, unfilled "NEW" pill so it
 *  never visually competes with an actual hot/high call. */
export function DemandBadge({ market }: DemandBadgeProps) {
  if (!market) return null;
  const tier = demandTier(market);

  if (tier === 'new') {
    return (
      <View className="flex-row items-center gap-1 rounded-lg border border-border-strong bg-bg-panel px-2 py-1">
        <Sparkles size={11} color="#8b93a7" />
        <Text className="font-display text-text-muted" style={{ fontSize: 11 }}>
          NEW
        </Text>
      </View>
    );
  }

  const style = TIER_STYLE[tier];
  const Icon = TIER_ICON[tier];

  return (
    <View
      className="flex-row items-center gap-1 rounded-lg border px-2 py-1"
      style={{ backgroundColor: style.bg, borderColor: style.border }}
    >
      <Icon size={11} color={style.color} />
      <Text className="font-display" style={{ fontSize: 12, color: style.color }}>
        {marketLabel(tier)}
      </Text>
    </View>
  );
}
