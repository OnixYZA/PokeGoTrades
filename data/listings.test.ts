import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { creatureFormLabel } from '../lib/format';
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

  it('give Zacian the Crowned Sword form and Mewtwo the Armored one', () => {
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    expect(creatureFormLabel(byId.get('l1')!)).toBe('Crowned Sword');
    expect(byId.get('l2')!.formCode).toBe('A');
    expect(creatureFormLabel(byId.get('l2')!)).toBe('Armored');
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
