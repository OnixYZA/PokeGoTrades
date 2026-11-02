import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AREAS,
  AREA_CENTROIDS,
  bucketCoordinatesToArea,
  formatVicinityLabel,
  isAreaName,
  sanitizeLocationLabel,
} from './locations';

describe('bucketCoordinatesToArea', () => {
  it.each(AREAS)('maps the %s centroid to itself', (a) => {
    expect(bucketCoordinatesToArea(AREA_CENTROIDS[a].lat, AREA_CENTROIDS[a].lng)).toBe(a);
  });
  it('keeps a ~300 m offset in the same area', () => {
    for (const a of AREAS) {
      const c = AREA_CENTROIDS[a];
      expect(bucketCoordinatesToArea(c.lat + 0.0027, c.lng)).toBe(a);
    }
  });
  it('picks the nearer of two areas', () => {
    const a = AREA_CENTROIDS.Adyar;
    const b = AREA_CENTROIDS['Besant Nagar'];
    expect(bucketCoordinatesToArea(a.lat * 0.7 + b.lat * 0.3, a.lng * 0.7 + b.lng * 0.3)).toBe('Adyar');
    expect(bucketCoordinatesToArea(a.lat * 0.3 + b.lat * 0.7, a.lng * 0.3 + b.lng * 0.7)).toBe('Besant Nagar');
  });
  it('returns null outside the metro and for invalid input', () => {
    expect(bucketCoordinatesToArea(12.9716, 77.5946)).toBeNull(); // Bengaluru
    expect(bucketCoordinatesToArea(0, 0)).toBeNull();
    expect(bucketCoordinatesToArea(91, 80.2)).toBeNull();
    expect(bucketCoordinatesToArea(13, 181)).toBeNull();
    expect(bucketCoordinatesToArea(NaN, 80)).toBeNull();
    expect(bucketCoordinatesToArea(13, Infinity)).toBeNull();
    expect(bucketCoordinatesToArea(-Infinity, 80)).toBeNull();
  });
});

describe('sanitizeLocationLabel', () => {
  it('never echoes a coordinate string', () => {
    for (const s of ['13.0012, 80.2565', '13.0012,80.2565', 'near 13.0012 , 80.2565 ok']) {
      const out = sanitizeLocationLabel(s);
      expect(out).toBe('Adyar');
      expect(isAreaName(out)).toBe(true);
    }
  });
  it('is case-insensitive on names', () => {
    expect(sanitizeLocationLabel('t. nagar')).toBe('T. Nagar');
    expect(sanitizeLocationLabel('  VELACHERY ')).toBe('Velachery');
  });
  it('uses the fallback, else null', () => {
    expect(sanitizeLocationLabel('Mars')).toBeNull();
    expect(sanitizeLocationLabel('Mars', 'adyar')).toBe('Adyar');
    expect(sanitizeLocationLabel('Mars', 'Venus')).toBeNull();
    expect(sanitizeLocationLabel('12.97, 77.59')).toBeNull();
  });
});

describe('formatVicinityLabel', () => {
  it('formats area and radius', () => {
    expect(formatVicinityLabel('Adyar')).toBe('Adyar · ~500m vicinity');
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
