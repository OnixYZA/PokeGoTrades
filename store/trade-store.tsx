import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { FriendshipLabel } from '@/constants/theme';

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
}

const TradeStoreContext = createContext<TradeStoreValue | null>(null);

export function TradeStoreProvider({ children }: { children: React.ReactNode }) {
  const [filterLocation, setFilterLocation] = useState('Adyar');
  const [friendship, setFriendship] = useState<FriendshipLabel>('Great');
  const [lockedChatIds, setLockedChatIds] = useState<Set<string>>(new Set());

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
    }),
    [filterLocation, friendship, lockedChatIds, lockChat, unlockChat, isChatLocked],
  );

  return <TradeStoreContext.Provider value={value}>{children}</TradeStoreContext.Provider>;
}

export function useTradeStore(): TradeStoreValue {
  const ctx = useContext(TradeStoreContext);
  if (!ctx) throw new Error('useTradeStore must be used within TradeStoreProvider');
  return ctx;
}
