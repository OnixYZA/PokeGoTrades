/**
 * Tiers the raw `pokemon_market_demand` counts into a label the feed can show. Pure and DB-free by
 * design — the view (migration …000300_pokemon_market_demand) deliberately returns counts only and
 * pushes the tiering here, so a threshold never has to be duplicated into SQL to change it.
 */

/** One row of `public.pokemon_market_demand`, mapped 1:1 (see `lib/api/market.ts`). */
export interface MarketSignal {
  wanted: number;
  offered: number;
  ratio: number;
}

/** The one key shape every market lookup uses — `data/market.ts`'s mock fixtures, `lib/api/market.ts`'s
 *  fetched map, and `lib/use-feed.ts` attaching a signal to a listing — so a listing's `pokemonId` +
 *  `shiny` always resolves the same way regardless of which of those three sides is asking. */
export function marketSignalKey(pokemonId: number, shiny: boolean): string {
  return `${pokemonId}:${shiny}`;
}

export type MarketTier = 'hot' | 'high' | 'balanced' | 'surplus' | 'new';

/** Below this many combined want+have signals, the ratio is too noisy to call — one wishlist entry
 *  shouldn't declare something "hot". */
export const NEW_SAMPLE_THRESHOLD = 3;

/** `demand_ratio` is `wanted / greatest(offered, 1)` (see the view), so these thresholds are read
 *  directly against it — never recomputed from `wanted`/`offered` here, since `offered` can be 0. */
export const HOT_RATIO_THRESHOLD = 3;
export const HIGH_RATIO_THRESHOLD = 1.5;
export const BALANCED_RATIO_THRESHOLD = 0.67;

/**
 * `undefined` means "no signal fetched yet" (or the market fetch failed) — that is intentionally
 * folded into `'new'` rather than given its own tier, since the feed has nothing better to say about
 * a listing it knows nothing about yet.
 */
export function demandTier(signal: MarketSignal | undefined): MarketTier {
  if (!signal) return 'new';
  const sample = signal.wanted + signal.offered;
  if (sample < NEW_SAMPLE_THRESHOLD) return 'new';
  if (signal.ratio >= HOT_RATIO_THRESHOLD) return 'hot';
  if (signal.ratio >= HIGH_RATIO_THRESHOLD) return 'high';
  if (signal.ratio >= BALANCED_RATIO_THRESHOLD) return 'balanced';
  return 'surplus';
}

const MARKET_TIER_LABELS: Record<MarketTier, string> = {
  hot: 'Hot',
  high: 'High Demand',
  balanced: 'Balanced',
  surplus: 'Surplus',
  new: 'New',
};

export function marketLabel(tier: MarketTier): string {
  return MARKET_TIER_LABELS[tier];
}
