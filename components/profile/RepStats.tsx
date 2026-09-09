import { View } from 'react-native';

import { StatTile } from '@/components/ui/StatTile';
import type { Trainer } from '@/data/types';

export function RepStats({ trainer }: { trainer: Trainer }) {
  return (
    <View className="mb-[22px] flex-row gap-2">
      <StatTile label="Trades" value={trainer.trades} color="#4fb3ff" radius={14} padding={12} valueSize={22} />
      <StatTile label="Rep" value={trainer.rep.toFixed(1)} suffix=" / 5" color="#f5c518" radius={14} padding={12} valueSize={22} />
      <StatTile label="Streak" value={trainer.streak} suffix="d" color="#7dffb3" radius={14} padding={12} valueSize={22} />
    </View>
  );
}
