import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALL_LOCATIONS,
  COORDINATE_LIKE_SAMPLES,
  LOCATION_MAX_LENGTH,
  coarsenCoords,
  customLocationChoice,
  extractCity,
  formatPlaceLabel,
  formatVicinityLabel,
  isAllLocations,
  locationKey,
  locationMatchRank,
  looksLikeCoordinates,
  matchesLocationFilter,
  sanitizeFilterLocation,
  sanitizeLocationLabel,
} from './locations';

const LEGACY_PUBLIC_AREAS = ['Adyar', 'East Tambaram', 'Velachery', 'T. Nagar', 'Anna Nagar', 'Besant Nagar'] as const;

describe('coarsenCoords', () => {
  it('rounds finite in-range coordinates to 2 decimals (~1.1 km)', () => {
    expect(coarsenCoords(13.0067, 80.2574)).toEqual({ lat: 13.01, lng: 80.26 });
    expect(coarsenCoords(12.9716, 77.5946)).toEqual({ lat: 12.97, lng: 77.59 });
    expect(coarsenCoords(-33.8688, 151.2093)).toEqual({ lat: -33.87, lng: 151.21 });
  });

  it('normalizes -0 to +0', () => {
    const res = coarsenCoords(-0.001, -0.004);
    expect(res).toEqual({ lat: 0, lng: 0 });
    expect(Object.is(res!.lat, 0)).toBe(true);
    expect(Object.is(res!.lng, 0)).toBe(true);
  });

  it('accepts exact boundary coordinates', () => {
    expect(coarsenCoords(-90, -180)).toEqual({ lat: -90, lng: -180 });
    expect(coarsenCoords(90, 180)).toEqual({ lat: 90, lng: 180 });
    expect(coarsenCoords(0, 0)).toEqual({ lat: 0, lng: 0 });
  });

  it('returns null for non-number, non-finite, or out-of-range coordinates', () => {
    expect(coarsenCoords(NaN, 80)).toBeNull();
    expect(coarsenCoords(13, Infinity)).toBeNull();
    expect(coarsenCoords(-Infinity, 80)).toBeNull();
    expect(coarsenCoords(90.01, 80)).toBeNull();
    expect(coarsenCoords(-90.01, 80)).toBeNull();
    expect(coarsenCoords(13, 180.01)).toBeNull();
    expect(coarsenCoords(13, -180.01)).toBeNull();
    expect(coarsenCoords('13' as unknown as number, 80)).toBeNull();
    expect(coarsenCoords(13, null as unknown as number)).toBeNull();
  });
});

describe('isAllLocations', () => {
  it('matches "All locations" case-insensitively with surrounding whitespace', () => {
    expect(isAllLocations(ALL_LOCATIONS)).toBe(true);
    expect(isAllLocations('  all locations  ')).toBe(true);
    expect(isAllLocations('ALL   LOCATIONS')).toBe(true);
  });

  it('rejects null, undefined, and regular locations', () => {
    expect(isAllLocations(null)).toBe(false);
    expect(isAllLocations(undefined)).toBe(false);
    expect(isAllLocations('')).toBe(false);
    expect(isAllLocations('Bengaluru')).toBe(false);
    expect(isAllLocations('All locations near Adyar')).toBe(false);
  });
});

