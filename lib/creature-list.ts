/**
 * The signed-in trainer's Arsenal / Wishlist as the profile screen holds them: entries that carry the
 * identity of their database row, plus the pure rules for removing one optimistically.
 *
 * Lives apart from `lib/api/profile.ts` and `app/(tabs)/profile.tsx` on purpose, the same way
 * `store/lock-state.ts` lives apart from the store: those modules reach `expo-crypto`, `react-native` and
 * a Supabase client that throws at import time without env vars, so nothing inside them can be exercised
 * directly. Type-only, RELATIVE imports only (no `@/` alias) — loaded straight by vitest, the constraint
 * `lib/api/creature-ref.ts`'s header comment explains.
 */
import type { CreatureRef } from '../data/types';

/**
 * One row of `trainer_creatures`: the creature AND the identity of the row holding it.
 *
 * The row `id` is the only thing that can address one entry. A trainer may legally hold the same species
 * twice (the table's unique key is the *slot*, `(owner_id, list, sort_order)`, not the creature), so
 * anything keyed on name / `pokemonId` / a `CreatureRef` look-alike would remove the wrong twin — or both.
 * `fetchMyCreatures` used to select only `creature` and throw the id away, which is what made an entry
 * impossible to delete; the id now travels with the value so there is nothing to look up later.
 */
export interface TrainerCreature {
  id: string;
  creature: CreatureRef;
}

/**
 * Wraps creatures that have no database row — the mock trainer, a public profile's seeded lists — so one
 * grid renders every source. The ids are positional placeholders that exist only to give React a unique
 * key; they match no row, which is safe because a grid only offers removal when it is handed an
 * `onRemove`, and only the signed-in trainer's own live profile ever passes one.
 */
export function toReadOnlyEntries(creatures: readonly CreatureRef[]): TrainerCreature[] {
  return creatures.map((creature, index) => ({ id: `read-only-${index}`, creature }));
}

/**
 * Both lists plus the set of rows the trainer has removed here.
 *
 * Removal is a *mask over the server's lists*, not an edit of them. Deleting an entry from the array and
 * putting it back on failure would mean remembering a snapshot (or an index) and replaying it later —
 * and by then a refresh may have replaced the array, or another removal may have shifted it, so the
 * replay can resurrect something a different request already deleted. With a mask there is nothing to
 * replay: the entry never left the list, so "putting it back" is just un-masking its id, and it lands in
 * whatever position the server's current `sort_order` gives it. Rollback is therefore by id, can't touch
 * any other entry, and can't restore a stale list.
 */
export interface CreatureListsState {
  arsenal: readonly TrainerCreature[];
  wishlist: readonly TrainerCreature[];
  /** Ids of rows removed locally: still in flight, or confirmed gone. Always a subset of the ids in
   *  `arsenal` and `wishlist` (see `creatureListsReducer`). */
  removed: ReadonlySet<string>;
}

export const EMPTY_CREATURE_LISTS: CreatureListsState = { arsenal: [], wishlist: [], removed: new Set() };

export type CreatureListsAction =
  /** A fresh read of both lists (the initial load, a refresh after an add, a tab refocus). */
  | { type: 'loaded'; arsenal: readonly TrainerCreature[]; wishlist: readonly TrainerCreature[] }
  /** The trainer removed this entry: hide it now, before the delete reaches the server. */
  | { type: 'removalStarted'; id: string }
  /** The delete failed: show the entry again. */
  | { type: 'removalFailed'; id: string }
  /** The signed-in trainer changed (or signed out): nothing here belongs to the new one. */
  | { type: 'reset' };

export function creatureListsReducer(state: CreatureListsState, action: CreatureListsAction): CreatureListsState {
  switch (action.type) {
    case 'loaded': {
      // A confirmed-deleted row is absent from every read taken after the delete, so its mask has done
      // its job — drop it, or `removed` would grow for the life of the screen. An id that is merely
      // missing from this read is safe to drop either way: row ids are never reused (a re-added creature
      // gets a fresh uuid), so nothing can later bring that id back for the mask to hide.
      //
      // The converse is the point of keeping the others: a read that was already in flight when the
      // delete committed can still list the row, and without its mask that stale read would put a deleted
      // entry back on screen.
      const present = new Set<string>();
      for (const entry of action.arsenal) present.add(entry.id);
      for (const entry of action.wishlist) present.add(entry.id);
      const removed = new Set<string>();
      for (const id of state.removed) if (present.has(id)) removed.add(id);
      return { arsenal: action.arsenal, wishlist: action.wishlist, removed };
    }
    case 'removalStarted': {
      if (state.removed.has(action.id)) return state;
      // Only an entry we actually hold can be masked, which is what keeps `removed` ⊆ present ids.
      const held = [...state.arsenal, ...state.wishlist].some((entry) => entry.id === action.id);
      if (!held) return state;
      return { ...state, removed: new Set(state.removed).add(action.id) };
    }
    case 'removalFailed': {
      // Un-masking an id that is no longer held (a newer read already showed it gone) is a no-op, never
      // a resurrection: the entry reappears only if the server's current list still contains it.
      if (!state.removed.has(action.id)) return state;
      const removed = new Set(state.removed);
      removed.delete(action.id);
      return { ...state, removed };
    }
    case 'reset':
      return EMPTY_CREATURE_LISTS;
  }
}

/** What a grid shows: the server's order, minus every entry the trainer has removed here. */
export function visibleEntries(entries: readonly TrainerCreature[], removed: ReadonlySet<string>): TrainerCreature[] {
  return entries.filter((entry) => !removed.has(entry.id));
}
