import { ScrollView, Text, View } from 'react-native';

import { ChatGroupHeader } from '@/components/chats/ChatGroupHeader';
import { ChatRow } from '@/components/chats/ChatRow';
import { chats } from '@/data/chats';
import { listings } from '@/data/listings';
import { useTradeStore } from '@/store/trade-store';

export default function ChatsInboxScreen() {
  const { isChatLocked } = useTradeStore();

  const grouped = new Map<string, typeof chats>();
  for (const c of chats) {
    grouped.set(c.listingId, [...(grouped.get(c.listingId) ?? []), c]);
  }

  return (
    <View className="flex-1">
      <View className="px-[22px] pb-3.5 pt-2">
        <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 11, letterSpacing: 1.1 }}>
          Parallel Offers
        </Text>
        <Text className="mt-0.5 font-display text-text-primary" style={{ fontSize: 26, letterSpacing: -0.52 }}>
          Your Chats
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {Array.from(grouped.entries()).map(([listingId, group]) => {
          const listing = listings.find((l) => l.id === listingId);
          if (!listing) return null;

          const lockedChatId = group.find((c) => isChatLocked(c.id))?.id;
          const groupLocked = !!lockedChatId || !group.every((c) => c.active);

          return (
            <View key={listingId} className="mb-[18px]">
              <ChatGroupHeader listing={listing} offerCount={group.length} locked={groupLocked} />
              <View className="gap-1.5">
                {group.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    dimmed={lockedChatId ? chat.id !== lockedChatId : !chat.active}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
