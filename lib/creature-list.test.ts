/**
 * Unit tests for the pure rules behind removing an Arsenal / Wishlist entry (`lib/creature-list.ts`):
 * identity by row id (duplicates are legal), the optimistic mask, and the races that motivated keeping it
 * a mask instead of an edit of the list — a refresh landing mid-delete, two removals at once, a rollback
 * after the list has changed underneath it.
 */
import { describe, expect, it } from 'vitest';

import {
  creatureListsReducer,
  EMPTY_CREATURE_LISTS,
  toReadOnlyEntries,
  visibleEntries,
  type CreatureListsAction,
  type CreatureListsState,
  type TrainerCreature,
} from './creature-list';

const entry = (id: string, pokemonId = 1, shiny = false): TrainerCreature => ({
  id,
  creature: { name: `Mon${pokemonId}`, pokemonId, hue: 100, ...(shiny ? { shiny } : {}) },
});

const run = (state: CreatureListsState, ...actions: CreatureListsAction[]): CreatureListsState =>
  actions.reduce(creatureListsReducer, state);

const ids = (entries: readonly TrainerCreature[]) => entries.map((e) => e.id);

/** Arsenal [a, b, c, d] and Wishlist [w1, w2], as a fresh read would deliver them. */
const loaded = (): CreatureListsState =>
  run(EMPTY_CREATURE_LISTS, {
    type: 'loaded',
    arsenal: [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)],
    wishlist: [entry('w1', 5), entry('w2', 6)],
  });

const shownArsenal = (s: CreatureListsState) => ids(visibleEntries(s.arsenal, s.removed));
const shownWishlist = (s: CreatureListsState) => ids(visibleEntries(s.wishlist, s.removed));

describe('toReadOnlyEntries', () => {
  it('gives every creature its own id, even identical ones, so the grid can key them', () => {
    const twin = { name: 'Mew', pokemonId: 151, hue: 320 };
    const wrapped = toReadOnlyEntries([twin, twin, { name: 'Mewtwo', pokemonId: 150, hue: 275 }]);
    expect(new Set(ids(wrapped)).size).toBe(3);
    expect(wrapped.map((w) => w.creature.name)).toEqual(['Mew', 'Mew', 'Mewtwo']);
  });

  it('is empty for an empty list', () => {
    expect(toReadOnlyEntries([])).toEqual([]);
  });
});

describe('visibleEntries', () => {
  it('keeps the server order and drops only the removed ids', () => {
    const list = [entry('a'), entry('b'), entry('c')];
    expect(ids(visibleEntries(list, new Set(['b'])))).toEqual(['a', 'c']);
    expect(ids(visibleEntries(list, new Set()))).toEqual(['a', 'b', 'c']);
  });
});

describe('creatureListsReducer — loaded', () => {
  it('replaces both lists and starts with nothing masked', () => {
    const state = loaded();
    expect(ids(state.arsenal)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(state.wishlist)).toEqual(['w1', 'w2']);
    expect(state.removed.size).toBe(0);
  });
});

