import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { ChatGroupHeader } from '@/components/chats/ChatGroupHeader';
import { ChatRow } from '@/components/chats/ChatRow';
import type { Chat, ChatRole } from '@/data/types';
import { USE_SUPABASE } from '@/lib/data-source';
import { selectTradeView, useTradeStore } from '@/store/trade-store';

const SECTION_TITLE: Record<ChatRole, string> = {
  seller: 'Offers on your listings',
  buyer: 'Your offers',
};

export default function ChatsInboxScreen() {
  const chatsById = useTradeStore(useShallow((s) => s.chats));
  const listings = useTradeStore(useShallow((s) => s.listings));
  const lockByListing = useTradeStore(useShallow((s) => s.lockByListing));
  const lockConfirmations = useTradeStore(useShallow((s) => s.lockConfirmations));
  const hydrate = useTradeStore((s) => s.hydrate);

  // The inbox is kept live by Realtime; refetching on focus is a cheap backstop for anything missed.
  useFocusEffect(
    useCallback(() => {
      if (USE_SUPABASE) void hydrate();
    }, [hydrate]),
  );

  const grouped = new Map<string, Chat[]>();
  for (const c of Object.values(chatsById)) {
    if (c.archived) continue;
    grouped.set(c.listingId, [...(grouped.get(c.listingId) ?? []), c]);
  }

  const renderGroup = ([listingId, group]: [string, Chat[]]) => {
    const listing = listings[listingId];
    if (!listing) return null;

    const lockedChatId = lockByListing[listingId];
    // Supabase: the listing's own status says it is locked. Mock: a lock holder, or any inactive chat.
    const groupLocked = USE_SUPABASE ? listing.status === 'locked' : !!lockedChatId || !group.every((c) => c.active);

    return (
      <View key={listingId} className="mb-[18px]">
        <ChatGroupHeader listing={listing} offerCount={group.length} locked={groupLocked} />
        <View className="gap-1.5">
          {group.map((chat) => {
            const view = selectTradeView({ chats: chatsById, lockByListing, lockConfirmations }, chat.id);
            return <ChatRow key={chat.id} chat={chat} phase={view.phase} confirmation={view.confirmation} />;
          })}
        </View>
      </View>
    );
  };

  const groups = Array.from(grouped.entries());
  // Supabase chats split by which side the trainer is on; the mock is one flat list, as before.
  const sections: { title: string | null; groups: [string, Chat[]][] }[] = USE_SUPABASE
    ? (['seller', 'buyer'] as const)
        .map((role) => ({ title: SECTION_TITLE[role], groups: groups.filter(([, group]) => group[0]?.myRole === role) }))
        .filter((section) => section.groups.length > 0)
    : [{ title: null, groups }];

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
        {groups.length === 0 && USE_SUPABASE ? (
          <View className="items-center gap-1.5 px-6 pt-16">
            <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
              No chats yet
            </Text>
            <Text className="text-center font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
              Make an offer on a listing, or wait for someone to make one on yours.
            </Text>
          </View>
        ) : null}

        {sections.map((section) => (
          <View key={section.title ?? 'all'}>
            {section.title ? (
              <Text className="mb-1 px-1.5 pt-1 font-mono uppercase text-text-subtle" style={{ fontSize: 10, letterSpacing: 1.1 }}>
                {section.title}
              </Text>
            ) : null}
            {section.groups.map(renderGroup)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
