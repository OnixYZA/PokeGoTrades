import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore, type ToastTone } from '@/lib/toast';

const TONE: Record<ToastTone, { border: string; bg: string; text: string }> = {
  error: { border: 'rgba(255,92,138,.45)', bg: 'rgba(38,12,22,.96)', text: '#ffb3c8' },
  info: { border: 'rgba(79,179,255,.4)', bg: 'rgba(10,22,38,.96)', text: '#b9deff' },
  success: { border: 'rgba(125,255,179,.4)', bg: 'rgba(10,32,22,.96)', text: '#b8ffd6' },
};

let nextHostId = 1;

/**
 * Renders the global toasts. Mount one at the app root and one inside every `<Modal>` that can fail an
 * action: a Modal is its own native window, so the root host would sit invisibly behind it.
 */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const toasts = useToastStore((s) => s.toasts);
  const hosts = useToastStore((s) => s.hosts);
  const registerHost = useToastStore((s) => s.registerHost);
  const hostId = useRef(nextHostId++).current;

  useEffect(() => registerHost(hostId), [registerHost, hostId]);

  if (hosts[hosts.length - 1] !== hostId || toasts.length === 0) return null;

  return (
    <View
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 1000, pointerEvents: 'none' }}
    >
      {toasts.map((t) => (
        <Animated.View
          key={t.id}
          entering={FadeInUp.duration(160)}
          exiting={FadeOut.duration(160)}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="rounded-2xl border px-4 py-3"
          style={{ maxWidth: 380, backgroundColor: TONE[t.tone].bg, borderColor: TONE[t.tone].border }}
        >
          <Text className="font-display-semi text-center" style={{ fontSize: 13, lineHeight: 18, color: TONE[t.tone].text }}>
            {t.message}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}
