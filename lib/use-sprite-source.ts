import { useCallback, useMemo, useState } from 'react';

import { spriteCandidates, spriteVariantKey, type SpriteVariant } from './sprite-url';

/** How long a known-404 stays in the negative cache before a fresh attempt is allowed again — long
 *  enough that a feed/grid full of the same un-mirrored variant doesn't hammer Storage with repeat
 *  404s, short enough that a sprite mirrored moments ago is picked up without an app restart. */
const NEGATIVE_CACHE_TTL_MS = 5 * 60_000;

/** Module-level (not per-hook-instance), so every `Sprite` / `Chip` / `CreatureTile` on screen shares
 *  one memory of "this URL already 404'd" — a feed of fifty rows for the same un-mirrored variant
 *  should cost one failed request, not fifty. */
const negativeCache = new Map<string, number>();

function isDead(url: string): boolean {
  const failedAt = negativeCache.get(url);
  if (failedAt === undefined) return false;
  if (Date.now() - failedAt > NEGATIVE_CACHE_TTL_MS) {
    negativeCache.delete(url); // expired: worth a fresh try, and no reason to keep the entry around
    return false;
  }
  return true;
}

/** First index at or after `from` whose candidate isn't a known-recent 404 — `candidates.length`
 *  (i.e. "exhausted") if every remaining one is dead. */
function firstLiveIndex(candidates: readonly string[], from: number): number {
  let i = from;
  while (i < candidates.length && isDead(candidates[i])) i++;
  return i;
}

export interface SpriteSource {
  /** The candidate to hand `expo-image` right now, or `null` once every candidate has failed. */
  uri: string | null;
  /** Whether `uri` has actually finished loading — false while in flight or not yet attempted. */
  loaded: boolean;
  /** True once every candidate for this variant has failed. Callers show the initial-letter
   *  placeholder at full opacity instead of a perpetually-loading tile. */
  exhausted: boolean;
  onLoad: () => void;
  onError: () => void;
}

interface State {
  key: string;
  index: number;
  loaded: boolean;
}

/**
 * Walks `spriteCandidates(variant)` (`lib/sprite-url.ts`) from most to least specific, advancing past
 * a candidate on `onError` until one loads or the list runs out. Candidates are recomputed only when
 * `variant`'s actual fields change (see `spriteVariantKey`, not object identity), and the walk restarts
 * from the top whenever that key changes — so switching which Pokémon a tile shows never gets stuck
 * mid-fallback for the previous one.
 */
export function useSpriteSource(variant: SpriteVariant): SpriteSource {
  const key = spriteVariantKey(variant);
  const candidates = useMemo(() => spriteCandidates(variant), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [state, setState] = useState<State>(() => ({ key, index: firstLiveIndex(candidates, 0), loaded: false }));

  // React's documented pattern for resetting state when a prop changes: detected and applied inline
  // during render (which bails out and re-renders immediately, before anything commits) rather than
  // via an effect, which would paint one frame of the previous variant's (now-wrong) `uri` first.
  if (state.key !== key) {
    setState({ key, index: firstLiveIndex(candidates, 0), loaded: false });
  }

  const current = state.key === key ? state : { key, index: firstLiveIndex(candidates, 0), loaded: false };
  const uri = current.index < candidates.length ? candidates[current.index] : null;
  const exhausted = uri === null;

  const onLoad = useCallback(() => {
    setState((s) => (s.key === key ? { ...s, loaded: true } : s));
  }, [key]);

  const onError = useCallback(() => {
    setState((s) => {
      if (s.key !== key) return s;
      const failed = candidates[s.index];
      if (failed) negativeCache.set(failed, Date.now());
      return { key, index: firstLiveIndex(candidates, s.index + 1), loaded: false };
    });
  }, [key, candidates]);

  return { uri, loaded: current.loaded, exhausted, onLoad, onError };
}
