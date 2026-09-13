import { useState } from 'react';
import { Ban, Lock } from 'lucide-react-native';
import { Alert, Modal, Pressable, Text, View } from 'react-native';

import { BailBlockModal } from '@/components/modals/BailBlockModal';
import { HandshakeModal } from '@/components/modals/HandshakeModal';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';

interface ChatActionRowProps {
  locked: boolean;
  onBail: () => void;
  onLock: () => void;
  onUnlockRequest: () => void;
}

export function ChatActionRow({ locked, onBail, onLock, onUnlockRequest }: ChatActionRowProps) {
  const [showBail, setShowBail] = useState(false);
  const [showHandshake, setShowHandshake] = useState(false);

  return (
    <View className="flex-row gap-2">
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

      {locked ? (
        <PrimaryButton
          label="Trade Locked"
          flex={1.4}
          fontSize={12}
          style={SURFACE.ctaGold}
          textColor="#2a1e02"
          icon={<Lock size={14} color="#2a1e02" />}
          onPress={() =>
            Alert.alert('Unlock this trade?', 'This will re-open competing offers for this listing.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Unlock', style: 'destructive', onPress: onUnlockRequest },
            ])
          }
        />
      ) : (
        <PrimaryButton
          label="Accept Trade (Lock)"
          flex={1.4}
          fontSize={12}
          style={SURFACE.ctaBlueSmall}
          textColor="#04121f"
          icon={<Lock size={14} color="#04121f" />}
          onPress={() => {
            onLock();
            setShowHandshake(true);
          }}
        />
      )}

      <Modal
        visible={showBail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBail(false)}
        statusBarTranslucent
      >
        <BailBlockModal
          onSubmit={() => {
            setShowBail(false);
            onBail();
          }}
          onCancel={() => setShowBail(false)}
        />
      </Modal>

      <Modal
        visible={showHandshake}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHandshake(false)}
        statusBarTranslucent
      >
        <HandshakeModal
          onMarkCompleted={() => setShowHandshake(false)}
          onReturnToChat={() => setShowHandshake(false)}
        />
      </Modal>
    </View>
  );
}
