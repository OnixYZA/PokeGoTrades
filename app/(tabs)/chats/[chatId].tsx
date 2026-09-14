import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Handshake } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { ArsenalOfferSheet } from '@/components/chats/ArsenalOfferSheet';
import { ChatActionRow } from '@/components/chats/ChatActionRow';
import { Composer } from '@/components/chats/Composer';
import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { FrozenBanner } from '@/components/chats/FrozenBanner';
import { LockedBanner } from '@/components/chats/LockedBanner';
import { MessageBubble } from '@/components/chats/MessageBubble';
import type { BailReason } from '@/components/modals/BailBlockModal';
import { HandshakeModal } from '@/components/modals/HandshakeModal';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import type { CreatureRef } from '@/data/types';
import { selectChatPhase, useTradeStore } from '@/store/trade-store';

export default function ActiveChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const insets = useSafeAreaInsets();

  const chat = useTradeStore((s) => (chatId ? s.chats[chatId] : undefined));
  const listing = useTradeStore((s) => (chat ? s.listings[chat.listingId] : undefined));
  const messages = useTradeStore(useShallow((s) => (chatId ? (s.messages[chatId] ?? []) : [])));
  const phase = useTradeStore((s) => selectChatPhase(s, chatId ?? ''));
  const lockChat = useTradeStore((s) => s.lockChat);
  const unlockChat = useTradeStore((s) => s.unlockChat);
  const removeChat = useTradeStore((s) => s.removeChat);
  const archiveChat = useTradeStore((s) => s.archiveChat);
  const removeListing = useTradeStore((s) => s.removeListing);
  const sendMessageToStore = useTradeStore((s) => s.sendMessage);

  const [draft, setDraft] = useState('');
  const [showArsenal, setShowArsenal] = useState(false);
  const [showHandshake, setShowHandshake] = useState(false);

  if (!chat || !chatId) return null;

  const isLocked = phase === 'locked';
  const locked = phase === 'locked' || phase === 'closed';
  const frozen = phase === 'frozen';

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    sendMessageToStore(chatId, { role: 'me', text, time });
    setDraft('');
  };

  const sendFormalOffer = (creature: CreatureRef) => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    sendMessageToStore(chatId, {
      role: 'me',
      text: '',
      time,
      offer: { name: creature.name, pokemonId: creature.pokemonId, hue: creature.hue, iv: creature.lucky ? 'Lucky' : undefined },
    });
    setShowArsenal(false);
  };

  const handleBail = (_reason: BailReason, _note?: string) => {
    removeChat(chat.id);
    router.back();
  };

  const handleMarkCompleted = () => {
    archiveChat(chat.id);
    if (listing) removeListing(listing.id);
    setShowHandshake(false);
    router.back();
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
        {isLocked && (
          <IconButton
            size={34}
            radius={12}
            accessibilityLabel="Re-open handshake and friend codes"
            onPress={() => setShowHandshake(true)}
          >
            <Handshake size={16} color="#f5c518" />
          </IconButton>
        )}
      </View>

      {frozen && <FrozenBanner />}
      {!frozen && locked && <LockedBanner partner={chat.partner} />}

      <ScrollView contentContainerStyle={{ padding: 18, gap: 8 }} showsVerticalScrollIndicator={false}>
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {!locked && !frozen && (
          <View style={{ alignItems: 'flex-start' }}>
            <FormalOfferCard />
          </View>
        )}
      </ScrollView>

      <View
        className="gap-2.5 border-t border-border-subtle px-4 pt-2.5"
        style={{ paddingBottom: Math.max(insets.bottom, 20) }}
      >
        <ChatActionRow
          locked={locked}
          onBail={handleBail}
          onLock={() => lockChat(chat.id)}
          onUnlockRequest={() => unlockChat(chat.id)}
          onOpenHandshake={() => setShowHandshake(true)}
        />
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={sendMessage}
          locked={locked}
          frozen={frozen}
          onOpenArsenal={() => setShowArsenal(true)}
        />
      </View>

      <Modal visible={showArsenal} transparent animationType="slide" onRequestClose={() => setShowArsenal(false)}>
        <ArsenalOfferSheet onSelect={sendFormalOffer} onCancel={() => setShowArsenal(false)} />
      </Modal>

      <Modal
        visible={showHandshake}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHandshake(false)}
        statusBarTranslucent
      >
        <HandshakeModal onMarkCompleted={handleMarkCompleted} onReturnToChat={() => setShowHandshake(false)} />
      </Modal>
    </View>
  );
}
