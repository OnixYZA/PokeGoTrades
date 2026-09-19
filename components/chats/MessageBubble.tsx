import { Pressable, Text, View } from 'react-native';

import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { SURFACE } from '@/constants/theme';
import type { ChatMessage } from '@/data/types';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Re-sends a failed message under the same client id. */
  onRetry?: () => void;
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  // Lock / unlock / confirm / completed / closed: a centered line, not a bubble from either trainer.
  if (message.role === 'system') {
    return (
      <View className="items-center px-6 py-1">
        <Text className="text-center font-mono" style={{ fontSize: 10, lineHeight: 15, letterSpacing: 0.3, color: '#7d87a0' }}>
          {message.text}
        </Text>
      </View>
    );
  }

  const mine = message.role === 'me';

  const meta = (
    <View className="flex-row items-center gap-1.5" style={{ marginTop: 3, paddingHorizontal: 4 }}>
      <Text className="font-mono" style={{ fontSize: 9, color: '#4a5169' }}>
        {message.time}
      </Text>
      {message.delivery === 'pending' ? (
        <Text className="font-mono" style={{ fontSize: 9, color: '#7d87a0' }}>
          Sending…
        </Text>
      ) : null}
      {message.delivery === 'failed' ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry sending this message" hitSlop={8}>
          <Text className="font-mono" style={{ fontSize: 9, color: '#ff5c8a' }}>
            Not sent · Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  const dim = message.delivery === 'pending' ? 0.6 : 1;

  if (message.offer) {
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', opacity: dim }}>
        <FormalOfferCard offer={message.offer} />
        {meta}
      </View>
    );
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', opacity: dim }}>
      <View
        className="border px-3.5 py-2.5"
        style={[
          { maxWidth: '78%', borderRadius: 16 },
          mine
            ? { ...SURFACE.bubbleMe, borderColor: 'transparent', borderBottomRightRadius: 4 }
            : { backgroundColor: '#0f1524', borderColor: '#1a2032', borderBottomLeftRadius: 4 },
          message.delivery === 'failed' ? { borderColor: 'rgba(255,92,138,.6)' } : null,
        ]}
      >
        <Text style={{ fontSize: 13, lineHeight: 18, color: mine ? '#04121f' : '#e8ecf5', fontWeight: mine ? '600' : '400' }}>
          {message.text}
        </Text>
      </View>
      {meta}
    </View>
  );
}
