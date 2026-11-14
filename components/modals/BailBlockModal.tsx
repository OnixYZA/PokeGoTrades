import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react-native';

import { describeBailSafeguard, type BailSafeguardTone } from '@/lib/bail-safeguard';
import { reputationRuleSummary } from '@/lib/trade-guide';
import { ToastHost } from '@/components/ui/ToastHost';
import type { ChatRole } from '@/data/types';
import { useTradeStore } from '@/store/trade-store';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

// One definition, in lib/reputation.ts (type-checked against the DB enum there); re-exported for existing importers.
import type { BailReason } from '@/lib/reputation';
export type { BailReason };

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

/** `bail_and_block` rejects a note longer than this (`blocks_note_only_for_other`). */
const NOTE_MAX_LENGTH = 280;

interface BailBlockModalProps {
  /** The chat to bail. When given, the modal runs the bail itself (the `bail_and_block` RPC with Supabase,
   *  a local removal with the mock) and reports back through `onDone`. */
  chatId?: string;
  /** Who gets blocked, for the copy. */
  partnerName?: string;
  /** Only the seller has a listing to un-freeze. Omitted, the copy stays the mock's seller wording. */
  role?: ChatRole;
  /** When the trade lock was taken. `null`: known to be unlocked. Omitted: unknown, so no Rep claim is shown. */
  lockedAt?: string | null;
  /** The signed-in trainer has confirmed the trade. */
  callerConfirmed?: boolean;
  /** The partner has confirmed the trade. */
  partnerConfirmed?: boolean;
  /** The bail went through. */
  onDone?: () => void;
  /** Standalone use, with no chat (the /test-bail screen): receives the choice and does nothing else. */
  onSubmit?: (reason: BailReason, note?: string) => void;
  onCancel?: () => void;
}

/** Bottom-sheet "Bail & Block" safety confirmation. */
export function BailBlockModal({
  chatId,
  partnerName,
  role,
  lockedAt,
  callerConfirmed = false,
  partnerConfirmed = false,
  onDone,   onSubmit,
  onCancel,
}: BailBlockModalProps) {
  const insets = useSafeAreaInsets();
  const bailChat = useTradeStore((s) => s.bailChat);
  const [selectedReason, setSelectedReason] = useState<BailReason>('unresponsive');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = useNow(typeof lockedAt === 'string');
  const safeguard = describeBailSafeguard({
    reason: selectedReason,
    lockedAtIso: lockedAt,
    callerConfirmed,
    partnerConfirmed,
    nowMs: now,
  });

  const submit = async () => {
    const trimmed = selectedReason === 'other' ? note.trim() || undefined : undefined;
    if (chatId === undefined) {
      onSubmit?.(selectedReason, trimmed);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await bailChat(chatId, selectedReason, trimmed);
    setSubmitting(false);
    if (result.ok) onDone?.();
    else setError(result.error.message);
  };

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
        <Heading partnerName={partnerName} sellerCopy={role !== 'buyer'} />
        <ImpactChips sellerCopy={role !== 'buyer'} />
        <ReasonList selectedReason={selectedReason} onSelectReason={setSelectedReason} />
        {safeguard ? <SafeguardBanner {...safeguard} /> : null}
        <RepRulesRow />

        {selectedReason === 'other' && (
          <View className="mb-6">
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX_LENGTH}
              placeholder="Tell us what happened…"
              placeholderTextColor={C.textDim}
              multiline
              numberOfLines={3}
              accessibilityLabel="Additional details for moderators"
              className="rounded-2xl border px-4 py-3"
              style={{
                backgroundColor: C.bgCard,
                borderColor: C.borderDefault,
                color: C.textPrimary,
                fontSize: 14,
                minHeight: 84,
                textAlignVertical: 'top',
              }}
            />
          </View>
        )}

        {error ? (
          <Text accessibilityRole="alert" className="mb-3 text-center" style={{ fontSize: 13, lineHeight: 19, color: C.danger }}>
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Submit and block"
          accessibilityState={{ busy: submitting }}
          className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] ${submitting ? 'opacity-70' : 'active:opacity-90'}`}
          style={MODAL_SURFACE.ctaDanger}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Ban size={20} color="#fff" strokeWidth={2.5} />}
          <Text className="font-display" style={{ fontSize: 16, color: '#fff', letterSpacing: -0.16 }}>
            {submitting ? 'Blocking…' : 'Submit & Block'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className={`items-center py-3 ${submitting ? 'opacity-40' : 'active:opacity-70'}`}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.textSecondary }}>Cancel</Text>
        </Pressable>
      </View>
      <ToastHost />
    </View>
  );
}

/** How often the grace countdown re-reads the clock. Minutes are the unit shown, so this need not be fast. */
const CLOCK_TICK_MS = 15_000;

/** `Date.now()`, refreshed on a light interval while `active`, and released when the modal unmounts. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const SAFEGUARD_TONES: Record<BailSafeguardTone, { fg: string; bg: string; border: string }> = {
  safe: { fg: C.success, bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.35)' },
  caution: { fg: C.gold, bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.35)' },
  penalty: { fg: C.danger, bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.45)' },
};

/** "Reputation & Grace Period Safeguard": what leaving costs in Rep, for the reason currently selected. */
function SafeguardBanner({ tone, headline, detail }: { tone: BailSafeguardTone; headline: string; detail: string }) {
  const t = SAFEGUARD_TONES[tone];
  const Icon = tone === 'penalty' ? AlertTriangle : ShieldCheck;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Reputation and grace period safeguard. ${headline}. ${detail}`}
      className="mb-5 flex-row items-start gap-3 rounded-2xl border px-4 py-3"
      style={{ backgroundColor: t.bg, borderColor: t.border }}
    >
      <Icon size={18} color={t.fg} strokeWidth={2.3} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="font-mono-semi" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8, marginBottom: 3 }}>
          REPUTATION &amp; GRACE PERIOD SAFEGUARD
        </Text>
        <Text className="font-mono-semi" style={{ fontSize: 12, color: t.fg, letterSpacing: 0.3 }}>
          {headline}
        </Text>
        <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 }}>{detail}</Text>
      </View>
    </View>
  );
}

