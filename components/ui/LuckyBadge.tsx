import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { luckyShimmerGradient } from '@/constants/theme';

/** Guaranteed-lucky pill with the handoff's `shimmer` sweep (3s linear, background-position). */
export function LuckyBadge({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    progress.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 0.5) * 40 }],
  }));

  const fontSize = size === 'sm' ? 9 : 10;

  return (
    <View
      className="flex-row items-center gap-1 overflow-hidden rounded-full px-2 py-[3px]"
      style={{ boxShadow: '0 0 16px rgba(245,197,24,.35), inset 0 1px 0 rgba(255,255,255,.6)' }}
    >
      <Animated.View
        style={[
          { pointerEvents: 'none' },
          {
            position: 'absolute',
            top: -20,
            bottom: -20,
            left: -20,
            right: -20,
            backgroundImage: luckyShimmerGradient,
          },
          animatedStyle,
        ]}
      />
      <Text
        className="font-display uppercase"
        style={{ fontSize, letterSpacing: fontSize * 0.08, color: '#2a1e02' }}
      >
        ✦ Guaranteed Lucky
      </Text>
    </View>
  );
}
