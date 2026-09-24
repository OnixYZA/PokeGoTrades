import type { Page } from '@playwright/test';

/**
 * Knowing when a page has joined a Realtime topic. A test that acts on another device straight away would
 * otherwise race the join, and the app's gap-fill would quietly mask the miss: the assertion would pass
 * through a refetch instead of the live event it is meant to prove.
 *
 * Watches the page's Realtime WebSocket for the server's `phx_reply` "ok" to a join. Attach it before
 * `page.goto`, since the socket opens during load.
 */
export function watchRealtime(page: Page) {
  const joined = new Set<string>();

  page.on('websocket', (socket) => {
    if (!socket.url().includes('/realtime/')) return;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      let frame: unknown;
      try {
        frame = JSON.parse(payload);
      } catch {
        return;
      }
      // Phoenix wire format: v2 is [join_ref, ref, topic, event, payload], v1 the same as an object.
      const [topic, event, body] = Array.isArray(frame)
        ? [frame[2], frame[3], frame[4]]
        : [(frame as { topic?: string }).topic, (frame as { event?: string }).event, (frame as { payload?: unknown }).payload];
      if (event === 'phx_reply' && (body as { status?: string } | undefined)?.status === 'ok' && typeof topic === 'string') {
        joined.add(topic);
      }
    });
  });

  return {
    /** Resolves once `topic` (e.g. `user:<uid>`) is joined; rejects with what *was* joined if it never is. */
    async joined(topic: string, timeoutMs = 20_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ([...joined].some((t) => t === `realtime:${topic}`)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Realtime topic "${topic}" was not joined within ${timeoutMs}ms. Joined: [${[...joined].join(', ')}]`);
    },
  };
}
