import { Send } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  locked: boolean;
}

export function Composer({ value, onChangeText, onSend, locked }: ComposerProps) {
  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={locked ? 'Coordinate meetup…' : 'Type a message…'}
        placeholderTextColor="#6d7690"
        style={{ fontSize: 13, color: '#e8ecf5' }}
        className="flex-1 rounded-[20px] border border-border bg-bg-card px-4 py-[11px]"
        accessibilityLabel="Message"
        onSubmitEditing={onSend}
        returnKeyType="send"
      />
      <Pressable
        onPress={onSend}
        disabled={!value.trim()}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        className="items-center justify-center rounded-full border border-border bg-bg-card active:opacity-70"
        style={{ width: 40, height: 40, opacity: value.trim() ? 1 : 0.5 }}
      >
        <Send size={16} color="#4fb3ff" />
      </Pressable>
    </View>
  );
}
