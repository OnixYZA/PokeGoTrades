import type { ReactNode } from 'react';
import { Pressable, Text, type ViewStyle } from 'react-native';

interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  icon?: ReactNode;
  style: ViewStyle;
  textColor: string;
  flex?: number;
  fontSize?: number;
  accessibilityLabel?: string;
}

/** Gradient CTA button shared by the blue "Make Offer" / "Accept Trade" and gold "Trade Locked" states. */
export function PrimaryButton({
  label,
  onPress,
  icon,
  style,
  textColor,
  flex,
  fontSize = 15,
  accessibilityLabel,
}: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className="flex-row items-center justify-center gap-2 rounded-[14px] px-[18px] py-[15px] active:opacity-90"
      style={[style, flex ? { flex } : undefined]}
    >
      {icon}
      <Text className="font-display" style={{ fontSize, color: textColor, letterSpacing: fontSize * 0.02 }}>
        {label}
      </Text>
    </Pressable>
  );
}
