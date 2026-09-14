import { router } from 'expo-router';
import { Snowflake } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { PulseDot } from '@/components/ui/PulseDot';
import type { Chat } from '@/data/types';

export function ChatRow({ chat, dimmed }: { chat: Chat; dimmed: boolean }) {
  const frozen = !!chat.isFrozen;
  const showActiveDot = chat.active && !dimmed;

  return (
    <Pressable
      onPress={() => router.push(`/chats/${chat.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${chat.partner}${frozen ? ', frozen — trade pending' : chat.unread ? `, ${chat.unread} unread` : ''}`}
      className="flex-row items-center gap-3 rounded-2xl border p-3 active:opacity-90"
      style={{
        backgroundColor: dimmed ? '#0a0f1c' : '#0f1524',
        borderColor: !dimmed && chat.unread ? 'rgba(79,179,255,.35)' : '#1a2032',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <Avatar name={chat.partner} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
            {chat.partner}
          </Text>
          {showActiveDot && <PulseDot />}
        </View>
        {frozen ? (
          <View className="mt-1 flex-row items-center gap-1">
            <Snowflake size={11} color="#4fb3ff" />
            <Text numberOfLines={1} style={{ fontSize: 11, color: '#4fb3ff' }}>
              Chat Frozen: Trade Pending
            </Text>
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={{ fontSize: 12, marginTop: 2, color: chat.unread ? '#e8ecf5' : '#7d87a0' }}
          >
            {chat.preview}
          </Text>
        )}
      </View>
      {!frozen && chat.unread > 0 && (
        <View
          className="items-center justify-center rounded-full bg-accent-blue px-1.5"
          style={{ minWidth: 20, height: 20, boxShadow: '0 0 10px rgba(79,179,255,.4)' }}
        >
          <Text className="font-display" style={{ fontSize: 11, color: '#04121f' }}>
            {chat.unread}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
