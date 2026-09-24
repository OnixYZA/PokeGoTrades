import { useState } from 'react';
import { Ban, Lock } from 'lucide-react-native';
import { Modal, Pressable, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { BailBlockModal } from '@/components/modals/BailBlockModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import { selectTradeView, useTradeStore } from '@/store/trade-store';

interface ChatActionRowProps {
  chatId: string;
  /** The other trainer's handle, for the dialogs. */
  partner: string;
  /** The Handshake should be shown: right after the seller locks, or when either party re-opens it. */
  onOpenHandshake: () => void;
  /** The chat was bailed, so there is nothing left to show here. */
  onBailed: () => void;
}

/** Muted, non-interactive stand-in for the primary button when this side has nothing to press. */
const IDLE = { backgroundColor: '#101728', borderWidth: 1, borderColor: '#1e2436' } as const;

/**
 * The action row under a chat. Which buttons exist depends on the trainer's side of the trade:
 * only the seller locks and unlocks (D1), so a buyer sees "Awaiting seller" until the seller acts.
 * Each button runs its own RPC through the store and reports failures as a toast.
 */
export function ChatActionRow({ chatId, partner, onOpenHandshake, onBailed }: ChatActionRowProps) {
  const view = useTradeStore(useShallow((s) => selectTradeView(s, chatId)));
  const lockChat = useTradeStore((s) => s.lockChat);
  const unlockChat = useTradeStore((s) => s.unlockChat);
  const [showBail, setShowBail] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [busy, setBusy] = useState(false);

  // A chat that ended has nothing left to do. (The mock's inactive chats keep their old "Trade Locked" look.)
  if (view.live && (view.phase === 'closed' || view.phase === 'bailed' || view.phase === 'completed')) return null;

  const lock = async () => {
    if (busy) return;
    setBusy(true);
    const result = await lockChat(chatId);
    setBusy(false);
    // Open the Handshake only once the server accepted the lock — never on a failed or racing attempt.
    if (result.ok) onOpenHandshake();
  };

  const unlock = async () => {
    setConfirmUnlock(false);
    if (busy) return;
    setBusy(true);
    await unlockChat(chatId);
    setBusy(false);
  };

  return (
    <View className="flex-row gap-2">
      {view.canBail ? (
        <Pressable
          onPress={() => setShowBail(true)}
          accessibilityRole="button"
          accessibilityLabel="Bail and block this trader"
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border px-3.5 py-3 active:opacity-80"
          style={{ backgroundColor: 'rgba(255,92,138,.08)', borderColor: 'rgba(255,92,138,.35)' }}
        >
          <Ban size={14} color="#ff5c8a" />
          <Text className="font-display" style={{ fontSize: 12, letterSpacing: 0.48, color: '#ff5c8a' }}>
            Bail &amp; Block
          </Text>
        </Pressable>
      ) : null}

      <PrimarySlot view={view} busy={busy} onLock={() => void lock()} onUnlock={() => setConfirmUnlock(true)} onOpenHandshake={onOpenHandshake} />

      <Modal
        visible={showBail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBail(false)}
        statusBarTranslucent
      >
        <BailBlockModal
          chatId={chatId}
          partnerName={partner}
          role={view.live ? view.role : undefined}
          onDone={() => {
            setShowBail(false);
            onBailed();
          }}
          onCancel={() => setShowBail(false)}
        />
      </Modal>

      <ConfirmModal
        visible={confirmUnlock}
        title="Unlock this trade?"
        message="This will re-open competing offers for this listing and clear any confirmation."
        confirmLabel="Unlock"
        destructive
        onConfirm={() => void unlock()}
        onCancel={() => setConfirmUnlock(false)}
      />
    </View>
  );
}

function PrimarySlot({
  view,
  busy,
  onLock,
  onUnlock,
  onOpenHandshake,
}: {
  view: ReturnType<typeof selectTradeView>;
  busy: boolean;
  onLock: () => void;
  onUnlock: () => void;
  onOpenHandshake: () => void;
}) {
  const lockedButton = (label: string, onPress: () => void) => (
    <PrimaryButton
      label={label}
      flex={1.4}
      fontSize={12}
      style={SURFACE.ctaGold}
      textColor="#2a1e02"
      icon={<Lock size={14} color="#2a1e02" />}
      onPress={onPress}
      disabled={busy}
    />
  );
  const idleButton = (label: string) => (
    <PrimaryButton label={label} flex={1.4} fontSize={12} style={IDLE} textColor="#8b93a7" disabled />
  );

  if (!view.live) {
    // The mock has no roles: one button that locks, and once locked (or closed) offers to unlock.
    return view.phase === 'locked' || view.phase === 'closed'
      ? lockedButton('Trade Locked', onUnlock)
      : (
          <PrimaryButton
            label="Accept Trade (Lock)"
            flex={1.4}
            fontSize={12}
            style={SURFACE.ctaBlueSmall}
            textColor="#04121f"
            icon={<Lock size={14} color="#04121f" />}
            onPress={onLock}
            disabled={busy}
          />
        );
  }

  if (view.role === 'seller') {
    if (view.phase === 'locked') return lockedButton('Trade Locked', onUnlock);
    if (view.phase === 'frozen') return idleButton('Another offer locked');
    return (
      <PrimaryButton
        label={busy ? 'Locking…' : 'Accept Trade (Lock)'}
        flex={1.4}
        fontSize={12}
        style={SURFACE.ctaBlueSmall}
        textColor="#04121f"
        icon={<Lock size={14} color="#04121f" />}
        onPress={onLock}
        disabled={busy}
      />
    );
  }

  if (view.phase === 'locked') return lockedButton('Locked by seller', onOpenHandshake);
  return idleButton(view.phase === 'frozen' ? 'Frozen' : 'Awaiting seller');
}
