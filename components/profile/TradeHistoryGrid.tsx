import { ArrowRightLeft, MessageCircle } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SURFACE } from '@/constants/theme';
import type { TradeHistoryEntry } from '@/data/types';

/** Same footprint as a `Chip` so a negotiated-in-chat row lines up with a formal-offer row. */
const GOT_TILE_SIZE = 40;

export function TradeHistoryGrid({ history }: { history: TradeHistoryEntry[] }) {
  return (
    <View className="mt-[22px]">
      <SectionHeading title="Trade History" meta={`${history.length} completed`} />
      {history.length === 0 ? (
        <Text style={{ fontSize: 12, color: '#6d7690' }}>No completed trades yet</Text>
      ) : (
        <View className="gap-2">
          {history.map((trade) => (
            <View key={trade.id} className="flex-row items-center gap-3 rounded-2xl border border-border p-3" style={SURFACE.card}>
              <Chip creature={trade.gave} size={40} />
              <ArrowRightLeft size={14} color="#6d7690" />
              {trade.got ? (
                <Chip creature={trade.got} size={40} />
              ) : (
                <NegotiatedTile />
              )}
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="font-display-semi text-text-primary" style={{ fontSize: 12 }}>
                  {trade.gave.name}{' '}
                  {trade.got ? (
                    <>
                      <Text style={{ color: '#6d7690', fontWeight: '400' }}>for</Text> {trade.got.name}
                    </>
                  ) : (
                    <Text style={{ color: '#6d7690', fontWeight: '400' }}>· negotiated in chat</Text>
                  )}
                </Text>
                <Text className="font-mono text-text-subtle" style={{ fontSize: 10, marginTop: 2 }}>
                  with {trade.partner} · {trade.date}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Stands in for the "got" `Chip` when `TradeHistoryEntry.got` is `null` — the trade's other side was
 *  negotiated in chat with no formal offer recorded, so there's no creature to draw a sprite for. */
function NegotiatedTile() {
  return (
    <View
      className="shrink-0 items-center justify-center rounded-xl border border-dashed"
      style={{ width: GOT_TILE_SIZE, height: GOT_TILE_SIZE, borderColor: '#2a3350' }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <MessageCircle size={16} color="#6d7690" />
    </View>
  );
}
