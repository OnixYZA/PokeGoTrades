import { Check, X } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

import { COLORS } from '@/constants/theme';
import type { FilterMode } from '@/store/listing-filters';

export type FilterChipState = 'neutral' | FilterMode;

interface FilterChipProps {
  label: string;
  state: FilterChipState;
  onPress: () => void;
  /** `sm` matches TextBadge's compact density; omit for the filter sheet's default size. */
  size?: 'default' | 'sm';
}

/** Expects a 6-digit hex; every color token in this project is one (same helper as TextBadge's own,
 *  duplicated rather than imported since TextBadge does not export it). */
function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  return `rgba(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)}, ${alpha})`;
}

const STATE_LABEL: Record<FilterChipState, string> = {
  neutral: 'any',
  include: 'included',
  exclude: 'excluded',
};

// Matches store/listing-filters.ts's cycle order (neutral -> include -> exclude -> neutral): the hint
// always names where the *next* tap lands, so a screen-reader user can predict a control whose only
// visible state is an icon + a border tint.
const NEXT_STATE_HINT: Record<FilterChipState, string> = {
  neutral: 'Double tap to show only these listings',
  include: 'Double tap to hide these listings instead',
  exclude: 'Double tap to clear this filter',
};

/**
 * Tristate feed-filter chip: neutral ("any") -> include (✓, green) -> exclude (✕, red) -> neutral,
 * one tap per state. The state is never colour-only — include and exclude each carry their own glyph
 * plus a distinct accessibility label, so the control still reads correctly for colour-blind users and
 * for anyone on a screen reader. Styled after TextBadge's pill (uppercase mono label, rounded-full,
 * translucent fill), but kept as its own component: TextBadge's `selected` is a boolean "on/off", with
 * no third "excluded" visual at all, and no accessibility contract for one either.
 */
export function FilterChip({ label, state, onPress, size = 'default' }: FilterChipProps) {
  const compact = size === 'sm';

  const accent = state === 'include' ? COLORS.accentGreen : state === 'exclude' ? COLORS.accentDanger : COLORS.textMuted;
  const containerStyle =
    state === 'neutral'
      ? { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: COLORS.borderStrong }
      : { backgroundColor: withAlpha(accent, 0.16), borderColor: withAlpha(accent, 0.5) };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${STATE_LABEL[state]}`}
      accessibilityHint={NEXT_STATE_HINT[state]}
      accessibilityState={{ selected: state !== 'neutral' }}
      // Content alone renders well under the 44pt minimum tap target (a compact pill), so pad the hit
      // area out to it rather than growing the visible chip — bigger for `sm`, whose padding is tighter.
      hitSlop={compact ? 14 : 6}
      className={`flex-row items-center rounded-full border active:opacity-80 ${
        compact ? 'gap-1 px-2 py-[3px]' : 'gap-1.5 px-3.5 py-2.5'
      }`}
      style={containerStyle}
    >
      {state === 'include' && <Check size={compact ? 10 : 12} color={accent} strokeWidth={2.5} />}
      {state === 'exclude' && <X size={compact ? 10 : 12} color={accent} strokeWidth={2.5} />}
      <Text
        className="font-mono-semi uppercase"
        style={{ fontSize: compact ? 10 : 11, letterSpacing: 0.6, color: state === 'neutral' ? COLORS.textMuted : accent }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
