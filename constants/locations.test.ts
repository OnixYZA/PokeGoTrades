import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AREAS,
  COORDINATE_LIKE_SAMPLES,
  KNOWN_LOCALITIES,
  LOCATION_MAX_LENGTH,
  customLocationChoice,
  formatVicinityLabel,
  locationKey,
  looksLikeCoordinates,
  sanitizeLocationLabel,
  snapToLocality,
  suggestLocalities,
} from './locations';

const KNOWN_NAMES = KNOWN_LOCALITIES.map((l) => l.name);

describe('snapToLocality', () => {
  it.each(KNOWN_LOCALITIES.map((l) => [l.name, l.lat, l.lng] as const))('maps the %s centroid to itself', (name, lat, lng) => {
    expect(snapToLocality(lat, lng)).toBe(name);
  });
  it('keeps a ~300 m offset on the same locality', () => {
    for (const l of KNOWN_LOCALITIES) expect(snapToLocality(l.lat + 0.0027, l.lng)).toBe(l.name);
  });
  it('snaps points near other cities', () => {
    expect(snapToLocality(11.93, 79.83)).toBe('Puducherry');
    expect(snapToLocality(12.97, 77.59)).toBe('Bengaluru');
  });
  it('returns null in mid-ocean and for invalid input', () => {
    expect(snapToLocality(0, 0)).toBeNull();
    expect(snapToLocality(NaN, 80)).toBeNull();
    expect(snapToLocality(13, Infinity)).toBeNull();
    expect(snapToLocality(91, 80.2)).toBeNull();
    expect(snapToLocality(13, 181)).toBeNull();
  });
});

describe('sanitizeLocationLabel', () => {
  it('canonicalises known places case-insensitively', () => {
    expect(sanitizeLocationLabel('t. nagar')).toBe('T. Nagar');
    expect(sanitizeLocationLabel('  VELACHERY ')).toBe('Velachery');
  });
  it('resolves aliases', () => {
    expect(sanitizeLocationLabel('pondicherry')).toBe('Puducherry');
    expect(sanitizeLocationLabel('Bangalore')).toBe('Bengaluru');
  });
  it('strips the legacy vicinity suffix', () => {
    expect(sanitizeLocationLabel('Adyar · ~500m radius')).toBe('Adyar');
    expect(sanitizeLocationLabel('Puducherry · ~1–2 km vicinity')).toBe('Puducherry');
  });
  it('keeps a custom label that merely contains a middle dot', () => {
    expect(sanitizeLocationLabel("Besant Nagar · Elliot's Beach")).toBe("Besant Nagar · Elliot's Beach");
    expect(sanitizeLocationLabel('Phoenix Mall · Gate 3')).toBe('Phoenix Mall · Gate 3');
  });
  it('keeps custom labels as typed', () => {
    expect(sanitizeLocationLabel('Sector 21, Gurgaon')).toBe('Sector 21, Gurgaon');
    expect(sanitizeLocationLabel('Phoenix Mall Velachery gate')).toBe('Phoenix Mall Velachery gate');
  });
  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeLocationLabel('  Phoenix \t\n  Mall  ')).toBe('Phoenix Mall');
    expect(sanitizeLocationLabel('Mall\u0000 Gate\u0007')).toBe('Mall Gate');
  });
  it('snaps a decimal pair to a known locality, never echoing it', () => {
    expect(sanitizeLocationLabel('13.0012, 80.2565')).toBe('Adyar');
    expect(sanitizeLocationLabel('Near 13.0012, 80.2565')).toBe('Adyar');
    expect(sanitizeLocationLabel('0.0001, 0.0001')).toBeNull();
  });
  it('never lets a coordinate-like sample through', () => {
    for (const s of COORDINATE_LIKE_SAMPLES) {
      const out = sanitizeLocationLabel(s);
      expect(out === null || KNOWN_NAMES.includes(out), s).toBe(true);
      if (out !== null) expect(looksLikeCoordinates(out)).toBe(false);
    }
  });
  it('property: generated coordinate strings yield null or a known locality', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 500; i++) {
      const lat = (rnd() * 180 - 90).toFixed(2 + Math.floor(rnd() * 5));
      const lng = (rnd() * 360 - 180).toFixed(2 + Math.floor(rnd() * 5));
      const forms = [`${lat}, ${lng}`, `${lat},${lng}`, `${lat} ${lng}`, `${lat}; ${lng}`, `${lat}/${lng}`, `Meet at ${lat}, ${lng}`, `geo:${lat},${lng}`, `${lat}°N ${lng}°E`];
      for (const f of forms) {
        const out = sanitizeLocationLabel(f);
        expect(out === null || KNOWN_NAMES.includes(out), f).toBe(true);
      }
    }
  });
  it('returns null for empty and over-long input', () => {
    expect(sanitizeLocationLabel('')).toBeNull();
    expect(sanitizeLocationLabel('   ')).toBeNull();
    expect(sanitizeLocationLabel('x'.repeat(LOCATION_MAX_LENGTH))).toBe('x'.repeat(LOCATION_MAX_LENGTH));
    expect(sanitizeLocationLabel('x'.repeat(LOCATION_MAX_LENGTH + 1))).toBeNull();
  });
  it('uses a sanitized fallback without recursing', () => {
    expect(sanitizeLocationLabel('', 'adyar')).toBe('Adyar');
    expect(sanitizeLocationLabel('13.00123', 'Pondy')).toBe('Puducherry');
    expect(sanitizeLocationLabel('13.00123', '13.00123')).toBeNull();
    expect(sanitizeLocationLabel('', '7JFJ+2V')).toBeNull();
  });
});

