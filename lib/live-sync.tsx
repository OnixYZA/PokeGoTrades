import { useEffect } from 'react';
import { AppState } from 'react-native';

import { USE_SUPABASE } from '@/lib/data-source';
import { useSession } from '@/lib/session';
import { useTradeStore } from '@/store/trade-store';

/**
 * Keeps the trade store in step with Supabase for the life of a session (SUPABASE_PLAN.md §4.4):
 * loads the inbox and locks, opens the `user:<uid>` channel, and refetches whatever a backgrounded
 * app's dropped socket may have missed. Renders nothing; mount once inside `SessionProvider`.
 *
 * Keyed on the uid, so the anonymous -> permanent email upgrade (same uid) keeps its channel — supabase-js
 * re-authorizes open channels itself when the access token changes — while a real sign-out tears
 * everything down and drops the previous trainer's chats.
 *
 * Does nothing with the mock data source.
 */
export function LiveSync() {
  const { user } = useSession();
  const userId = user?.id;

  useEffect(() => {
    if (!USE_SUPABASE || !userId) return;
    const store = useTradeStore.getState();
    store.setMe({ id: userId });
    const disconnect = store.connectRealtime(userId);
    void store.hydrate();
    return () => {
      disconnect();
      useTradeStore.getState().reset();
    };
  }, [userId]);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    // Mobile sockets drop silently in the background; catch up when the app comes back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useTradeStore.getState().resync();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