/** "How rep penalties work": a compact expandable row under the safeguard banner. The bullets are
 *  `reputationRuleSummary()` (lib/trade-guide.ts), so they quote the same constants the rules run on. */
function RepRulesRow() {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="mb-5">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="How rep penalties work"
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center justify-between active:opacity-70"
        style={{ minHeight: 44 }}
      >
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textSecondary, letterSpacing: 0.4 }}>
          How rep penalties work
        </Text>
        <ChevronDown
          size={16}
          color={C.textMuted}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {expanded
        ? reputationRuleSummary().map((line) => (
            <View key={line} className="mb-1.5 flex-row gap-2">
              <Text style={{ fontSize: 12, lineHeight: 17, color: C.textMuted }}>{'•'}</Text>
              <Text className="flex-1" style={{ fontSize: 12, lineHeight: 17, color: C.textSecondary }}>
                {line}
              </Text>
            </View>
          ))
        : null}
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

function Heading({ partnerName, sellerCopy }: { partnerName?: string; sellerCopy: boolean }) {
  return (
    <View className="mb-5">
      <Text className="font-display mb-2 text-center" style={{ fontSize: 24, color: C.textPrimary, letterSpacing: -0.48 }}>
        Are you sure?
      </Text>
      <Text className="text-center" style={{ fontSize: 14, color: C.textSecondary, lineHeight: 21 }}>
        This will instantly close the chat
        {sellerCopy ? (
          <>
            {' '}and <Text style={{ color: C.textPrimary, fontWeight: '600' }}>un-freeze your listing</Text>
          </>
        ) : null}
        . {partnerName ?? 'GhostTraderXX'} will be blocked from contacting you again.
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

function ImpactChips({ sellerCopy }: { sellerCopy: boolean }) {
  return (
    <View className="mb-5 flex-row justify-center gap-2">
      {sellerCopy ? (
        <ImpactChip icon={<Check size={12} color={C.success} strokeWidth={2.5} />} label="LISTING RELISTED" />
      ) : null}
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