describe('creatureListsReducer — removal', () => {
  it('hides only the entry with that id, not its twin (duplicates are legal)', () => {
    // Two Shiny Mews in the same Arsenal: same species, same flags, different rows.
    const twins = run(EMPTY_CREATURE_LISTS, {
      type: 'loaded',
      arsenal: [entry('first-mew', 151, true), entry('x', 25), entry('second-mew', 151, true)],
      wishlist: [],
    });
    const after = run(twins, { type: 'removalStarted', id: 'second-mew' });
    expect(shownArsenal(after)).toEqual(['first-mew', 'x']);
  });

  it('works for a Wishlist entry and leaves the Arsenal alone', () => {
    const after = run(loaded(), { type: 'removalStarted', id: 'w1' });
    expect(shownWishlist(after)).toEqual(['w2']);
    expect(shownArsenal(after)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores an id it does not hold, returning the same state', () => {
    const state = loaded();
    expect(creatureListsReducer(state, { type: 'removalStarted', id: 'nope' })).toBe(state);
  });

  it('ignores a second start for the same id, returning the same state', () => {
    const once = run(loaded(), { type: 'removalStarted', id: 'b' });
    expect(creatureListsReducer(once, { type: 'removalStarted', id: 'b' })).toBe(once);
  });

  it('puts a failed removal back in its original position', () => {
    const failed = run(loaded(), { type: 'removalStarted', id: 'c' }, { type: 'removalFailed', id: 'c' });
    expect(shownArsenal(failed)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the previous state', () => {
    const before = loaded();
    const during = creatureListsReducer(before, { type: 'removalStarted', id: 'a' });
    creatureListsReducer(during, { type: 'removalFailed', id: 'a' });
    expect(before.removed.size).toBe(0);
    expect(during.removed.has('a')).toBe(true);
  });

  it('treats a failure for an id that is not masked as a no-op', () => {
    const state = loaded();
    expect(creatureListsReducer(state, { type: 'removalFailed', id: 'a' })).toBe(state);
  });
});

describe('creatureListsReducer — races', () => {
  it('two quick removals: one failing brings back only that one, never the other', () => {
    const both = run(loaded(), { type: 'removalStarted', id: 'a' }, { type: 'removalStarted', id: 'c' });
    expect(shownArsenal(both)).toEqual(['b', 'd']);

    // 'a' fails; 'c' has (or will have) succeeded and must stay gone.
    const aFailed = run(both, { type: 'removalFailed', id: 'a' });
    expect(shownArsenal(aFailed)).toEqual(['a', 'b', 'd']);
  });

  it('the earlier removal failing after the later one succeeded does not undo the later one', () => {
    // The order the responses arrive in is the reverse of the order the removals started in.
    const state = run(
      loaded(),
      { type: 'removalStarted', id: 'b' },
      { type: 'removalStarted', id: 'd' },
      { type: 'removalFailed', id: 'b' },
    );
    expect(shownArsenal(state)).toEqual(['a', 'b', 'c']);
  });

  it('a refresh landing mid-delete (still listing the row) keeps it hidden', () => {
    const mid = run(loaded(), { type: 'removalStarted', id: 'b' });
    // The read was issued before the delete committed, so it still contains 'b'.
    const refreshed = run(mid, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(shownArsenal(refreshed)).toEqual(['a', 'c', 'd']);
  });

  it('rollback after such a refresh restores the entry at its place in the NEW list', () => {
    const mid = run(loaded(), { type: 'removalStarted', id: 'b' });
    // The refresh also delivers an entry added elsewhere, slotted in before 'b' by sort_order, and drops 'd'.
    const refreshed = run(mid, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('new', 9), entry('b', 2), entry('c', 3)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(shownArsenal(refreshed)).toEqual(['a', 'new', 'c']);

    const failed = run(refreshed, { type: 'removalFailed', id: 'b' });
    expect(shownArsenal(failed)).toEqual(['a', 'new', 'b', 'c']);
  });

  it('a refresh that no longer lists the row clears its mask, and a late failure cannot resurrect it', () => {
    const mid = run(loaded(), { type: 'removalStarted', id: 'b' });
    // Read after the delete committed (or the row was deleted elsewhere): 'b' is simply absent.
    const refreshed = run(mid, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('c', 3), entry('d', 4)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(refreshed.removed.size).toBe(0);

    // The delete's own response then reports failure (e.g. the reply was lost after it committed).
    const lateFailure = run(refreshed, { type: 'removalFailed', id: 'b' });
    expect(shownArsenal(lateFailure)).toEqual(['a', 'c', 'd']);
  });

  it('a stale read arriving after a SUCCESSFUL delete cannot bring the entry back', () => {
    const afterDelete = run(loaded(), { type: 'removalStarted', id: 'b' });
    // No `removalFailed`: the delete succeeded, so the mask stays until a read confirms the row is gone.
    const staleRead = run(afterDelete, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(shownArsenal(staleRead)).toEqual(['a', 'c', 'd']);

    // The next, fresh read confirms it and the mask is released.
    const freshRead = run(staleRead, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('c', 3), entry('d', 4)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(freshRead.removed.size).toBe(0);
    expect(shownArsenal(freshRead)).toEqual(['a', 'c', 'd']);
  });

  it('keeps masks for several rows across a refresh, pruning only the ones the read no longer lists', () => {
    const mid = run(loaded(), { type: 'removalStarted', id: 'a' }, { type: 'removalStarted', id: 'w1' });
    const refreshed = run(mid, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)], // still lists 'a'
      wishlist: [entry('w2', 6)], // 'w1' is gone
    });
    expect([...refreshed.removed]).toEqual(['a']);
    expect(shownArsenal(refreshed)).toEqual(['b', 'c', 'd']);
    expect(shownWishlist(refreshed)).toEqual(['w2']);
  });

  it('freeing a slot and adding again: the re-added creature is a new row, shown in server order', () => {
    // 'c' (slot 2) removed and confirmed gone; the next add takes the lowest free slot — slot 2 — and
    // the following read returns it there, under a fresh id.
    const removed = run(loaded(), { type: 'removalStarted', id: 'c' });
    const readAfterAdd = run(removed, {
      type: 'loaded',
      arsenal: [entry('a', 1), entry('b', 2), entry('c-readded', 3), entry('d', 4)],
      wishlist: [entry('w1', 5), entry('w2', 6)],
    });
    expect(readAfterAdd.removed.size).toBe(0);
    expect(shownArsenal(readAfterAdd)).toEqual(['a', 'b', 'c-readded', 'd']);
  });
});

describe('creatureListsReducer — reset', () => {
  it('clears both lists and every mask', () => {
    const state = run(loaded(), { type: 'removalStarted', id: 'a' }, { type: 'reset' });
    expect(state).toBe(EMPTY_CREATURE_LISTS);
    expect(state.removed.size).toBe(0);
  });

  it('a removal that fails after a reset cannot put anything back', () => {
    const state = run(loaded(), { type: 'removalStarted', id: 'a' }, { type: 'reset' }, { type: 'removalFailed', id: 'a' });
    expect(shownArsenal(state)).toEqual([]);
  });
});
