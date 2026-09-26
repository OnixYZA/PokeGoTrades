import { marketSignalKey, type MarketSignal } from '@/constants/market';
import { supabase } from '@/lib/supabase';

/**
 * Fetches `pokemon_market_demand` for the given dex ids, one signal per (pokemon_id, shiny) pair
 * actually returned. A pair with no wishlist / arsenal / listing signal at all simply has no row, so
 * a missing key means "no data", exactly like a listing whose `market` is left `undefined`
 * (`lib/use-feed.ts` treats a failed or empty fetch the same way).
 */
export async function fetchMarketDemand(pokemonIds: number[]): Promise<Map<string, MarketSignal>> {
  const result = new Map<string, MarketSignal>();
  const uniqueIds = [...new Set(pokemonIds)];
  if (uniqueIds.length === 0) return result;

  const { data, error } = await supabase
    .from('pokemon_market_demand')
    .select('pokemon_id, shiny, wanted_count, offered_count, demand_ratio')
    .in('pokemon_id', uniqueIds);
  if (error) throw error;

  for (const row of data) {
    if (row.pokemon_id === null || row.shiny === null) continue;
    result.set(marketSignalKey(row.pokemon_id, row.shiny), {
      wanted: row.wanted_count ?? 0,
      offered: row.offered_count ?? 0,
      ratio: row.demand_ratio ?? 0,
    });
  }
  return result;
}
