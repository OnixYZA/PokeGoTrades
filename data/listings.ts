import type { Listing } from './types';

// Ported verbatim from the design handoff prototype (Trade Hub.dc.html), with a `pokemonId`
// added to each creature reference for real sprite lookup. Most are national dex numbers, but a
// few carry a PokéAPI form id instead — see the per-entry notes below.
//
// Not every named form has one: "Apex"/"Shadow" costumes and "Legacy" move availability are
// Pokémon GO-only concepts with no PokéAPI entry (Niantic's own asset, not in the open dataset),
// so those fall back to the base species' official artwork until a licensed sprite pack covers
// them. Mainline-game forms (crowned/primal/origin/mega/attack-forme) do have their own PokéAPI
// ids and are wired up below.
export const listings: Listing[] = [
  {
    id: 'l1',
    name: 'Shiny Zacian',
    pokemonId: 10188, // zacian-crowned (PokéAPI form id, not the national dex number)
    form: 'Crowned Sword',
    year: 2020,
    lucky: true,
    shiny: true,
    hue: 260,
    accent: '#c9a6ff',
    bg: 'meta',
    seller: 'AzureRift',
    dist: 0.4,
    loc: 'Adyar',
    pvp: 'S+',
    demand: '#1',
    tradeType: 'Unregistered (Shiny/Legendary)',
    iv: '15/15/14',
    looking: [
      { name: 'Shiny Zamazenta', pokemonId: 889, hue: 340, shiny: true },
      { name: 'Purified Apex Lugia', pokemonId: 249, hue: 25 },
      { name: 'Legacy Mewtwo', pokemonId: 150, hue: 220, lucky: true },
    ],
  },
  {
    id: 'l2',
    name: 'Armored Mewtwo',
    pokemonId: 150, // Armored is a Pokémon GO-exclusive costume; PokéAPI has no such variety
    form: 'Genesis Armor',
    year: 2019,
    lucky: true,
    shiny: false,
    hue: 210,
    accent: '#7fd4ff',
    bg: 'legacy',
    seller: 'GraniteFox',
    dist: 0.9,
    loc: 'Adyar',
    pvp: 'A',
    demand: '#4',
    tradeType: 'Special (Shiny/Legendary) Registered',
    iv: '14/15/15',
    looking: [
      { name: 'Legacy Dragonite', pokemonId: 149, hue: 340 },
      { name: 'Purified Ho-Oh', pokemonId: 250, hue: 25 },
      { name: 'Shiny Deoxys A.', pokemonId: 10001, hue: 220, shiny: true, lucky: true }, // deoxys-attack
    ],
  },
  {
    id: 'l3',
    name: 'Shiny Rayquaza',
    pokemonId: 384,
    form: 'Standard',
    year: 2023,
    lucky: false,
    shiny: true,
    hue: 145,
    accent: '#7dffb3',
    bg: 'shiny',
    seller: 'NoxTrainer',
    dist: 1.4,
    loc: 'Adyar',
    pvp: 'S',
    demand: '#2',
    tradeType: 'Special (Shiny/Legendary) Registered',
    iv: '15/15/15',
    looking: [
      { name: 'Shiny Kyogre', pokemonId: 382, hue: 340, shiny: true },
      { name: 'Shiny Groudon', pokemonId: 383, hue: 25, shiny: true },
      { name: 'Origin Palkia', pokemonId: 10246, hue: 220, lucky: true }, // palkia-origin
    ],
  },
  {
    id: 'l4',
    name: 'Purified Ho-Oh',
    pokemonId: 250,
    form: 'Standard',
    year: 2022,
    lucky: false,
    shiny: false,
    hue: 25,
    accent: '#ffb37a',
    bg: 'meta',
    seller: 'EmberVale',
    dist: 2.1,
    loc: 'East Tambaram',
    pvp: 'A+',
    demand: '#7',
    tradeType: 'Unregistered (Shiny/Legendary)',
    iv: '14/14/15',
    looking: [
      { name: 'Purified Lugia', pokemonId: 249, hue: 340 },
      { name: 'Mega Rayquaza IV', pokemonId: 10079, hue: 25 }, // rayquaza-mega
      { name: 'Shiny Entei', pokemonId: 244, hue: 220, shiny: true, lucky: true },
    ],
  },
  {
    id: 'l5',
    name: 'Shiny Metagross',
    pokemonId: 376,
    form: 'Frostmoves',
    year: 2018,
    lucky: true,
    shiny: true,
    hue: 195,
    accent: '#a3e8ff',
    bg: 'meta',
    seller: 'IronGlass',
    dist: 3.8,
    loc: 'East Tambaram',
    pvp: 'S',
    demand: '#3',
    tradeType: 'Special (Shiny/Legendary) Registered',
    iv: '15/13/15',
    looking: [
      { name: 'Shiny Beldum Comm.', pokemonId: 374, hue: 340, shiny: true },
      { name: 'Shiny Larvitar', pokemonId: 246, hue: 25, shiny: true },
      { name: 'Shiny Bagon', pokemonId: 371, hue: 220, shiny: true, lucky: true },
    ],
  },
  {
    id: 'l6',
    name: 'Purified Apex Lugia',
    pokemonId: 249,
    form: 'Apex',
    year: 2024,
    lucky: false,
    shiny: false,
    hue: 285,
    accent: '#d4b0ff',
    bg: 'legacy',
    seller: 'VoidQuill',
    dist: 5.2,
    loc: 'Velachery',
    pvp: 'A',
    demand: '#5',
    tradeType: 'Unregistered (Shiny/Legendary)',
    iv: '15/15/15',
    looking: [
      { name: 'Purified Apex Ho-Oh', pokemonId: 250, hue: 340 },
      { name: 'Primal Groudon', pokemonId: 10078, hue: 25 }, // groudon-primal
      { name: 'Shiny Mew', pokemonId: 151, hue: 220, shiny: true, lucky: true },
    ],
  },
];

export const locations = ['Adyar', 'East Tambaram', 'Velachery', 'T. Nagar', 'Anna Nagar', 'Besant Nagar'];
