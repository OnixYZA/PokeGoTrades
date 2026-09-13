import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Ban, Check, ChevronRight } from 'lucide-react-native';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

type BailReason = 'unresponsive' | 'unreasonable_adds' | 'spoofer' | 'other';

const REASONS: { id: BailReason; title: string; subtitle: string; flag?: boolean; chevron?: boolean }[] = [
  { id: 'unresponsive', title: 'Unresponsive', subtitle: 'Stopped replying after locking the trade' },
  { id: 'unreasonable_adds', title: 'Demanding unreasonable adds', subtitle: 'Asked for extras outside the listing' },
  {
    id: 'spoofer',
    title: 'Suspicious / Spoofer vibes',
    subtitle: 'GPS jumps, impossible catches, cheats',
    flag: true,
  },
  { id: 'other', title: 'Other', subtitle: 'Add a short note for the mods', chevron: true },
];

interface BailBlockModalProps {
  onSubmit?: (reason: BailReason) => void;
  onCancel?: () => void;
}

/** Bottom-sheet "Bail & Block" safety confirmation — reason selection is local state, with onPress hooks left open for the caller. */
export function BailBlockModal({ onSubmit, onCancel }: BailBlockModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedReason, setSelectedReason] = useState<BailReason>('unresponsive');

  return (
    <View
      className="flex-1 justify-end"
      style={{ backgroundImage: 'linear-gradient(180deg, rgba(8,8,12,0.4), rgba(8,8,12,0.9) 30%, rgba(8,8,12,0.98))' }}
    >
      <View
        className="border-t px-5 pt-3"
        style={{
          backgroundColor: C.bgSurface,
          borderTopColor: 'rgba(239,68,68,0.2)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingBottom: insets.bottom + 24,
          boxShadow: '0 -20px 60px rgba(239,68,68,0.08)',
        }}
      >
        <Grabber />
        <DangerIcon />
        <Heading />
        <ImpactChips />
        <ReasonList selectedReason={selectedReason} onSelectReason={setSelectedReason} />

        <Pressable
          onPress={() => onSubmit?.(selectedReason)}
          accessibilityRole="button"
          accessibilityLabel="Submit and block"
          className="flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] active:opacity-90"
          style={MODAL_SURFACE.ctaDanger}
        >
          <Ban size={20} color="#fff" strokeWidth={2.5} />
          <Text className="font-display" style={{ fontSize: 16, color: '#fff', letterSpacing: -0.16 }}>
            Submit &amp; Block
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="items-center py-3 active:opacity-70"
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.textSecondary }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Grabber() {
  return (
    <View className="mb-4 items-center">
      <View className="h-1 w-10 rounded-full" style={{ backgroundColor: C.borderDefault }} />
    </View>
  );
}

function DangerIcon() {
  return (
    <View className="mb-4 items-center">
      <View
        className="h-16 w-16 items-center justify-center rounded-[20px] border"
        style={[MODAL_SURFACE.dangerIcon, { borderColor: 'rgba(239,68,68,0.3)' }]}
      >
        <AlertTriangle size={30} color={C.danger} strokeWidth={2.2} />
      </View>
    </View>
  );
}

function Heading() {
  return (
    <View className="mb-5">
      <Text className="font-display mb-2 text-center" style={{ fontSize: 24, color: C.textPrimary, letterSpacing: -0.48 }}>
        Are you sure?
      </Text>
      <Text className="text-center" style={{ fontSize: 14, color: C.textSecondary, lineHeight: 21 }}>
        This will instantly close the chat and{' '}
        <Text style={{ color: C.textPrimary, fontWeight: '600' }}>un-freeze your listing</Text>. GhostTraderXX will be
        blocked from contacting you again.
      </Text>
    </View>
  );
}

function ImpactChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View
      className="flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      {icon}
      <Text className="font-mono" style={{ fontSize: 10, color: C.textSecondary, letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
}

function ImpactChips() {
  return (
    <View className="mb-5 flex-row justify-center gap-2">
      <ImpactChip icon={<Check size={12} color={C.success} strokeWidth={2.5} />} label="LISTING RELISTED" />
      <ImpactChip icon={<Ban size={12} color={C.danger} strokeWidth={2.5} />} label="USER BLOCKED" />
    </View>
  );
}

function ReasonRow({
  title,
  subtitle,
  selected,
  flag,
  chevron,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected?: boolean;
  flag?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected: !!selected }}
      className="flex-row items-center gap-3.5 rounded-2xl border px-5 py-[22px] active:opacity-90"
      style={{
        minHeight: 72,
        backgroundColor: selected ? 'rgba(239,68,68,0.08)' : C.bgCard,
        borderColor: selected ? 'rgba(239,68,68,0.4)' : C.borderDefault,
      }}
    >
      <View
        className="h-6 w-6 items-center justify-center rounded-full"
        style={selected ? { backgroundColor: C.danger } : { borderWidth: 1.5, borderColor: C.borderDefault }}
      >
        {selected ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
      </View>
      <View className="flex-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{title}</Text>
          {flag ? (
            <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: 'rgba(236,72,153,0.12)' }}>
              <Text className="font-mono" style={{ fontSize: 9, color: C.pink, letterSpacing: 0.45 }}>
                FLAGS ACCOUNT
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, color: selected ? C.textSecondary : C.textMuted, marginTop: 3 }}>{subtitle}</Text>
      </View>
      {chevron ? <ChevronRight size={18} color={C.textMuted} /> : null}
    </Pressable>
  );
}

function ReasonList({
  selectedReason,
  onSelectReason,
}: {
  selectedReason: BailReason;
  onSelectReason: (reason: BailReason) => void;
}) {
  return (
    <View>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        TELL US WHY (HELPS US MODERATE)
      </Text>
      <View accessibilityRole="radiogroup" className="mb-6 gap-2.5">
        {REASONS.map((reason) => (
          <ReasonRow
            key={reason.id}
            title={reason.title}
            subtitle={reason.subtitle}
            flag={reason.flag}
            chevron={reason.chevron}
            selected={selectedReason === reason.id}
            onPress={() => onSelectReason(reason.id)}
          />
        ))}
      </View>
    </View>
  );
}
