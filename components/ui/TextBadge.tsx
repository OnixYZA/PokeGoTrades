import { Check } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface TextBadgeProps {
  label: string;
  /** Renders the accent-tinted "on" state with a check mark. */
  selected?: boolean;
  /** Omit to render a plain, non-interactive badge (safe to nest inside a pressable card). */
  onPress?: () => void;
  /** Accent for the selected state — pass a palette-local gold when used inside the modal flows. */
  accent?: string;
  /** `sm` is the compact, display-only density that matches LuckyBadge / BackgroundBadge on cards. */
  size?: 'default' | 'sm';
}

/** Expects a 6-digit hex; every color token in this project is one. */
function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  return `rgba(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)}, ${alpha})`;
}

/** Uppercase text pill used both as a tappable tag selector (Create Listing) and as a read-only
 *  tag badge (feed cards). Neutral translucent "off" styling so it sits correctly on any dark
 *  surface rather than being tied to one palette. */
export function TextBadge({ label, selected = false, onPress, accent = COLORS.accentGold, size = 'default' }: TextBadgeProps) {
  const compact = size === 'sm';

  const containerStyle = selected
    ? { backgroundColor: withAlpha(accent, 0.14), borderColor: accent }
    : { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.12)' };

  const content = (
    <>
      {selected && <Check size={compact ? 10 : 12} color={accent} strokeWidth={2.5} />}
      <Text
        className="font-mono-semi uppercase"
        style={{
          fontSize: compact ? 10 : 11,
          letterSpacing: 0.6,
          color: selected ? accent : COLORS.textMuted,
        }}
      >
        {label}
      </Text>
    </>
  );

  const className = `flex-row items-center rounded-full border ${
    compact ? 'gap-1 px-2 py-[3px]' : 'gap-1 px-3.5 py-2.5'
  }`;

  if (!onPress) {
    return (
      <View className={className} style={containerStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} tag`}
      accessibilityState={{ selected }}
      hitSlop={4}
      className={`${className} active:opacity-80`}
      style={containerStyle}
    >
      {content}
    </Pressable>
  );
}
