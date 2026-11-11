/**
 * Pure helpers behind the feed's search sheet (components/feed/FeedSearchModal.tsx): which species to suggest
 * as "trending". No React Native and no Supabase, so
 * vitest can pin it (lib/feed-search.test.ts).
 *
 * Relative imports, not the `@/` alias, for the same reason as store/listing-filters.ts: the unit-test config
 * has no alias plugin.
 */
import { marketSignalKey, type MarketSignal } from '../constants/market';
import { findPokemon, isPokemonUntradable } from '../constants/pokedex';

/** How many trending chips the sheet shows — one wrapping row or two at 375pt. */
export const TRENDING_LIMIT = 8;

/**
 * Shown when there is no market data to rank (a brand-new database, or a failed read): the species trainers
 * most commonly hunt and trade in Pokémon GO. A curated constant of dex ids only, never counts, so it can
 * not pose as live demand. Every id is tradable; `trendingSpecies` re-checks that anyway.
 * 150 Mewtwo, 384 Rayquaza, 249 Lugia, 250 Ho-Oh, 888 Zacian, 483 Dialga, 484 Palkia, 487 Giratina, 6 Charizard.
 */
export const TRENDING_FALLBACK_IDS: readonly number[] = [150, 384, 249, 250, 888, 483, 484, 487, 6];

/** One species' total "wanted" count across its normal and shiny market rows. */
function wantedBySpecies(signals: ReadonlyMap<string, MarketSignal> | Readonly<Record<string, MarketSignal>>): Map<number, number> {
  const entries = signals instanceof Map ? [...signals.entries()] : Object.entries(signals);
  const totals = new Map<number, number>();
  for (const [key, signal] of entries) {
    const id = Number(key.split(':')[0]);
    if (!Number.isInteger(id) || signal.wanted <= 0) continue;
    totals.set(id, (totals.get(id) ?? 0) + signal.wanted);
  }
  return totals;
}

/**
 * The species to suggest, most wanted first: `pokemon_market_demand` rows (live or the mock fixtures) summed per
 * SPECIES (a shiny and a normal row of the same dex id are one suggestion — the search picks a species, not a
 * variant), untradable species dropped (a feed has no listing for them), ties broken by dex number so the
 * order is stable, capped at `limit`. When the market yields fewer than `limit`, the curated fallback tops it
 * up (market-ranked species first, never duplicated), so the row is never empty or lopsided.
 */
export function trendingSpecies(
  signals: ReadonlyMap<string, MarketSignal> | Readonly<Record<string, MarketSignal>>,
  limit = TRENDING_LIMIT,
): number[] {
  const ranked = [...wantedBySpecies(signals).entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id]) => id);
  const picked: number[] = [];
  for (const id of [...ranked, ...TRENDING_FALLBACK_IDS]) {
    if (picked.length >= limit) break;
    if (picked.includes(id) || !findPokemon(id) || isPokemonUntradable(id)) continue;
    picked.push(id);
  }
  return picked;
}

/** Re-export of the key builder so a caller assembling signals by hand uses the one shape. */
export { marketSignalKey };
