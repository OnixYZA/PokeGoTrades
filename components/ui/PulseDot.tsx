import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Small glowing dot — `pulse-glow` (1.8s, opacity 0.6 ↔ 1) for online / active-chat indicators. */
export function PulseDot({ size = 6, color = '#4fb3ff' }: { size?: number; color?: string }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withRepeat(withTiming(0.6, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (reducedMotion) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
    );
  }

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, boxShadow: `0 0 8px ${color}` },
        animatedStyle,
      ]}
    />
  );
}
