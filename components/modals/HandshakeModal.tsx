import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckSquare, Copy, Lock, Star, X } from 'lucide-react-native';
import { useShallow } from 'zustand/react/shallow';

import { ToastHost } from '@/components/ui/ToastHost';
import { getHandshake, type Handshake } from '@/lib/api/chats';
import { USE_SUPABASE } from '@/lib/data-source';
import { describeError } from '@/lib/rpc-errors';
import { toast } from '@/lib/toast';
import { selectTradeView, useTradeStore } from '@/store/trade-store';

import { MODAL_COLORS, MODAL_SURFACE, monogramGradient } from './tokens';

const C = MODAL_COLORS;

/** One trainer's card: who they are and the code to add them by. */
interface Trainer {
  name: string;
  roleKicker: string;
  /** Display form, 'dddd · dddd · dddd'. */
  code: string;
  /** What COPY puts on the clipboard: the 12 raw digits, which is what the game's friend search takes. */
  rawCode: string | null;
}

// The layout the design handoff shipped with. The mock data source keeps showing it.
const MOCK_ME: Trainer = { name: 'RaticateBoss99', roleKicker: 'YOU · SELLER', code: '4821 · 5904 · 3372', rawCode: null };
const MOCK_PARTNER: Trainer = { name: 'KantoKing', roleKicker: 'BUYER · 4.9 ★ (128)', code: '1109 · 7462 · 8503', rawCode: null };

function dotted(raw: string | null): string {
  return raw && raw.length === 12 ? `${raw.slice(0, 4)} · ${raw.slice(4, 8)} · ${raw.slice(8)}` : 'Not set';
}

function toTrainers(data: Handshake): { me: Trainer; partner: Trainer } {
  const partnerRole = data.myRole === 'seller' ? 'BUYER' : 'SELLER';
  return {
    me: { name: data.myHandle, roleKicker: `YOU · ${data.myRole.toUpperCase()}`, code: dotted(data.myFriendCode), rawCode: data.myFriendCode },
    partner: {
      name: data.partnerHandle,
      roleKicker: `${partnerRole} · ${data.partnerTradesCount} ${data.partnerTradesCount === 1 ? 'TRADE' : 'TRADES'}`,
      code: dotted(data.partnerFriendCode),
      rawCode: data.partnerFriendCode,
    },
  };
}

interface HandshakeModalProps {
  /** A Supabase chat. The modal then loads the real friend codes (`get_handshake`), runs confirm / withdraw
   *  itself, and closes itself if the lock goes away. Omitted, it is the mock's static overlay. */
  chatId?: string;
  /** Return to the chat without changing anything. */
  onReturnToChat?: () => void;
  /** Supabase: the trade completed (by my confirmation or the partner's). */
  onCompleted?: () => void;
  /** Mock: "Mark Trade Completed". */
  onMarkCompleted?: () => void;
  onCopyMyCode?: () => void;
  onCopyTheirCode?: () => void;
}

