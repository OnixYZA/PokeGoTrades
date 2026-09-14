import type { Trainer } from './types';

export const trainer: Trainer = {
  handle: 'DriftCoral',
  code: '2841 · 9903 · 7715',
  lvl: 47,
  team: 'Mystic',
  bio: 'Long-time hoarder. Only trade in daylight, only in public. Prefer meeting near IIT-M gate.',
  safeLoc: 'Adyar · ~500m radius',
  trades: 214,
  rep: 4.9,
  streak: 38,
  arsenal: [
    { name: 'Sh. Rayquaza', pokemonId: 384, hue: 145, shiny: true },
    { name: 'Legacy Dnite', pokemonId: 149, hue: 205, lucky: true },
    { name: 'Sh. Metagross', pokemonId: 376, hue: 195, shiny: true },
    { name: 'Purified Apex Ho-Oh', pokemonId: 250, hue: 25 },
    { name: 'Sh. Mewtwo', pokemonId: 150, hue: 275, shiny: true, lucky: true },
    { name: 'Sh. Garchomp', pokemonId: 445, hue: 220, shiny: true },
  ],
  wishlist: [
    { name: 'Sh. Zamazenta', pokemonId: 889, hue: 340, shiny: true },
    { name: 'Sh. Kyogre', pokemonId: 382, hue: 210, shiny: true },
    { name: 'Purified Apex Lugia', pokemonId: 249, hue: 285, shiny: true },
    { name: 'Sh. Mew', pokemonId: 151, hue: 320, shiny: true },
  ],
  tradeHistory: [
    {
      id: 'th1',
      gave: { name: 'Zapdos', pokemonId: 145, hue: 48 },
      got: { name: 'Sh. Charizard', pokemonId: 6, hue: 18, shiny: true },
      partner: 'MintRunner',
      date: 'Aug 22, 2026',
    },
    {
      id: 'th2',
      gave: { name: 'Sh. Blastoise', pokemonId: 9, hue: 205, shiny: true },
      got: { name: 'Articuno', pokemonId: 144, hue: 210 },
      partner: 'CobaltAsh',
      date: 'Jul 30, 2026',
    },
    {
      id: 'th3',
      gave: { name: 'Moltres', pokemonId: 146, hue: 15 },
      got: { name: 'Sh. Venusaur', pokemonId: 3, hue: 130, shiny: true },
      partner: 'PixelKite',
      date: 'Jun 14, 2026',
    },
    {
      id: 'th4',
      gave: { name: 'Groudon', pokemonId: 383, hue: 25 },
      got: { name: 'Sh. Garchomp', pokemonId: 445, hue: 220, shiny: true },
      partner: 'SolstonKid',
      date: 'May 3, 2026',
    },
  ],
};
