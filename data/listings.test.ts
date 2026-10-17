import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isPokemonUntradable } from '../constants/pokedex';
import { creatureFormLabel } from '../lib/format';
import { formalOffer } from './chats';
import { listings } from './listings';

/** The shape `listings.form_code`'s CHECK accepts (supabase/migrations/20260927000500_creature_form_codes.sql). */
const FORM_CODE_SHAPE = /^[A-Z0-9_]{1,40}$/;

describe('mock listings', () => {
  it('state their form as a form code alone: well-formed, and labelled by creatureFormLabel', () => {
    for (const listing of listings) {
      if (!listing.formCode) {
        // The default form has no label, which is what lets a screen leave the form out.
        expect(creatureFormLabel(listing), `${listing.id} has no form code`).toBeUndefined();
        continue;
      }
      expect(listing.formCode, `${listing.id} form code`).toMatch(FORM_CODE_SHAPE);
      expect(creatureFormLabel(listing), `${listing.id} label`).toBeTruthy();
    }
  });

  it('give Zacian its default form (Crowned Sword Zacian is untradable) and Mewtwo the Armored one', () => {
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    expect(byId.get('l1')!.pokemonId).toBe(888);
    expect(byId.get('l1')!.formCode).toBeUndefined();
    expect(creatureFormLabel(byId.get('l1')!)).toBeUndefined();
    expect(byId.get('l2')!.formCode).toBe('A');
    expect(creatureFormLabel(byId.get('l2')!)).toBe('Armored');
  });

  // The rule is `isPokemonUntradable`, the client copy of `public.is_creature_untradable`. The seeded database
  // refuses an untradable listing or wanted creature (listings_tradable_guard) and an untradable offer
  // (chat_messages_tradable_offer), so a mock that names one is a mock the database cannot reproduce.
  it('never lists, wants or offers an untradable creature', () => {
    for (const listing of listings) {
      expect(isPokemonUntradable(listing.pokemonId, listing.formCode), `${listing.id} listing`).toBe(false);
      for (const wanted of listing.looking) {
        expect(isPokemonUntradable(wanted.pokemonId, wanted.formCode), `${listing.id} wants ${wanted.name}`).toBe(false);
      }
    }
    expect(isPokemonUntradable(formalOffer.pokemonId), 'the mock formal offer').toBe(false);
  });
});

// The mock feed and the seeded database are the same six listings (seed.sql: "Listings l1-l6 (data/listings.ts)").
// They used to disagree about the form (the seed said "Genesis Armor" beside `A`, the mock said "Standard" beside
// nothing), because each held a free-text `form` of its own. This reads the seed and compares what both now state.
describe('mock listings vs supabase/seed.sql', () => {
  const seed = readFileSync(path.resolve(__dirname, '..', 'supabase', 'seed.sql'), 'utf8');

  const insert = /insert into public\.listings \(([^)]*)\) values/.exec(seed);
  const rows = [
    ...seed.matchAll(
      /\('b0000000-0000-4000-8000-00000000000(\d)',\s*'a0000000-[0-9a-f-]+',\s*'[^']*',\s*(\d+),\s*(null|'[A-Z0-9_]+'),\s*(\d{4}),/g,
    ),
  ].map(([, n, pokemonId, formCode, year]) => ({
    id: `l${n}`,
    pokemonId: Number(pokemonId),
    formCode: formCode === 'null' ? null : formCode.slice(1, -1),
    year: Number(year),
  }));

  it('reads all six seeded listings', () => {
    // Guards the parse itself: a seed reformat that matches nothing must fail here, not pass vacuously below.
    expect(insert, 'the listings insert').not.toBeNull();
    expect(rows.map((row) => row.id)).toEqual(listings.map((listing) => listing.id));
  });

  it('only lists and wants tradable creatures, so the untradable guard lets the seed load', () => {
    // Migrations run before the seed on a `supabase db reset`, so listings_tradable_guard sees every row below
    // and aborts the whole seed on an untradable one. Every looking[] entry is a flat JSON object inside this
    // one INSERT; the statement has no other braces and no `;` before its end.
    const statement = /insert into public\.listings \([^)]*\) values([\s\S]*?);/.exec(seed)?.[1] ?? '';
    const wanted = [...statement.matchAll(/\{[^{}]*\}/g)].map(
      ([json]) => JSON.parse(json) as { name: string; pokemonId: number; formCode?: string },
    );
    expect(wanted, 'looking[] entries parsed from the seed').toHaveLength(listings.flatMap((listing) => listing.looking).length);
    for (const row of rows) {
      expect(isPokemonUntradable(row.pokemonId, row.formCode), `${row.id} listing`).toBe(false);
    }
    for (const entry of wanted) {
      expect(isPokemonUntradable(entry.pokemonId, entry.formCode), `looking[] ${entry.name}`).toBe(false);
    }
  });

  it('never inserts the free-text form column, so it loads before and after that column is dropped', () => {
    const columns = (insert?.[1] ?? '').split(',').map((column) => column.trim());
    expect(columns).toContain('form_code');
    expect(columns).not.toContain('form');
  });

  it('agrees with the mock on species, form code and catch year, listing by listing', () => {
    const mock = rows.map(({ id }) => {
      const listing = listings.find((candidate) => candidate.id === id)!;
      return { id, pokemonId: listing.pokemonId, formCode: listing.formCode ?? null, year: listing.year };
    });
    expect(rows).toEqual(mock);
  });
});
