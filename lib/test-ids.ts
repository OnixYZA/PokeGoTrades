/**
 * `testID`s the Playwright suite (`e2e/`) locates things by. React Native Web renders `testID` as
 * `data-testid`, which Playwright's `getByTestId` reads; on native it is just an accessibility identifier.
 *
 * They exist for screens that show a creature's NAME and nothing run-unique. Names are derived from the dex
 * (`lib/format.ts` `creatureDisplayName`), so two listings of one species read identically, and an end-to-end
 * run cannot tell its own listing's chat group from a seeded one by text. An id can.
 *
 * Builders live here, rather than as string literals at both ends, so the component and the spec that finds it
 * cannot drift apart: rename one and the other fails to compile. No imports, for the same reason as
 * `lib/sprite-url.ts`: the e2e project loads this file directly, outside Metro.
 */
export const testIds = {
  /** The Chats tab's block for one listing: its header and every parallel offer on it (`app/(tabs)/chats/index.tsx`).
   *  Present exactly while the trainer has an unarchived chat on that listing. */
  chatGroup: (listingId: string): string => `chat-group-${listingId}`,
} as const;
