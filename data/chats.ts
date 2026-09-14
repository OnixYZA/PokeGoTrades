import type { ChatMessage, ChatSeed } from './types';

export const chats: ChatSeed[] = [
  {
    id: 'c1',
    listingId: 'l1',
    partner: 'MintRunner',
    preview: 'I can add a shiny Zubat too, is that fair?',
    unread: 2,
    active: true,
    offers: [
      { role: 'them', text: 'Hey! Interested in Zacian. Trading a shiny Regieleki?', time: '10:24' },
      { role: 'me', text: 'Regieleki is close but I really need Zamazenta.', time: '10:26' },
      { role: 'them', text: 'What about Regieleki + legacy Dragonite?', time: '10:31' },
      { role: 'them', text: 'I can add a shiny Zubat too, is that fair?', time: '10:33' },
    ],
  },
  {
    id: 'c2',
    listingId: 'l1',
    partner: 'CobaltAsh',
    preview: 'Meet at the coffee shop by IIT gate?',
    unread: 0,
    active: true,
    offers: [],
  },
  {
    id: 'c3',
    listingId: 'l1',
    partner: 'PixelKite',
    preview: 'Willing to throw in 3M stardust bonus',
    unread: 1,
    active: true,
    offers: [],
  },
  {
    id: 'c4',
    listingId: 'l3',
    partner: 'SolstonKid',
    preview: 'Locked in — see you at 5 ✅',
    unread: 0,
    active: false,
    offers: [],
  },
];

/** The default thread shown when a chat has no scripted `offers` of its own. */
export const fallbackOffers = (listingName: string): ChatMessage[] => [
  { role: 'them', text: `Hey, is your ${listingName} still up?`, time: '10:12' },
  { role: 'me', text: 'Yep — what are you offering?', time: '10:14' },
  { role: 'them', text: 'I have a legacy Dragonite with Draco Meteor.', time: '10:17' },
  { role: 'me', text: 'Interested. Meet at Adyar signal at 5?', time: '10:20' },
];

export const formalOffer = { name: 'Legacy Dragonite', pokemonId: 149, hue: 205, iv: '96% IV', move: 'Draco Meteor' };

export const totalUnread = chats.reduce((sum, c) => sum + c.unread, 0);

