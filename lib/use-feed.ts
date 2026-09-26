import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Listing } from '@/data/types';
import { fetchFeedListings, listingErrorMessage } from '@/lib/api/listings';
import { USE_SUPABASE } from '@/lib/data-source';
import { useSession } from '@/lib/session';
import { useTradeStore } from '@/store/trade-store';

export interface Feed {
  listings: Listing[];
  /** True while a fetch is in flight, including a pull-to-refresh. */
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const noopRefresh = async () => {};

/** The pre-Supabase feed: the seeded store, filtered to one area and sorted by the mock distance. */
function useMockFeed(loc: string): Feed {
  const all = useTradeStore(useShallow((s) => Object.values(s.listings)));
  const listings = useMemo(
    () => all.filter((l) => l.loc === loc).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0)),
    [all, loc]
  );
  return { listings, isLoading: false, error: null, refresh: noopRefresh };
}

/**
 * Open and locked listings for one area, newest first. Refetches on mount, when the area changes and
 * whenever the feed regains focus (after onboarding, or after posting). Results are also merged into
 * the store so the detail sheet can resolve them by id.
 */
function useSupabaseFeed(loc: string): Feed {
  const { user, retry: retrySession } = useSession();
  const userId = user?.id;
  const upsertListings = useTradeStore((s) => s.upsertListings);
  const [loaded, setLoaded] = useState<{ loc: string; listings: Listing[] }>({ loc, listings: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setIsLoading(true);
    try {
      const listings = await fetchFeedListings(loc);
      if (request !== latestRequest.current) return; // a newer area / refresh superseded this one
      setLoaded({ loc, listings });
      upsertListings(listings);
      setError(null);
    } catch (reason) {
      if (request !== latestRequest.current) return;
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

  const refresh = useCallback(async () => {
    if (userId) await load();
    else retrySession(); // no session yet: the anonymous sign-in failed at launch, so try that again
  }, [userId, load, retrySession]);

  return {
    // Rows from a previously selected area must not flash under the new heading.
    listings: loaded.loc === loc ? loaded.listings : [],
    isLoading: userId ? isLoading : false,
    error: userId ? error : 'Could not start a session. Check your connection and try again.',
    refresh,
  };
}

/** Chosen once from the build-time flag, so hook order never changes between renders. */
export const useFeed: (loc: string) => Feed = USE_SUPABASE ? useSupabaseFeed : useMockFeed;