describe('suggestLocalities', () => {
  it('lists the presets then a few cities for an empty query', () => {
    expect(suggestLocalities('').slice(0, AREAS.length)).toEqual([...AREAS]);
    expect(suggestLocalities('', 20)).toEqual([...AREAS, 'Puducherry', 'Bengaluru', 'Coimbatore', 'Madurai']);
  });
  it('ranks prefix matches before substring matches', () => {
    const out = suggestLocalities('nagar', 20);
    expect(out).toEqual(expect.arrayContaining(['T. Nagar', 'Anna Nagar', 'Besant Nagar']));
    const p = suggestLocalities('t', 30);
    expect(p.indexOf('Tambaram')).toBeLessThan(p.indexOf('Adyar') === -1 ? Infinity : p.indexOf('Adyar'));
  });
  it('resolves aliases to canonical names', () => {
    expect(suggestLocalities('pondi')).toEqual(['Puducherry']);
    expect(suggestLocalities('trichy')).toEqual(['Tiruchirappalli']);
  });
  it('respects the limit', () => {
    expect(suggestLocalities('a', 3)).toHaveLength(3);
  });
});

describe('customLocationChoice', () => {
  it('reports each failure reason', () => {
    expect(customLocationChoice('')).toEqual({ ok: false, reason: 'empty' });
    expect(customLocationChoice('7JFJ+2V')).toEqual({ ok: false, reason: 'coordinates' });
    expect(customLocationChoice('0.0001, 0.0001')).toEqual({ ok: false, reason: 'coordinates' });
    expect(customLocationChoice('y'.repeat(LOCATION_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'too_long' });
  });
  it('accepts labels and snapped pairs', () => {
    expect(customLocationChoice('Sector 21, Gurgaon')).toEqual({ ok: true, label: 'Sector 21, Gurgaon' });
    expect(customLocationChoice('13.0012, 80.2565')).toEqual({ ok: true, label: 'Adyar' });
  });
});

describe('locationKey / formatVicinityLabel', () => {
  it('lower-cases the label', () => {
    expect(locationKey('T. Nagar')).toBe('t. nagar');
  });
  it('formats place and radius', () => {
    expect(formatVicinityLabel('Adyar')).toBe('Adyar · ~1–2 km vicinity');
  });
});

describe('KNOWN_LOCALITIES integrity', () => {
  it('has unique names and aliases and finite coordinates', () => {
    const seen = new Set<string>();
    for (const l of KNOWN_LOCALITIES) {
      for (const n of [l.name, ...(l.aliases ?? [])]) {
        expect(seen.has(n.toLowerCase()), n).toBe(false);
        seen.add(n.toLowerCase());
      }
      expect(Number.isFinite(l.lat) && Number.isFinite(l.lng)).toBe(true);
    }
  });
  it('contains every preset area with identical spelling', () => {
    for (const a of AREAS) expect(KNOWN_NAMES).toContain(a);
  });
});

describe('AREAS vs migration', () => {
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  const sql = readFileSync(join(dir, '20260916000200_tables.sql'), 'utf8');
  it('matches public.areas seed names and order', () => {
    const block = /insert into public\.areas \(name, sort_order\) values([\s\S]*?);/.exec(sql)![1];
    const rows = [...block.matchAll(/\('([^']+)',\s*(\d+)\)/g)].sort((x, y) => Number(x[2]) - Number(y[2]));
    expect(rows.map((r) => r[1])).toEqual([...AREAS]);
  });
  it('no other migration alters or inserts into areas', async () => {
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n !== '20260916000200_tables.sql')) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/(insert into|update|delete from)\s+(public\.)?areas\b|alter table\s+(public\.)?areas\s+(add|drop|alter|rename)/i);
    }
  });
});
