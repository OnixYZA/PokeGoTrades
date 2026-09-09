import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Dropdown } from '@/components/ui/Dropdown';
import { FRIENDSHIP_LEVELS, SURFACE } from '@/constants/theme';
import { fmtDust, stardustCost } from '@/lib/format';
import { useTradeStore } from '@/store/trade-store';

export function StardustCard({ baseStardust }: { baseStardust: number }) {
  const { friendship, setFriendship } = useTradeStore();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);

  const level = FRIENDSHIP_LEVELS.find((f) => f.label === friendship)!;
  const finalDust = stardustCost(baseStardust, level.mult);

  return (
    <View className="mb-4 rounded-2xl border border-border p-4" style={SURFACE.stardustCard}>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 10, letterSpacing: 1 }}>
          Trade Cost
        </Text>

        <Pressable
          ref={anchorRef}
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Friendship level, currently ${level.label}`}
          accessibilityState={{ expanded: open }}
          className="flex-row items-center gap-1.5 rounded-lg border border-border-strong bg-bg-panel px-2.5 py-1.5 active:opacity-80"
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: level.color, boxShadow: `0 0 6px ${level.color}` }} />
          <Text className="font-display-semi" style={{ fontSize: 11, color: level.color }}>
            {level.label} Friend
          </Text>
          <ChevronDown size={12} color={level.color} />
        </Pressable>

        <Dropdown visible={open} onRequestClose={() => setOpen(false)} anchorRef={anchorRef} align="right" minWidth={130} gap={4}>
          {FRIENDSHIP_LEVELS.map((f, i) => {
            const selected = f.label === friendship;
            return (
              <Pressable
                key={f.label}
                onPress={() => {
                  setFriendship(f.label);
                  setOpen(false);
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
