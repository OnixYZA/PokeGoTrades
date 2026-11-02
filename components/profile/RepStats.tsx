import { Text, View } from 'react-native';

import { StatTile } from '@/components/ui/StatTile';
import type { Trainer } from '@/data/types';
import { LOCK_GRACE_PERIOD_MINUTES, getRepStanding, type RepTier } from '@/lib/reputation';

interface RepStatsProps {
  /** `rep` is nullable until the reputation migration lands everywhere, so it is read defensively. */
  trainer: Omit<Trainer, 'rep'> & { rep?: number | null };
  /** Late bails on record. Undefined where the data source doesn't carry it (the mock). */
  bailsCount?: number | null;
}

const BADGE_TEXT: Record<RepTier, string> = {
  exemplary: 'EXEMPLARY TRADER',
  trusted: 'TRUSTED TRADER',
  standard: 'STANDARD',
  caution: 'CAUTION',
};

/** Trades / Rep / Streak tiles plus the trust & anti-bail standing footer. */
export function RepStats({ trainer, bailsCount }: RepStatsProps) {
  const rep = trainer.rep ?? null;
  const bails = bailsCount ?? 0;
  const standing = getRepStanding(rep, trainer.trades, bails);
  const note =
    bails > 0
      ? `${bails} late bail${bails === 1 ? '' : 's'} recorded`
      : `0 late bails · ${LOCK_GRACE_PERIOD_MINUTES}m lock grace protection`;

  return (
    <View className="mb-[22px]">
      <View className="flex-row gap-2">
        <StatTile label="Trades" value={trainer.trades} color="#4fb3ff" radius={14} padding={12} valueSize={22} />
        <StatTile label="Rep" value={rep === null ? '—' : rep.toFixed(1)} suffix={rep === null ? undefined : ' / 5'} color="#f5c518" radius={14} padding={12} valueSize={22} />
        <StatTile label="Streak" value={trainer.streak} suffix="d" color="#7dffb3" radius={14} padding={12} valueSize={22} />
      </View>
      <View
        className="mt-2 flex-row items-center gap-2.5 rounded-[14px] border border-border bg-bg-panel px-3 py-2.5"
        accessible
        accessibilityLabel={`Trust and anti-bail standing: ${BADGE_TEXT[standing.tier].toLowerCase()}. ${note}`}
      >
        <View className="rounded-md px-2 py-1" style={{ backgroundColor: `${standing.color}1f`, borderWidth: 1, borderColor: `${standing.color}59` }}>
          <Text className="font-mono-semi" style={{ fontSize: 10, letterSpacing: 0.6, color: standing.color }}>
            {BADGE_TEXT[standing.tier]}
          </Text>
        </View>
        <Text className="flex-1" style={{ fontSize: 11, color: '#8b93a7' }} numberOfLines={2}>
          {note}
        </Text>
      </View>
    </View>
  );
}
