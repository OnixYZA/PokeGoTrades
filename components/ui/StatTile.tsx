import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

interface StatTileProps {
  label: string;
  value: ReactNode;
  color: string;
  icon?: ReactNode;
  suffix?: string;
  mono?: boolean;
  valueSize?: number;
  /** Container corner radius + padding vary slightly per screen in the handoff. */
  radius?: number;
  padding?: number | { horizontal: number; vertical: number };
}

/** Small labeled stat tile — feed stats strip, detail sheet stats grid, profile rep stats. */
export function StatTile({
  label,
  value,
  color,
  icon,
  suffix,
  mono = false,
  valueSize = 18,
  radius = 10,
  padding = 10,
}: StatTileProps) {
  const paddingStyle =
    typeof padding === 'number'
      ? { padding }
      : { paddingHorizontal: padding.horizontal, paddingVertical: padding.vertical };

  return (
    <View
      className="flex-1 border border-border bg-bg-panel"
      style={{ borderRadius: radius, ...paddingStyle }}
    >
      <View className="flex-row items-center gap-[5px]" style={icon ? { marginBottom: 4 } : undefined}>
        {icon}
        <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
          {label}
        </Text>
      </View>
      <View className="mt-0.5 flex-row items-baseline gap-[3px]">
        <Text className={mono ? 'font-mono-semi' : 'font-display'} style={{ fontSize: valueSize, color }}>
          {value}
        </Text>
        {suffix ? <Text style={{ fontSize: 11, color: '#4a5169', fontWeight: '600' }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}