describe('sanitizeLocationLabel', () => {
  it('normalizes city aliases case-insensitively standalone and in comma-separated labels', () => {
    expect(sanitizeLocationLabel('bangalore')).toBe('Bengaluru');
    expect(sanitizeLocationLabel('Bengaluru Urban')).toBe('Bengaluru');
    expect(sanitizeLocationLabel('Indiranagar, Bangalore')).toBe('Indiranagar, Bengaluru');
    expect(sanitizeLocationLabel('Indiranagar, bengaluru urban')).toBe('Indiranagar, Bengaluru');
    expect(sanitizeLocationLabel('pondicherry')).toBe('Puducherry');
    expect(sanitizeLocationLabel('Pondy')).toBe('Puducherry');
    expect(sanitizeLocationLabel('trichy')).toBe('Tiruchirappalli');
    expect(sanitizeLocationLabel('Sector 21, Gurgaon')).toBe('Sector 21, Gurugram');
    expect(sanitizeLocationLabel('New Delhi')).toBe('Delhi');
    expect(sanitizeLocationLabel('madras')).toBe('Chennai');
    expect(sanitizeLocationLabel('BOMBAY')).toBe('Mumbai');
    expect(sanitizeLocationLabel('Calcutta')).toBe('Kolkata');
    expect(sanitizeLocationLabel('Cochin')).toBe('Kochi');
    expect(sanitizeLocationLabel('Mysore')).toBe('Mysuru');
    expect(sanitizeLocationLabel('Mangalore')).toBe('Mangaluru');
    expect(sanitizeLocationLabel('Trivandrum')).toBe('Thiruvananthapuram');
    expect(sanitizeLocationLabel('Vizag')).toBe('Visakhapatnam');
  });

  it('strips the legacy vicinity suffix', () => {
    expect(sanitizeLocationLabel('Adyar · ~500m radius')).toBe('Adyar');
    expect(sanitizeLocationLabel('Puducherry · ~1–2 km vicinity')).toBe('Puducherry');
  });

  it('keeps custom labels that merely contain a middle dot', () => {
    expect(sanitizeLocationLabel("Besant Nagar · Elliot's Beach")).toBe("Besant Nagar · Elliot's Beach");
    expect(sanitizeLocationLabel('Phoenix Mall · Gate 3')).toBe('Phoenix Mall · Gate 3');
  });

  it('keeps custom labels as typed', () => {
    expect(sanitizeLocationLabel('Phoenix Mall Velachery gate')).toBe('Phoenix Mall Velachery gate');
  });

  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeLocationLabel('  Phoenix \t\n  Mall  ')).toBe('Phoenix Mall');
    expect(sanitizeLocationLabel('Mall\u0000 Gate\u0007')).toBe('Mall Gate');
  });

  it('unconditionally rejects ALL coordinate-like samples (no snapping)', () => {
    for (const s of COORDINATE_LIKE_SAMPLES) {
      expect(sanitizeLocationLabel(s), s).toBeNull();
      expect(looksLikeCoordinates(s), s).toBe(true);
    }
  });

  it('property: generated coordinate strings always yield null', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 500; i++) {
      const lat = (rnd() * 180 - 90).toFixed(2 + Math.floor(rnd() * 5));
      const lng = (rnd() * 360 - 180).toFixed(2 + Math.floor(rnd() * 5));
      const forms = [
        `${lat}, ${lng}`,
        `${lat},${lng}`,
        `${lat} ${lng}`,
        `${lat}; ${lng}`,
        `${lat}/${lng}`,
        `Meet at ${lat}, ${lng}`,
        `geo:${lat},${lng}`,
        `${lat}°N ${lng}°E`,
      ];
      for (const f of forms) {
        expect(sanitizeLocationLabel(f), f).toBeNull();
      }
    }
  });

  it('rejects the reserved "All locations" sentinel', () => {
    expect(sanitizeLocationLabel(ALL_LOCATIONS)).toBeNull();
    expect(sanitizeLocationLabel('  all locations  ')).toBeNull();
    expect(sanitizeLocationLabel('All locations · ~1–2 km vicinity')).toBeNull();
  });

  it('returns null for empty and over-long input', () => {
    expect(sanitizeLocationLabel('')).toBeNull();
    expect(sanitizeLocationLabel('   ')).toBeNull();
    expect(sanitizeLocationLabel('x'.repeat(LOCATION_MAX_LENGTH))).toBe('x'.repeat(LOCATION_MAX_LENGTH));
    expect(sanitizeLocationLabel('x'.repeat(LOCATION_MAX_LENGTH + 1))).toBeNull();
  });

  it('uses a sanitized fallback without recursing', () => {
    expect(sanitizeLocationLabel('', 'bangalore')).toBe('Bengaluru');
    expect(sanitizeLocationLabel('13.00123', 'Pondy')).toBe('Puducherry');
    expect(sanitizeLocationLabel('13.00123', '13.00123')).toBeNull();
    expect(sanitizeLocationLabel('', '7JFJ+2V')).toBeNull();
    expect(sanitizeLocationLabel('', 'All locations')).toBeNull();
  });
});

