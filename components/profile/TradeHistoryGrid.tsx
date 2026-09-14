import { ArrowRightLeft } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SURFACE } from '@/constants/theme';
import type { TradeHistoryEntry } from '@/data/types';

export function TradeHistoryGrid({ history }: { history: TradeHistoryEntry[] }) {
  return (
    <View className="mt-[22px]">
      <SectionHeading title="Trade History" meta={`${history.length} completed`} />
      <View className="gap-2">
        {history.map((trade) => (
          <View key={trade.id} className="flex-row items-center gap-3 rounded-2xl border border-border p-3" style={SURFACE.card}>
            <Chip pokemonId={trade.gave.pokemonId} hue={trade.gave.hue} shiny={trade.gave.shiny} lucky={trade.gave.lucky} size={40} />
            <ArrowRightLeft size={14} color="#6d7690" />
            <Chip pokemonId={trade.got.pokemonId} hue={trade.got.hue} shiny={trade.got.shiny} lucky={trade.got.lucky} size={40} />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="font-display-semi text-text-primary" style={{ fontSize: 12 }}>
                {trade.gave.name} <Text style={{ color: '#6d7690', fontWeight: '400' }}>for</Text> {trade.got.name}
              </Text>
              <Text className="font-mono text-text-subtle" style={{ fontSize: 10, marginTop: 2 }}>
                with {trade.partner} · {trade.date}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