/** Post-lock "Handshake & Verify" overlay: exchange friend codes, then both trainers confirm (D2). */
export function HandshakeModal({
  chatId,
  onReturnToChat,
  onCompleted,
  onMarkCompleted,
  onCopyMyCode,
  onCopyTheirCode,
}: HandshakeModalProps) {
  const insets = useSafeAreaInsets();
  const live = USE_SUPABASE && chatId !== undefined;
  const id = chatId ?? '';

  const trade = useTradeStore(useShallow((s) => selectTradeView(s, id)));
  const partnerName = useTradeStore((s) => s.chats[id]?.partner) ?? 'your partner';
  const confirmTrade = useTradeStore((s) => s.confirmTrade);
  const withdrawConfirmation = useTradeStore((s) => s.withdrawConfirmation);

  const [data, setData] = useState<Handshake | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once this modal is closing on purpose, so the phase watcher below stays out of the way. */
  const closing = useRef(false);

  // Load the codes once. Each is revealed only while the lock holds, so a failure here means it is gone.
  useEffect(() => {
    if (!live) return;
    let active = true;
    getHandshake(id).then(
      (loaded) => active && setData(loaded),
      (failure: unknown) => {
        if (!active || closing.current) return;
        closing.current = true;
        toast(describeError(failure).message);
        onReturnToChat?.();
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per chat
  }, [live, id]);

  // The trade moved on underneath us: the partner confirmed (completed) or someone released the lock.
  useEffect(() => {
    if (!live || closing.current || trade.phase === 'locked') return;
    closing.current = true;
    if (trade.phase === 'completed') {
      toast('Trade completed.', 'success');
      onCompleted?.();
    } else {
      toast('This trade is no longer locked.', 'info');
      onReturnToChat?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the phase only
  }, [live, trade.phase]);

  const copy = async (trainer: Trainer, fallback?: () => void) => {
    if (!trainer.rawCode) {
      fallback?.();
      return;
    }
    await Clipboard.setStringAsync(trainer.rawCode);
    toast(`${trainer.name}'s friend code copied`, 'success');
  };

  const confirm = async () => {
    if (busy) return;
    setBusy('confirm');
    setError(null);
    const result = await confirmTrade(id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value === 'completed') {
      closing.current = true;
      toast('Trade completed.', 'success');
      onCompleted?.();
    }
  };

  const withdraw = async () => {
    if (busy) return;
    setBusy('withdraw');
    setError(null);
    const result = await withdrawConfirmation(id);
    setBusy(null);
    if (!result.ok) setError(result.error.message);
  };

  const trainers = live ? (data ? toTrainers(data) : null) : { me: MOCK_ME, partner: MOCK_PARTNER };

  return (
    <View
      className="flex-1 px-5"
      style={{
        backgroundColor: C.bgBase,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <LockRibbon />
      <TitleBlock />

      {trainers ? (
        <>
          <HandshakeAvatars me={trainers.me} partner={trainers.partner} />
          <View className="mb-5">
            <FriendCodeCard
              stripeFrom={C.pink}
              stripeTo={C.pinkDark}
              trainer={trainers.me}
              onCopy={() => void copy(trainers.me, onCopyMyCode)}
            />
            <FriendCodeCard
              stripeFrom={C.blue}
              stripeTo={C.blueDark}
              trainer={trainers.partner}
              ratingStar={!live}
              isLast
              onCopy={() => void copy(trainers.partner, onCopyTheirCode)}
            />
          </View>
        </>
      ) : (
        <View className="mb-5 items-center py-16">
          <ActivityIndicator color={C.blue} />
          <Text className="mt-3" style={{ fontSize: 12, color: C.textMuted }}>
            Loading friend codes…
          </Text>
        </View>
      )}

      <WarningCallout safeLoc={live ? data?.partnerSafeLoc : null} />

      {error ? (
        <Text accessibilityRole="alert" className="mb-3 text-center" style={{ fontSize: 13, lineHeight: 19, color: C.danger }}>
          {error}
        </Text>
      ) : null}

      {live ? (
        <ConfirmControls
          confirmation={trade.confirmation}
          partnerName={partnerName}
          busy={busy}
          ready={data !== null}
          onConfirm={() => void confirm()}
          onWithdraw={() => void withdraw()}
        />
      ) : (
        <Pressable
          onPress={onMarkCompleted}
          accessibilityRole="button"
          accessibilityLabel="Mark trade completed"
          className="flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] active:opacity-90"
          style={[MODAL_SURFACE.ctaGreen, { marginTop: 'auto' }]}
        >
          <CheckSquare size={20} color={C.successText} strokeWidth={2.8} />
          <Text className="font-display" style={{ fontSize: 16, color: C.successText, letterSpacing: -0.16 }}>
            Mark Trade Completed
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={onReturnToChat}
        accessibilityRole="button"
        accessibilityLabel="Return to chat"
        className="items-center py-3 active:opacity-70"
      >
        <Text style={{ fontSize: 13, fontWeight: '500', color: C.textMuted }}>Return to chat</Text>
      </Pressable>
      <ToastHost />
    </View>
  );
}

/** D2 in three states: nothing confirmed yet, I am waiting on the partner, or the partner is waiting on me. */
function ConfirmControls({
  confirmation,
  partnerName,
  busy,
  ready,
  onConfirm,
  onWithdraw,
}: {
  confirmation: 'none' | 'awaiting_partner' | 'awaiting_me';
  partnerName: string;
  busy: 'confirm' | 'withdraw' | null;
  ready: boolean;
  onConfirm: () => void;
  onWithdraw: () => void;
}) {
  const waiting = confirmation === 'awaiting_partner';
  const label =
    busy === 'confirm'
      ? 'Confirming…'
      : waiting
        ? `Waiting for ${partnerName} to confirm`
        : confirmation === 'awaiting_me'
          ? `${partnerName} confirmed — tap to confirm`
          : 'Mark Trade Completed';

  return (
    <View style={{ marginTop: 'auto' }}>
      <Pressable
        onPress={onConfirm}
        disabled={waiting || busy !== null || !ready}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: waiting || busy !== null || !ready, busy: busy === 'confirm' }}
        className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] ${waiting || !ready ? 'opacity-60' : busy ? 'opacity-70' : 'active:opacity-90'}`}
        style={waiting ? { backgroundColor: C.bgCard, borderWidth: 1, borderColor: C.borderDefault } : MODAL_SURFACE.ctaGreen}
      >
        {busy === 'confirm' ? (
          <ActivityIndicator color={C.successText} />
        ) : (
          <CheckSquare size={20} color={waiting ? C.textMuted : C.successText} strokeWidth={2.8} />
        )}
        <Text
          className="font-display"
          style={{ fontSize: waiting ? 14 : 16, color: waiting ? C.textSecondary : C.successText, letterSpacing: -0.16 }}
        >
          {label}
        </Text>
      </Pressable>
      {waiting ? (
        <Pressable
          onPress={onWithdraw}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Withdraw confirmation"
          className={`items-center pt-3 ${busy ? 'opacity-50' : 'active:opacity-70'}`}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.pink }}>
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw confirmation'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LockRibbon() {
  return (
    <View className="mb-5 flex-row items-center justify-center gap-2">
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, transparent, #38bdf8)' }} />
      <View
        className="flex-row items-center gap-2 rounded-full px-3.5 py-1.5"
        style={{ backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)' }}
      >
        <Lock size={12} color={C.blue} strokeWidth={2.5} />
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.blue, letterSpacing: 1.1 }}>
          TRADE LOCKED
        </Text>
      </View>
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, #38bdf8, transparent)' }} />
    </View>
  );
}

function TitleBlock() {
  return (
    <View className="mb-12 items-center">
      <Text className="font-display text-center" style={{ fontSize: 26, lineHeight: 30, color: C.textPrimary, letterSpacing: -0.52 }}>
        Exchange{'\n'}Friend Codes
      </Text>
      <Text className="mt-2.5 text-center" style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19.5 }}>
        Both trainers have accepted. Add each other in-game and meet up.
      </Text>
    </View>
  );
}

function HandshakeAvatars({ me, partner }: { me: Trainer; partner: Trainer }) {
  return (
    <View className="mb-8 flex-row items-center justify-center gap-3">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={[monogramGradient(C.pink, C.pinkDark), { borderWidth: 2, borderColor: C.bgSurface, boxShadow: `0 0 0 2px ${C.pink}` }]}
      >
        <Text className="font-display" style={{ fontSize: 20, color: '#fff' }}>
          {me.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View className="items-center gap-1">
        <X size={24} color={C.blue} strokeWidth={2} />
        <Text className="font-mono" style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.9 }}>
          MATCH
        </Text>
      </View>
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={[monogramGradient(C.blue, C.blueDark), { borderWidth: 2, borderColor: C.bgSurface, boxShadow: `0 0 0 2px ${C.blue}` }]}
      >
        <Text className="font-display" style={{ fontSize: 20, color: '#fff' }}>
          {partner.name.charAt(0).toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

function FriendCodeCard({
  stripeFrom,
  stripeTo,
  trainer,
  ratingStar,
  isLast,
  onCopy,
}: {
  stripeFrom: string;
  stripeTo: string;
  trainer: Trainer;
  ratingStar?: boolean;
  isLast?: boolean;
  onCopy?: () => void;
}) {
  return (
    <View
      className="relative overflow-hidden rounded-2xl border p-4"
      style={[{ backgroundColor: C.bgCard, borderColor: C.borderDefault }, !isLast ? { marginBottom: 12 } : null]}
    >
      <View className="absolute bottom-0 left-0 top-0 w-[3px]" style={monogramGradient(stripeFrom, stripeTo)} />
      <View className="mb-2.5 flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-full" style={monogramGradient(stripeFrom, stripeTo)}>
          <Text className="font-display" style={{ fontSize: 13, color: '#fff' }}>
            {trainer.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View>
          <View className="flex-row items-center gap-1.5">
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.textPrimary }}>{trainer.name}</Text>
            {ratingStar ? <Star size={12} color={C.blue} fill={C.blue} /> : null}
          </View>
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
            {trainer.roleKicker}
          </Text>
        </View>
      </View>
      <View
        className="flex-row items-center gap-2 rounded-[10px] border px-3.5 py-3"
        style={{ backgroundColor: C.bgBase, borderColor: C.borderSubtle }}
      >
        <Text className="font-mono-bold flex-1" style={{ fontSize: 17, color: C.textPrimary, letterSpacing: 1.36 }}>
          {trainer.code}
        </Text>
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${trainer.name}'s friend code`}
          className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 active:opacity-70"
          style={{ backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)' }}
        >
          <Copy size={12} color={C.blue} strokeWidth={2.5} />
          <Text className="font-mono-bold" style={{ fontSize: 10, color: C.blue, letterSpacing: 0.8 }}>
            COPY
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function WarningCallout({ safeLoc }: { safeLoc?: string | null }) {
  return (
    <View
      className="mb-5 flex-row gap-3 rounded-xl border p-4"
      style={{ backgroundColor: 'rgba(253,224,71,0.12)', borderColor: 'rgba(253,224,71,0.5)' }}
    >
      <AlertTriangle size={22} color={C.goldBright} strokeWidth={2.2} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text style={{ fontSize: 14, fontWeight: '700', color: C.goldBright, marginBottom: 4 }}>
          Location Data is hidden
        </Text>
        <Text style={{ fontSize: 13, color: C.goldPale, lineHeight: 19.5 }}>
          Coordinate your meet-up safely in the chat. Never share your home address.
          {safeLoc ? ` Their preferred meet zone: ${safeLoc}.` : ''}
        </Text>
      </View>
    </View>
  );
}
