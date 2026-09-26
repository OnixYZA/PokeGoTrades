import { Plus, Send } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

import type { ChatPhase } from '@/store/trade-store';

interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** The chat's phase, which decides the placeholder. */
  phase: ChatPhase;
  /** Input and both buttons are off: frozen, closed, bailed or completed. */
  disabled: boolean;
  onOpenArsenal?: () => void;
}

const PLACEHOLDER: Record<ChatPhase, string> = {
  open: 'Type a message…',
  locked: 'Coordinate meetup…',
  frozen: 'Chat frozen — trade pending elsewhere',
  closed: 'This chat is closed',
  bailed: 'This chat was closed',
  completed: 'Trade completed',
};

export function Composer({ value, onChangeText, onSend, phase, disabled, onOpenArsenal }: ComposerProps) {
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={onOpenArsenal}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Send a formal offer from your Arsenal"
        className="items-center justify-center rounded-full border border-border bg-bg-card active:opacity-70"
        style={{ width: 40, height: 40, opacity: disabled ? 0.4 : 1 }}
      >
        <Plus size={18} color="#4fb3ff" />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        placeholder={PLACEHOLDER[phase]}
        placeholderTextColor="#6d7690"
        style={{ fontSize: 13, color: '#e8ecf5', opacity: disabled ? 0.5 : 1 }}
        className="flex-1 rounded-[20px] border border-border bg-bg-card px-4 py-[11px]"
        accessibilityLabel="Message"
        onSubmitEditing={onSend}
        returnKeyType="send"
      />
      <Pressable
        onPress={onSend}
        disabled={!value.trim() || disabled}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        className="items-center justify-center rounded-full border border-border bg-bg-card active:opacity-70"
        style={{ width: 40, height: 40, opacity: value.trim() && !disabled ? 1 : 0.5 }}
      >
        <Send size={16} color="#4fb3ff" />
      </Pressable>
    </View>
  );
}
