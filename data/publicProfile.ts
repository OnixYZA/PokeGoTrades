import type { CreatureRef, Trainer } from './types';
import { locations } from './listings';

/**
 * Other trainers (listing sellers, chat partners) only exist in the mock data as a name string —
 * there's no backing profile record. This builds a plausible, *deterministic* public profile for
 * any handle so `/profile/[userId]` always has something real to render, without pretending to be
 * a live lookup.
 */
const CREATURE_POOL: CreatureRef[] = [
  { name: 'Sh. Rayquaza', pokemonId: 384, hue: 145, shiny: true },
  { name: 'Legacy Dragonite', pokemonId: 149, hue: 205 },
  { name: 'Sh. Metagross', pokemonId: 376, hue: 195, shiny: true },
  { name: 'Purified Ho-Oh', pokemonId: 250, hue: 25 },
  { name: 'Sh. Mewtwo', pokemonId: 150, hue: 275, shiny: true },
  { name: 'Sh. Garchomp', pokemonId: 445, hue: 220, shiny: true },
  { name: 'Sh. Zamazenta', pokemonId: 889, hue: 340, shiny: true },
  { name: 'Sh. Kyogre', pokemonId: 382, hue: 210, shiny: true },
  { name: 'Purified Apex Lugia', pokemonId: 249, hue: 285 },
  { name: 'Sh. Mew', pokemonId: 151, hue: 320, shiny: true },
  { name: 'Zapdos', pokemonId: 145, hue: 48 },
  { name: 'Articuno', pokemonId: 144, hue: 210 },
  { name: 'Moltres', pokemonId: 146, hue: 15 },
  { name: 'Groudon', pokemonId: 383, hue: 25 },
];

const BIOS = [
  'Trades on sight, no lowballs. Meet in public, daylight only.',
  'Collector first, trader second. Ask before offering junk.',
  'Community Day regular. Always down for a fair swap.',
  'Raid group leader — friend me for invites.',
];

const PARTNERS = ['MintRunner', 'CobaltAsh', 'PixelKite', 'SolstonKid', 'GraniteFox', 'AzureRift'];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  return hash || 1;
}

function pick<T>(pool: T[], seed: number, offset: number): T {
  return pool[(seed + offset) % pool.length];
}

function pickMany<T>(pool: T[], seed: number, offset: number, count: number): T[] {
  const items: T[] = [];
  for (let i = 0; i < count; i++) items.push(pool[(seed + offset + i * 3) % pool.length]);
  return items;
}

function formatMonthsAgo(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function buildPublicTrainerProfile(handle: string): Trainer {
  const seed = hashString(handle);

  const arsenal = pickMany(CREATURE_POOL, seed, 0, 3 + (seed % 3));
  const wishlist = pickMany(CREATURE_POOL, seed, 5, 2 + (seed % 2));

  const tradeHistory = Array.from({ length: 3 + (seed % 2) }, (_, i) => {
    const gave = pick(CREATURE_POOL, seed, i * 2 + 1);
    let got = pick(CREATURE_POOL, seed, i * 2 + 2);
    if (got.name === gave.name) got = pick(CREATURE_POOL, seed, i * 2 + 3);
    return {
      id: `${handle}-th${i}`,
      gave,
      got,
      partner: pick(PARTNERS, seed, i),
      date: formatMonthsAgo(i + 1),
    };
  });

  return {
    handle,
    code: `${1000 + (seed % 9000)} · ${1000 + ((seed >> 4) % 9000)} · ${1000 + ((seed >> 8) % 9000)}`,
    lvl: 20 + (seed % 30),
    team: ['Mystic', 'Valor', 'Instinct'][seed % 3],
    bio: pick(BIOS, seed, 0),
    safeLoc: `${pick(locations, seed, 0)} · ~500m radius`,
    trades: 8 + (seed % 250),
    rep: Math.round((3.5 + ((seed % 15) / 10)) * 10) / 10,
    streak: seed % 45,
    arsenal,
    wishlist,
    tradeHistory,
  };
}