describe('customLocationChoice', () => {
  it('reports each failure reason including reserved', () => {
    expect(customLocationChoice('')).toEqual({ ok: false, reason: 'empty' });
    expect(customLocationChoice('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(customLocationChoice('All locations')).toEqual({ ok: false, reason: 'reserved' });
    expect(customLocationChoice('  all locations  ')).toEqual({ ok: false, reason: 'reserved' });
    expect(customLocationChoice('7JFJ+2V')).toEqual({ ok: false, reason: 'coordinates' });
    expect(customLocationChoice('13.0012, 80.2565')).toEqual({ ok: false, reason: 'coordinates' });
    expect(customLocationChoice('0.0001, 0.0001')).toEqual({ ok: false, reason: 'coordinates' });
    expect(customLocationChoice('y'.repeat(LOCATION_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('accepts valid labels and normalizes aliases', () => {
    expect(customLocationChoice('Sector 21, Gurgaon')).toEqual({ ok: true, label: 'Sector 21, Gurugram' });
    expect(customLocationChoice('Indiranagar, Bangalore')).toEqual({ ok: true, label: 'Indiranagar, Bengaluru' });
  });
});

describe('sanitizeFilterLocation', () => {
  it('accepts All locations and normalizes it', () => {
    expect(sanitizeFilterLocation('All locations')).toBe(ALL_LOCATIONS);
    expect(sanitizeFilterLocation('  all locations ')).toBe(ALL_LOCATIONS);
  });

  it('delegates regular locations to sanitizeLocationLabel', () => {
    expect(sanitizeFilterLocation('Indiranagar, Bangalore')).toBe('Indiranagar, Bengaluru');
    expect(sanitizeFilterLocation('13.0012, 80.2565')).toBeNull();
  });

  it('supports fallback including ALL_LOCATIONS', () => {
    expect(sanitizeFilterLocation('13.0012, 80.2565', ALL_LOCATIONS)).toBe(ALL_LOCATIONS);
    expect(sanitizeFilterLocation('', 'Bangalore')).toBe('Bengaluru');
    expect(sanitizeFilterLocation('', '13.0012, 80.2565')).toBeNull();
  });
});

describe('formatPlaceLabel', () => {
  it('formats Neighbourhood, City and City-only labels', () => {
    expect(formatPlaceLabel({ name: 'Indiranagar', city: 'Bangalore', state: 'Karnataka' })).toBe('Indiranagar, Bengaluru');
    expect(formatPlaceLabel({ locality: 'Adyar', city: 'Chennai', state: 'Tamil Nadu' })).toBe('Adyar, Chennai');
    expect(formatPlaceLabel({ name: 'Bengaluru', state: 'Karnataka' })).toBe('Bengaluru');
    expect(formatPlaceLabel({ city: 'Bombay', state: 'Maharashtra' })).toBe('Mumbai');
  });

  it('deduplicates when primary equals city (including via aliases)', () => {
    expect(formatPlaceLabel({ name: 'Bengaluru', city: 'Bangalore' })).toBe('Bengaluru');
    expect(formatPlaceLabel({ locality: 'Madras', city: 'Chennai' })).toBe('Chennai');
    expect(formatPlaceLabel({ name: 'Chennai', city: 'chennai' })).toBe('Chennai');
  });

  it('falls back cleanly when combined string exceeds LOCATION_MAX_LENGTH', () => {
    const longPrimary = 'A'.repeat(50);
    const label = formatPlaceLabel({ name: longPrimary, city: 'Bengaluru' });
    expect(label).toBe(longPrimary);
    expect(label!.length).toBeLessThanOrEqual(LOCATION_MAX_LENGTH);

    const tooLongPrimary = 'B'.repeat(65);
    expect(formatPlaceLabel({ name: tooLongPrimary, city: 'Bengaluru' })).toBe('Bengaluru');
  });

  it('ignores coordinate-like or reserved components and falls back to state only when needed', () => {
    expect(formatPlaceLabel({ name: '13.0012, 80.2565', city: 'Chennai' })).toBe('Chennai');
    expect(formatPlaceLabel({ name: 'All locations', city: 'Bengaluru' })).toBe('Bengaluru');
    expect(formatPlaceLabel({ state: 'Karnataka' })).toBe('Karnataka');
    expect(formatPlaceLabel({})).toBeNull();
    expect(formatPlaceLabel({ name: '7JFJ+2V' })).toBeNull();
  });
});

describe('extractCity', () => {
  it('extracts and sanitizes the last comma-segment', () => {
    expect(extractCity('Indiranagar, Bengaluru')).toBe('Bengaluru');
    expect(extractCity('Indiranagar, Bangalore')).toBe('Bengaluru');
    expect(extractCity('100ft Rd, Indiranagar, Bengaluru Urban')).toBe('Bengaluru');
  });

  it('returns null for single-segment labels, All locations, or invalid city segment', () => {
    expect(extractCity('Bengaluru')).toBeNull();
    expect(extractCity('Adyar')).toBeNull();
    expect(extractCity(ALL_LOCATIONS)).toBeNull();
    expect(extractCity('Foo, All locations')).toBeNull();
  });
});

describe('locationMatchRank / matchesLocationFilter', () => {
  it('ranks ALL_LOCATIONS as 0 for any listing', () => {
    expect(locationMatchRank('Adyar', ALL_LOCATIONS)).toBe(0);
    expect(locationMatchRank('Indiranagar, Bengaluru', ALL_LOCATIONS)).toBe(0);
    expect(matchesLocationFilter('Adyar', ALL_LOCATIONS)).toBe(true);
  });

  it('ranks exact and exact-neighbourhood matches as 0', () => {
    expect(locationMatchRank('Indiranagar, Bengaluru', 'Indiranagar, Bengaluru')).toBe(0);
    expect(locationMatchRank('Indiranagar, Bangalore', 'Indiranagar, Bengaluru')).toBe(0);
    expect(locationMatchRank('Indiranagar', 'Indiranagar, Bengaluru')).toBe(0);
    expect(locationMatchRank('Adyar', 'Adyar, Chennai')).toBe(0);
  });

  it('ranks city-wide matches properly', () => {
    // Filter is city itself -> rank 0 for both city and neighbourhood in that city
    expect(locationMatchRank('Bengaluru', 'Bengaluru')).toBe(0);
    expect(locationMatchRank('Koramangala, Bengaluru', 'Bengaluru')).toBe(0);
    expect(locationMatchRank('Indiranagar, Bangalore', 'Bengaluru')).toBe(0);

    // Filter is neighbourhood, city -> rank 1 for city-wide and sibling neighbourhoods
    expect(locationMatchRank('Bengaluru', 'Indiranagar, Bengaluru')).toBe(1);
    expect(locationMatchRank('Koramangala, Bengaluru', 'Indiranagar, Bengaluru')).toBe(1);
  });

  it('returns rank 2 (false) for different cities or areas', () => {
    expect(locationMatchRank('Adyar, Chennai', 'Indiranagar, Bengaluru')).toBe(2);
    expect(locationMatchRank('Velachery', 'Adyar, Chennai')).toBe(2);
    expect(locationMatchRank('Adyar', 'Bengaluru')).toBe(2);
    expect(matchesLocationFilter('Adyar, Chennai', 'Bengaluru')).toBe(false);
  });
});

describe('locationKey / formatVicinityLabel', () => {
  it('lower-cases the label', () => {
    expect(locationKey('T. Nagar')).toBe('t. nagar');
  });

  it('formats place and radius, or returns All locations without radius', () => {
    expect(formatVicinityLabel('Adyar')).toBe('Adyar · ~1–2 km vicinity');
    expect(formatVicinityLabel(ALL_LOCATIONS)).toBe(ALL_LOCATIONS);
    expect(formatVicinityLabel('all locations')).toBe(ALL_LOCATIONS);
  });
});

describe('legacy public.areas SQL migration', () => {
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  const sql = readFileSync(join(dir, '20260916000200_tables.sql'), 'utf8');

  it('matches public.areas seed names and order', () => {
    const block = /insert into public\.areas \(name, sort_order\) values([\s\S]*?);/.exec(sql)![1];
    const rows = [...block.matchAll(/\('([^']+)',\s*(\d+)\)/g)].sort((x, y) => Number(x[2]) - Number(y[2]));
    expect(rows.map((r) => r[1])).toEqual([...LEGACY_PUBLIC_AREAS]);
  });

  it('no other migration alters or inserts into areas', async () => {
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n !== '20260916000200_tables.sql')) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(
        /(insert into|update|delete from)\s+(public\.)?areas\b|alter table\s+(public\.)?areas\s+(add|drop|alter|rename)/i,
      );
    }
  });
});
