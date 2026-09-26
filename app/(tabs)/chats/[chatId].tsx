import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Handshake } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { ArsenalOfferSheet } from '@/components/chats/ArsenalOfferSheet';
import { ChatActionRow } from '@/components/chats/ChatActionRow';
import { Composer } from '@/components/chats/Composer';
import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { FrozenBanner } from '@/components/chats/FrozenBanner';
import { LockedBanner } from '@/components/chats/LockedBanner';
import { MessageBubble } from '@/components/chats/MessageBubble';
import { HandshakeModal } from '@/components/modals/HandshakeModal';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import type { CreatureRef } from '@/data/types';
import { creatureToOffer } from '@/lib/api/chats';
import { USE_SUPABASE } from '@/lib/data-source';
import { selectTradeView, useTradeStore } from '@/store/trade-store';

/** How a Supabase chat is coming along. The mock has its chats from the first render. */
type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export default function ActiveChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const chat = useTradeStore((s) => (chatId ? s.chats[chatId] : undefined));
  const listing = useTradeStore((s) => (chat ? s.listings[chat.listingId] : undefined));
  const messages = useTradeStore(useShallow((s) => (chatId ? (s.messages[chatId] ?? []) : [])));
  const trade = useTradeStore(useShallow((s) => selectTradeView(s, chatId ?? '')));
  const handshakeRequest = useTradeStore((s) => s.handshakeRequest);
  const clearHandshakeRequest = useTradeStore((s) => s.clearHandshakeRequest);
  const sendMessage = useTradeStore((s) => s.sendMessage);
  const retryMessage = useTradeStore((s) => s.retryMessage);
  const confirmTrade = useTradeStore((s) => s.confirmTrade);
  const loadChat = useTradeStore((s) => s.loadChat);
  const markRead = useTradeStore((s) => s.markRead);
  const subscribeToChat = useTradeStore((s) => s.subscribeToChat);

  const [draft, setDraft] = useState('');
  const [showArsenal, setShowArsenal] = useState(false);
  const [showHandshake, setShowHandshake] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(chat ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);

  // Supabase: load the thread, then follow it live for as long as this screen is focused. The channel is
  // opened only for a chat that is really in my inbox — a refused join on someone else's topic just fails.
  useFocusEffect(
    useCallback(() => {
      if (!USE_SUPABASE || !chatId) return;
      let cancelled = false;
      let unsubscribe: (() => void) | undefined;
      void (async () => {
        const result = await loadChat(chatId);
        if (cancelled) return;
        if (result === 'missing') return setLoadState('missing');
        if (result === 'error' && !useTradeStore.getState().chats[chatId]) return setLoadState('error');
        setLoadState('ready');
        unsubscribe = subscribeToChat(chatId);
        markRead(chatId);
      })();
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }, [chatId, loadChat, subscribeToChat, markRead, attempt]),
  );

  // D1: the seller locked *my* offer, so my Handshake opens by itself (instead of waiting to be tapped).
  useEffect(() => {
    if (handshakeRequest !== null && handshakeRequest === chatId && trade.phase === 'locked') {
      setShowHandshake(true);
      clearHandshakeRequest();
    }
  }, [handshakeRequest, chatId, trade.phase, clearHandshakeRequest]);

  if (!chat || !chatId) {
    if (!USE_SUPABASE) return null;
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
        </View>
        {loadState === 'loading' ? (
          <ActivityIndicator color="#4fb3ff" style={{ marginTop: 48 }} />
        ) : (
          <View className="items-center gap-2 px-6 pt-16">
            <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
              {loadState === 'missing' ? 'This chat is not available' : 'Could not load this chat'}
            </Text>
            <Text className="text-center font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
              {loadState === 'missing'
                ? 'It may have been closed, or it belongs to someone else.'
                : 'Check your connection and try again.'}
            </Text>
            {loadState === 'error' ? (
              <Pressable
                onPress={() => {
                  setLoadState('loading');
                  setAttempt((n) => n + 1);
                }}
                accessibilityRole="button"
                className="mt-2 rounded-xl border border-border-strong px-4 py-2 active:opacity-80"
              >
                <Text className="font-display-semi text-accent-blue" style={{ fontSize: 13 }}>
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    );
  }

  const showLockedBanner = trade.phase === 'locked' || (!trade.live && trade.phase === 'closed');
  // The mock's inactive chats used to read as "locked" in the composer; keep that.
  const composerPhase = !trade.live && trade.phase === 'closed' ? 'locked' : trade.phase;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft(''); // optimistic: the bubble is already in the thread, `pending` until the server confirms
    void sendMessage(chatId, { text });
  };

  const sendFormalOffer = (creature: CreatureRef) => {
    setShowArsenal(false);
    void sendMessage(chatId, {
      offer: { ...creatureToOffer(creature), ...(!USE_SUPABASE && creature.lucky ? { iv: 'Lucky' } : {}) },
    });
  };

  /** Mock only: with Supabase the Handshake confirms (and closes itself) through `get_handshake` / `confirm_trade`. */
  const handleMarkCompleted = async () => {
    await confirmTrade(chatId);
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
        {trade.canOpenHandshake && (
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

      {trade.phase === 'frozen' && <FrozenBanner role={trade.live ? trade.role : 'buyer'} />}
      {showLockedBanner && (
        <LockedBanner
          partner={chat.partner}
          role={trade.live ? trade.role : undefined}
          confirmation={trade.confirmation}
        />
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 18, gap: 8 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id ?? i}
            message={m}
            onRetry={m.clientId ? () => void retryMessage(chatId, m.clientId as string) : undefined}
          />
        ))}
        {/* The mock's placeholder offer card. Real chats show real offers from the thread instead. */}
        {!USE_SUPABASE && !showLockedBanner && trade.phase !== 'frozen' && (
          <View style={{ alignItems: 'flex-start' }}>
            <FormalOfferCard />
          </View>
        )}
      </ScrollView>

      <View
        className="gap-2.5 border-t border-border-subtle px-4 pt-2.5"
        style={{ paddingBottom: insets.bottom }}
      >
        <ChatActionRow
          chatId={chatId}
          partner={chat.partner}
          onOpenHandshake={() => setShowHandshake(true)}
          onBailed={() => router.back()}
        />
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={send}
          phase={composerPhase}
          disabled={!trade.canCompose}
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
        <HandshakeModal
          chatId={USE_SUPABASE ? chatId : undefined}
          onMarkCompleted={() => void handleMarkCompleted()}
          onCompleted={() => {
            setShowHandshake(false);
            router.back();
          }}
          onReturnToChat={() => setShowHandshake(false)}
        />
      </Modal>
    </View>
  );
}
