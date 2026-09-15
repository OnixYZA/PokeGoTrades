import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Dropdown } from '@/components/ui/Dropdown';
import { FRIENDSHIP_LEVELS, SURFACE } from '@/constants/theme';
import { fmtDust } from '@/lib/format';
import { useTradeStore } from '@/store/trade-store';
import { TRADE_COST_MATRIX, TradeType } from '@/data/types';

const TRADE_TYPES: TradeType[] = [
  'Standard / Registered',
  'Special (Shiny/Legendary) Registered',
  'Unregistered (Standard)',
  'Unregistered (Shiny/Legendary)',
];

/** Shortened labels for the compact trigger — the dropdown's own menu items have room to show
 *  the full `TradeType` string, this is only for the tight space next to the friendship pill. */
const TRADE_TYPE_LABELS: Record<TradeType, string> = {
  'Standard / Registered': 'Standard (Reg)',
  'Special (Shiny/Legendary) Registered': 'Shiny/Legendary (Reg)',
  'Unregistered (Standard)': 'Standard (Unreg)',
  'Unregistered (Shiny/Legendary)': 'Shiny/Legendary (Unreg)',
};

export function StardustCard({ initialTradeType }: { initialTradeType: TradeType }) {
  const friendship = useTradeStore((s) => s.friendship);
  const setFriendship = useTradeStore((s) => s.setFriendship);
  const [friendOpen, setFriendOpen] = useState(false);
  const friendAnchorRef = useRef<View>(null);

  const [tradeType, setTradeType] = useState<TradeType>(initialTradeType);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeAnchorRef = useRef<View>(null);

  const level = FRIENDSHIP_LEVELS.find((f) => f.label === friendship)!;
  const finalDust = TRADE_COST_MATRIX[tradeType][level.label];

  return (
    <View className="mb-4 rounded-2xl border border-border p-4" style={SURFACE.stardustCard}>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Pressable
          ref={typeAnchorRef}
          onPress={() => setTypeOpen((v) => !v)}
          accessibilityRole="button"
          className="mr-2 flex-1 flex-row items-center gap-1.5 active:opacity-80"
        >
          <Text
            className="flex-1 font-mono uppercase text-text-subtle"
            style={{ fontSize: 10, letterSpacing: 1 }}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {TRADE_TYPE_LABELS[tradeType]}
          </Text>
          <ChevronDown size={12} color="#7d87a0" />
        </Pressable>

        <Pressable
          ref={friendAnchorRef}
          onPress={() => setFriendOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Friendship level, currently ${level.label}`}
          accessibilityState={{ expanded: friendOpen }}
          className="shrink-0 flex-row items-center gap-1.5 rounded-lg border border-border-strong bg-bg-panel px-2.5 py-1.5 active:opacity-80"
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: level.color, boxShadow: `0 0 6px ${level.color}` }} />
          <Text className="font-display-semi" style={{ fontSize: 11, color: level.color }}>
            {level.label} Friend
          </Text>
          <ChevronDown size={12} color={level.color} />
        </Pressable>

        <Dropdown visible={typeOpen} onRequestClose={() => setTypeOpen(false)} anchorRef={typeAnchorRef} minWidth={220} gap={4}>
          {TRADE_TYPES.map((t) => {
            const selected = t === tradeType;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  setTradeType(t);
                  setTypeOpen(false);
                }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                className="flex-row items-center px-3 py-2.5 active:opacity-80"
                style={{ backgroundColor: selected ? 'rgba(79,179,255,.08)' : 'transparent' }}
              >
                <Text className="font-display-semi text-text-primary" style={{ fontSize: 12 }}>
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </Dropdown>

        <Dropdown visible={friendOpen} onRequestClose={() => setFriendOpen(false)} anchorRef={friendAnchorRef} align="right" minWidth={130} gap={4}>
          {FRIENDSHIP_LEVELS.map((f, i) => {
            const selected = f.label === friendship;
            return (
              <Pressable
                key={f.label}
                onPress={() => {
                  setFriendship(f.label);
                  setFriendOpen(false);
                }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                className="flex-row items-center gap-2 px-3 py-2.5 active:opacity-80"
                style={{ backgroundColor: selected ? 'rgba(79,179,255,.08)' : 'transparent' }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.color }} />
                <Text className="font-display-semi text-text-primary" style={{ fontSize: 12 }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </Dropdown>
      </View>

      <View className="flex-row items-baseline gap-2">
        <Text className="font-display text-text-primary" style={{ fontSize: 34, letterSpacing: -0.68, lineHeight: 34 }}>
          {fmtDust(finalDust)}
        </Text>
        <Text className="font-mono uppercase" style={{ fontSize: 11, letterSpacing: 0.88, color: level.color }}>
          Stardust
        </Text>
      </View>

      <View className="mt-2.5 flex-row gap-1">
        {FRIENDSHIP_LEVELS.map((f) => {
          const active = f.label === friendship;
          return (
            <View
              key={f.label}
              className="h-[3px] flex-1 rounded"
              style={{ backgroundColor: active ? f.color : '#1e2436', boxShadow: active ? `0 0 8px ${f.color}` : undefined }}
            />
          );
        })}
      </View>
    </View>
  );
}
