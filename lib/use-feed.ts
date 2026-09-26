import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { marketSignalKey, type MarketSignal } from '@/constants/market';
import { MOCK_MARKET_SIGNALS } from '@/data/market';
import type { Listing } from '@/data/types';
import { fetchFeedListings, listingErrorMessage } from '@/lib/api/listings';
import { fetchMarketDemand } from '@/lib/api/market';
import { USE_SUPABASE } from '@/lib/data-source';
import { useSession } from '@/lib/session';
import { compileFilter, filterKey, matchesFilter } from '@/store/listing-filters';
import { useTradeStore } from '@/store/trade-store';

export interface Feed {
  listings: Listing[];
  /** True while a fetch is in flight, including a pull-to-refresh. */
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const noopRefresh = async () => {};

/** Debounce for a Supabase refetch triggered purely by a filter-chip change (not loc, not focus). */
const FILTER_REFETCH_DEBOUNCE_MS = 250;

/** `data/market.ts`'s fixtures, built into a Map once — same shape `fetchMarketDemand` returns. */
const MOCK_MARKET_MAP = new Map<string, MarketSignal>(Object.entries(MOCK_MARKET_SIGNALS));

/** Attaches each listing's market signal from a pre-fetched map, keyed by (pokemonId, shiny). A
 *  listing with no entry (never fetched, or the fetch failed) simply keeps `market` undefined. */
function withMarketSignals(listings: Listing[], signals: Map<string, MarketSignal>): Listing[] {
  return listings.map((listing) => ({ ...listing, market: signals.get(marketSignalKey(listing.pokemonId, listing.shiny)) }));
}

/** The pre-Supabase feed: the seeded store, filtered to one area plus the tristate attribute
 *  filters, sorted by the mock distance, with a canned market signal attached. */
function useMockFeed(loc: string): Feed {
  const all = useTradeStore(useShallow((s) => Object.values(s.listings)));
  const filters = useTradeStore((s) => s.listingFilters);
  const listings = useMemo(() => {
    const spec = compileFilter(filters);
    const matched = all
      .filter((l) => l.loc === loc && matchesFilter(l, spec))
      .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
    return withMarketSignals(matched, MOCK_MARKET_MAP);
  }, [all, loc, filters]);
  return { listings, isLoading: false, error: null, refresh: noopRefresh };
}

/**
 * Open and locked listings for one area, newest first, narrowed by the compiled attribute filter.
 * Refetches on mount, when the area changes, whenever the feed regains focus (after onboarding, or
 * after posting), and — separately and debounced — whenever the filter changes. Results are merged
 * into the store so the detail sheet can resolve them by id, and each result set gets one market
 * fetch attached; a market failure never fails the feed itself.
 */
function useSupabaseFeed(loc: string): Feed {
  const { user, retry: retrySession } = useSession();
  const userId = user?.id;
  const upsertListings = useTradeStore((s) => s.upsertListings);
  const filters = useTradeStore((s) => s.listingFilters);

  const spec = useMemo(() => compileFilter(filters), [filters]);
  const fKey = useMemo(() => filterKey(spec), [spec]);
  // `load` (below) must not change identity when only the filter changes — see the debounce effect —
  // so it reads the current spec/key through refs instead of closing over them directly.
  const specRef = useRef(spec);
  const fKeyRef = useRef(fKey);
  specRef.current = spec;
  fKeyRef.current = fKey;

  const [loaded, setLoaded] = useState<{ loc: string; filterKey: string; listings: Listing[] }>({
    loc,
    filterKey: fKey,
    listings: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    const requestFilterKey = fKeyRef.current;
    setIsLoading(true);
    try {
      const listings = await fetchFeedListings(loc, specRef.current);
      if (request !== latestRequest.current) return; // a newer area / filter / refresh superseded this one

      let withMarket = listings;
      try {
        const signals = await fetchMarketDemand(listings.map((l) => l.pokemonId));
        if (request !== latestRequest.current) return;
        withMarket = withMarketSignals(listings, signals);
      } catch (marketError) {
        // The feed itself must never fail because the market signal couldn't be fetched — every
        // listing simply keeps `market: undefined`, same as a pair `pokemon_market_demand` has no row for.
        console.warn('[use-feed] market fetch failed', marketError);
      }

      setLoaded({ loc, filterKey: requestFilterKey, listings: withMarket });
      upsertListings(withMarket);
      setError(null);
    } catch (reason) {
      if (request !== latestRequest.current) return;
      // Settle `loaded` on this (loc, filter) too, so the stale check below stops reporting "loading"
      // and the error can render instead of a spinner that never ends.
      setLoaded({ loc, filterKey: requestFilterKey, listings: [] });
      setError(listingErrorMessage(reason));
    } finally {
      if (request === latestRequest.current) setIsLoading(false);
    }
  }, [loc, upsertListings]);

  useFocusEffect(
    useCallback(() => {
      if (userId) void load();
    }, [load, userId])
  );

  // Filter changes refetch on their own debounced schedule, decoupled from `load`'s own identity
  // (which only changes with `loc` / `userId`). `useFocusEffect` re-runs its callback immediately
  // whenever that callback's identity changes while the screen is focused, so folding `spec` into
  // `load`'s deps would make every filter-chip tap bypass this debounce entirely.
  const prevFilterKey = useRef(fKey);
  useEffect(() => {
    if (!userId) return;
    if (prevFilterKey.current === fKey) return; // no real change (e.g. the initial mount) — nothing to debounce
    prevFilterKey.current = fKey;
    const timer = setTimeout(() => void load(), FILTER_REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fKey, userId, load]);

  const refresh = useCallback(async () => {
    if (userId) await load();
    else retrySession(); // no session yet: the anonymous sign-in failed at launch, so try that again
  }, [userId, load, retrySession]);

  // Rows from a previously selected area, or a since-changed filter, must not flash under the new
  // heading. Until the matching fetch settles, report "loading" rather than an empty feed: otherwise the
  // 250ms debounce window (before `load` even sets isLoading) would flash the "no listings" empty state
  // on every filter-chip tap.
  const isStale = loaded.loc !== loc || loaded.filterKey !== fKey;

  return {
    listings: isStale ? [] : loaded.listings,
    isLoading: userId ? isLoading || isStale : false,
    error: userId ? error : 'Could not start a session. Check your connection and try again.',
    refresh,
  };
}

/** Chosen once from the build-time flag, so hook order never changes between renders. */
export const useFeed: (loc: string) => Feed = USE_SUPABASE ? useSupabaseFeed : useMockFeed;
