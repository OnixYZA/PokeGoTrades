import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

interface IconButtonProps {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  radius?: number;
  accessibilityLabel: string;
  style?: ViewStyle;
  className?: string;
}

/** Square icon-only control — search/filter buttons, sheet close button, composer send button. */
export function IconButton({
  children,
  onPress,
  size = 42,
  radius = 14,
  accessibilityLabel,
  style,
  className = 'border border-border-strong bg-bg-card',
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={Math.max(0, (44 - size) / 2)}
      className={`items-center justify-center active:opacity-70 ${className}`}
      style={[{ width: size, height: size, borderRadius: radius }, style]}
    >
      <View pointerEvents="none">{children}</View>
    </Pressable>
  );
}
