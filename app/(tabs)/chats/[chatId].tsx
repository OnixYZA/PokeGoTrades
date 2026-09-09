import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatActionRow } from '@/components/chats/ChatActionRow';
import { Composer } from '@/components/chats/Composer';
import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { LockedBanner } from '@/components/chats/LockedBanner';
import { MessageBubble } from '@/components/chats/MessageBubble';
import { Avatar } from '@/components/ui/Avatar';
import { chats, fallbackOffers } from '@/data/chats';
import { listings } from '@/data/listings';
import type { ChatMessage } from '@/data/types';
import { useTradeStore } from '@/store/trade-store';

export default function ActiveChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const insets = useSafeAreaInsets();
  const { isChatLocked, lockChat, unlockChat } = useTradeStore();

  const chat = chats.find((c) => c.id === chatId);
  const listing = chat ? listings.find((l) => l.id === chat.listingId) : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    chat && chat.offers.length ? chat.offers : fallbackOffers(listing?.name ?? ''),
  );
  const [draft, setDraft] = useState('');

  if (!chat) return null;

  const locked = isChatLocked(chat.id) || !chat.active;

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setMessages((prev) => [...prev, { role: 'me', text, time }]);
    setDraft('');
  };

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-2.5 border-b border-border-subtle px-4 pb-3.5 pt-1.5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          hitSlop={6}
          className="h-8 w-8 items-center justify-center active:opacity-70"
        >
          <ChevronLeft size={20} color="#8b93a7" />
        </Pressable>
        <Avatar name={chat.partner} size={38} fontSize={14} />
        <View className="min-w-0 flex-1">
          <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
            {chat.partner}
          </Text>
          <Text className="font-mono text-text-subtle" style={{ fontSize: 10, letterSpacing: 0.6 }}>
            RE: {listing?.name ?? ''}
          </Text>
        </View>
      </View>

      {locked && <LockedBanner partner={chat.partner} />}

      <ScrollView contentContainerStyle={{ padding: 18, gap: 8 }} showsVerticalScrollIndicator={false}>
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {!locked && <FormalOfferCard />}
      </ScrollView>

      <View
        className="gap-2.5 border-t border-border-subtle px-4 pt-2.5"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Composer value={draft} onChangeText={setDraft} onSend={sendMessage} locked={locked} />
        <ChatActionRow
          locked={locked}
          onBail={() => {
            unlockChat(chat.id);
            router.back();
          }}
          onLock={() => lockChat(chat.id)}
          onUnlockRequest={() => unlockChat(chat.id)}
        />
      </View>
    </View>
  );
}
