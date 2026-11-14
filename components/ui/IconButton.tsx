import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

interface IconButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
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
  disabled,
  size = 42,
  radius = 14,
  accessibilityLabel,
  style,
  className = 'border border-border-strong bg-bg-card',
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={Math.max(0, (44 - size) / 2)}
      className={`items-center justify-center ${disabled ? 'opacity-40' : 'active:opacity-70'} ${className}`}
      style={[{ width: size, height: size, borderRadius: radius }, style]}
    >
      <View style={{ pointerEvents: 'none' }}>{children}</View>
    </Pressable>
  );
}
