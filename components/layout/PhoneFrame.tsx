import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The handoff's outer radial-gradient backdrop + centered 420px "phone frame" column.
 * Real safe-area insets replace the mockup's hand-drawn status bar row (see plan §Status bar) —
 * everything below keeps the mockup's exact spacing.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 items-center"
      style={{ backgroundImage: 'radial-gradient(ellipse at top, #0d1220 0%, #050810 60%)' }}
    >
      <View className="w-full max-w-[420px] flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
        {children}
      </View>
    </View>
  );
}
