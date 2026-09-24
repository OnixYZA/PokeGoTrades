import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** Handler per broadcast event name; each receives the event's `payload` (unvalidated: it came off the wire). */
export type BroadcastHandlers = Record<string, (payload: unknown) => void>;

// `removeChannel` is asynchronous and `supabase.channel(topic)` returns the *existing* channel for a
// topic until that removal finishes. A quick unfocus/refocus would otherwise re-attach to a channel
// that is mid-teardown, so a new open for a topic waits for its pending removal first.
const pendingRemovals = new Map<string, Promise<unknown>>();

function removeChannel(topic: string, channel: RealtimeChannel): void {
  const removal = supabase.removeChannel(channel).finally(() => {
    if (pendingRemovals.get(topic) === removal) pendingRemovals.delete(topic);
  });
  pendingRemovals.set(topic, removal);
}

/**
 * Opens a private Broadcast channel (SUPABASE_PLAN.md §4.4), authorized by the `realtime.messages` RLS
 * policy. `onSubscribed` fires on every `SUBSCRIBED`, including the re-subscribe after a dropped
 * connection, which is the caller's cue to refetch whatever it may have missed while offline.
 *
 * Returns a synchronous cleanup that is safe to call at any point, even before the subscription finished.
 *
 * Only open topics the trainer is entitled to (their own `user:` topic, a chat they are in): a refused
 * join is reported as `CHANNEL_ERROR: Unauthorized`, and joining several such topics on one socket
 * disturbed delivery on the socket's other channels when tried against the local stack.
 */
export function openPrivateChannel(topic: string, handlers: BroadcastHandlers, onSubscribed: () => void): () => void {
  let channel: RealtimeChannel | null = null;
  let closed = false;

  void (async () => {
    await pendingRemovals.get(topic);
    if (closed) return;
    // Private channels need the user's JWT on the socket before joining.
    await supabase.realtime.setAuth();
    if (closed) return;

    const created = supabase.channel(topic, { config: { private: true } });
    for (const [event, handler] of Object.entries(handlers)) {
      created.on('broadcast', { event }, (message) => handler(message.payload));
    }
    created.subscribe((status, error) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') {
        onSubscribed();
      } else if (status === 'CHANNEL_ERROR' && error?.message.includes('Unauthorized')) {
        // Not a transient failure: retrying forever would just hammer the server.
        closed = true;
        channel = null;
        removeChannel(topic, created);
      }
    });
    channel = created;
  })();

  return () => {
    closed = true;
    if (channel) removeChannel(topic, channel);
  };
}
