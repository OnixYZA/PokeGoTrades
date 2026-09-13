import { Text, View } from 'react-native';

import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { SURFACE } from '@/constants/theme';
import type { ChatMessage } from '@/data/types';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const mine = message.role === 'me';

  if (message.offer) {
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <FormalOfferCard offer={message.offer} />
        <Text className="font-mono" style={{ fontSize: 9, color: '#4a5169', marginTop: 3, paddingHorizontal: 4 }}>
          {message.time}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        className="border px-3.5 py-2.5"
        style={[
          { maxWidth: '78%', borderRadius: 16 },
          mine
            ? { ...SURFACE.bubbleMe, borderColor: 'transparent', borderBottomRightRadius: 4 }
            : { backgroundColor: '#0f1524', borderColor: '#1a2032', borderBottomLeftRadius: 4 },
        ]}
      >
        <Text style={{ fontSize: 13, lineHeight: 18, color: mine ? '#04121f' : '#e8ecf5', fontWeight: mine ? '600' : '400' }}>
          {message.text}
        </Text>
      </View>
      <Text className="font-mono" style={{ fontSize: 9, color: '#4a5169', marginTop: 3, paddingHorizontal: 4 }}>
        {message.time}
      </Text>
    </View>
  );
}
