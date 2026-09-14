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
  /** Locks this chat's trade and freezes every other chat competing for the same listing. */
  lockChat: (chatId: string) => void;
  /** Unlocks this chat's trade and thaws its sibling chats so they can compete again. */
  unlockChat: (chatId: string) => void;
  isChatLocked: (chatId: string) => boolean;
  listings: Listing[];
  /** Appends a fully-formed listing — including its `screenshots` (multi-image proof) and
   *  `tags` picked during creation — to the feed. */
  addListing: (listing: Listing) => void;
  /** Removes a listing entirely — used once its trade is marked completed. */
  removeListing: (listingId: string) => void;
  chats: Chat[];
  addChat: (chat: Chat) => void;
  /** Bail & Block: drops the chat from the store outright and thaws its siblings. */
  removeChat: (chatId: string) => void;
  /** Trade Completed: hides the chat from the active inbox instead of deleting it. */
  archiveChat: (chatId: string) => void;
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
    setChats((prev) => {
      const target = prev.find((c) => c.id === chatId);
      if (!target) return prev;
      return prev.map((c) => (c.listingId === target.listingId && c.id !== chatId ? { ...c, isFrozen: true } : c));
    });
  }, []);

  const unlockChat = useCallback((chatId: string) => {
    setLockedChatIds((prev) => {
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
    setChats((prev) => {
      const target = prev.find((c) => c.id === chatId);
      if (!target) return prev;
      return prev.map((c) => (c.listingId === target.listingId && c.id !== chatId ? { ...c, isFrozen: false } : c));
    });
  }, []);

  const isChatLocked = useCallback((chatId: string) => lockedChatIds.has(chatId), [lockedChatIds]);

  const addListing = useCallback((listing: Listing) => {
    setListings((prev) => [listing, ...prev]);
  }, []);

  const removeListing = useCallback((listingId: string) => {
    setListings((prev) => prev.filter((l) => l.id !== listingId));
  }, []);

  const addChat = useCallback((chat: Chat) => {
    setChats((prev) => [chat, ...prev]);
  }, []);

  const removeChat = useCallback((chatId: string) => {
    setChats((prev) => {
      const target = prev.find((c) => c.id === chatId);
      const withoutTarget = prev.filter((c) => c.id !== chatId);
      if (!target) return withoutTarget;
      return withoutTarget.map((c) => (c.listingId === target.listingId ? { ...c, isFrozen: false } : c));
    });
    setLockedChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, []);

  const archiveChat = useCallback((chatId: string) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, archived: true } : c)));
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
      removeListing,
      chats,
      addChat,
      removeChat,
      archiveChat,
    }),
    [
      filterLocation,
      friendship,
      lockedChatIds,
      lockChat,
      unlockChat,
      isChatLocked,
      listings,
      addListing,
      removeListing,
      chats,
      addChat,
      removeChat,
      archiveChat,
    ],
  );

  return <TradeStoreContext.Provider value={value}>{children}</TradeStoreContext.Provider>;
}

export function useTradeStore(): TradeStoreValue {
  const ctx = useContext(TradeStoreContext);
  if (!ctx) throw new Error('useTradeStore must be used within TradeStoreProvider');
  return ctx;
}
