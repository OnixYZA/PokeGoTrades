import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { FriendshipLabel } from '@/constants/theme';
import { chats as initialChats } from '@/data/chats';
import { listings as initialListings } from '@/data/listings';
import type { Chat, Listing } from '@/data/types';

interface TradeStoreValue {
  filterLocation: string;
  setFilterLocation: (loc: string) => void;
  friendship: FriendshipLabel;
  setFriendship: (level: FriendshipLabel) => void;
  /** Chat ids whose trade has been locked. Keyed per-chat (not global) per the handoff's own note
   *  that `tradeLocked` belongs on the chat record in production. */
  lockedChatIds: Set<string>;
  lockChat: (chatId: string) => void;
  unlockChat: (chatId: string) => void;
  isChatLocked: (chatId: string) => boolean;
  listings: Listing[];
  addListing: (listing: Listing) => void;
  chats: Chat[];
  addChat: (chat: Chat) => void;
}

const TradeStoreContext = createContext<TradeStoreValue | null>(null);

export function TradeStoreProvider({ children }: { children: React.ReactNode }) {
  const [filterLocation, setFilterLocation] = useState('Adyar');
  const [friendship, setFriendship] = useState<FriendshipLabel>('Great');
  const [lockedChatIds, setLockedChatIds] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [chats, setChats] = useState<Chat[]>(initialChats);

  const lockChat = useCallback((chatId: string) => {
    setLockedChatIds((prev) => new Set(prev).add(chatId));
  }, []);

  const unlockChat = useCallback((chatId: string) => {
    setLockedChatIds((prev) => {
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, []);

  const isChatLocked = useCallback((chatId: string) => lockedChatIds.has(chatId), [lockedChatIds]);

  const addListing = useCallback((listing: Listing) => {
    setListings((prev) => [listing, ...prev]);
  }, []);

  const addChat = useCallback((chat: Chat) => {
    setChats((prev) => [chat, ...prev]);
  }, []);

  const value = useMemo(
    () => ({
      filterLocation,
      setFilterLocation,
      friendship,
      setFriendship,
      lockedChatIds,
      lockChat,
      unlockChat,
      isChatLocked,
      listings,
      addListing,
      chats,
      addChat,
    }),
    [filterLocation, friendship, lockedChatIds, lockChat, unlockChat, isChatLocked, listings, addListing, chats, addChat],
  );

  return <TradeStoreContext.Provider value={value}>{children}</TradeStoreContext.Provider>;
}

export function useTradeStore(): TradeStoreValue {
  const ctx = useContext(TradeStoreContext);
  if (!ctx) throw new Error('useTradeStore must be used within TradeStoreProvider');
  return ctx;
}
