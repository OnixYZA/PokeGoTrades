import { marketSignalKey, type MarketSignal } from '@/constants/market';

/**
 * Mock stand-in for `pokemon_market_demand`, one entry per (pokemonId, shiny) pair appearing in
 * `data/listings.ts`. Deliberately spans every tier `demandTier` (constants/market.ts) can produce,
 * so the mock feed exercises the same range of labels the live feed will once the view has data.
 */
export const MOCK_MARKET_SIGNALS: Record<string, MarketSignal> = {
  [marketSignalKey(10188, true)]: { wanted: 9, offered: 2, ratio: 4.5 }, // Shiny Zacian — hot
  [marketSignalKey(150, false)]: { wanted: 4, offered: 3, ratio: 1.33 }, // Armored Mewtwo — balanced
  [marketSignalKey(384, true)]: { wanted: 6, offered: 4, ratio: 1.5 }, // Shiny Rayquaza — high (boundary)
  [marketSignalKey(250, false)]: { wanted: 1, offered: 5, ratio: 0.2 }, // Purified Ho-Oh — surplus
  [marketSignalKey(376, true)]: { wanted: 2, offered: 0, ratio: 2 }, // Shiny Metagross — new (sample < 3)
  [marketSignalKey(249, false)]: { wanted: 2, offered: 3, ratio: 0.67 }, // Purified Apex Lugia — balanced (boundary)
};
