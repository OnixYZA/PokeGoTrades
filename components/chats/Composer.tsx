import { Plus, Send } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  locked: boolean;
  /** Trade lost to a competing offer — input is disabled entirely. */
  frozen?: boolean;
  onOpenArsenal?: () => void;
}

export function Composer({ value, onChangeText, onSend, locked, frozen = false, onOpenArsenal }: ComposerProps) {
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={onOpenArsenal}
        disabled={frozen}
        accessibilityRole="button"
        accessibilityLabel="Send a formal offer from your Arsenal"
        className="items-center justify-center rounded-full border border-border bg-bg-card active:opacity-70"
        style={{ width: 40, height: 40, opacity: frozen ? 0.4 : 1 }}
      >
        <Plus size={18} color="#4fb3ff" />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!frozen}
        placeholder={frozen ? 'Chat frozen — trade pending elsewhere' : locked ? 'Coordinate meetup…' : 'Type a message…'}
        placeholderTextColor="#6d7690"
        style={{ fontSize: 13, color: '#e8ecf5', opacity: frozen ? 0.5 : 1 }}
        className="flex-1 rounded-[20px] border border-border bg-bg-card px-4 py-[11px]"
        accessibilityLabel="Message"
        onSubmitEditing={onSend}
        returnKeyType="send"
      />
      <Pressable
        onPress={onSend}
        disabled={!value.trim() || frozen}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        className="items-center justify-center rounded-full border border-border bg-bg-card active:opacity-70"
        style={{ width: 40, height: 40, opacity: value.trim() && !frozen ? 1 : 0.5 }}
      >
        <Send size={16} color="#4fb3ff" />
      </Pressable>
    </View>
  );
}
