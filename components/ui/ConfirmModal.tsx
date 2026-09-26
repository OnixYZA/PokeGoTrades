import { Modal, Pressable, Text, View } from 'react-native';

import { ToastHost } from '@/components/ui/ToastHost';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Cross-platform confirm dialog. `Alert.alert` is a no-op on react-native-web, so a destructive
 *  confirmation built on it silently never asks. */
export function ConfirmModal({ visible, title, message, confirmLabel, destructive, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: 'rgba(5,8,16,.78)' }}>
        <View
          accessibilityRole="alert"
          className="w-full rounded-[20px] border p-5"
          style={{ maxWidth: 360, backgroundColor: '#0a0f1c', borderColor: '#1e2436' }}
        >
          <Text className="font-display text-text-primary" style={{ fontSize: 17, letterSpacing: -0.2 }}>
            {title}
          </Text>
          <Text className="mt-2 font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
            {message}
          </Text>
          <View className="mt-5 flex-row gap-2.5">
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              className="flex-1 items-center rounded-xl border py-3 active:opacity-80"
              style={{ borderColor: '#1e2436', backgroundColor: '#0f1524' }}
            >
              <Text className="font-display-semi" style={{ fontSize: 14, color: '#8b93a7' }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              className="flex-1 items-center rounded-xl py-3 active:opacity-90"
              style={{ backgroundColor: destructive ? '#ff5c8a' : '#4fb3ff' }}
            >
              <Text className="font-display" style={{ fontSize: 14, color: '#04121f' }}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
      <ToastHost />
    </Modal>
  );
}
