/**
 * Neighbourhood bucketing and the location privacy model (decision D3).
 *
 * PRIVACY MODEL
 *  - A trainer's exact position never leaves the device. If a raw coordinate is ever involved (a GPS
 *    fix, a pasted "13.0012, 80.2565"), it is snapped HERE, on-device, to the nearest of the six areas.
 *  - The database only accepts an area name: `public.listings.loc` is a foreign key to `public.areas`
 *    (migration 20260916000200_tables.sql), so a coordinate string cannot be stored even by a buggy client.
 *    This module is the client-side front of that guarantee; the FK is the backstop.
 *  - Distances are never shown. The UI says "<Area> · ~500m vicinity" and nothing finer.
 *  - Functions here never store, log or return the input coordinates.
 *
 * `AREAS` must equal the `public.areas` seed in the same order (`sort_order`); constants/locations.test.ts
 * parses the migration and fails if they drift.
 *
 * Zero dependencies: loadable from vitest and from React Native alike.
 */

export const AREAS = ['Adyar', 'East Tambaram', 'Velachery', 'T. Nagar', 'Anna Nagar', 'Besant Nagar'] as const;

export type AreaName = (typeof AREAS)[number];

export function isAreaName(s: unknown): s is AreaName {
  return typeof s === 'string' && (AREAS as readonly string[]).includes(s);
}

/**
 * APPROXIMATE neighbourhood centres in Chennai, hand-placed from general map knowledge. NOT surveyed
 * data and not boundaries: they only need to be good enough to snap a point to the nearest of six areas.
 */
export const AREA_CENTROIDS: Record<AreaName, { lat: number; lng: number }> = {
  Adyar: { lat: 13.0012, lng: 80.2565 },
  'East Tambaram': { lat: 12.9249, lng: 80.1 },
  Velachery: { lat: 12.9815, lng: 80.2180 },
  'T. Nagar': { lat: 13.0418, lng: 80.2341 },
  'Anna Nagar': { lat: 13.085, lng: 80.2101 },
  'Besant Nagar': { lat: 13.0002, lng: 80.2668 },
};

export const VICINITY_RADIUS_LABEL = '~500m vicinity';

/** A point farther than this from every centroid is outside the Chennai metro we serve, so it gets no area. */
export const METRO_CUTOFF_KM = 15;

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest area to a coordinate, or null for non-finite / out-of-range input or a point beyond the metro cut-off. */
export function bucketCoordinatesToArea(lat: number, lng: number): AreaName | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  let best: AreaName | null = null;
  let bestKm = Infinity;
  for (const area of AREAS) {
    const c = AREA_CENTROIDS[area];
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = area;
    }
  }
  return bestKm <= METRO_CUTOFF_KM ? best : null;
}

const COORDINATE_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Coerces any location-ish string to an area name: a case-insensitive exact area match, else a bucketed
 * coordinate pair found in the text, else `fallback` (itself sanitized), else null. Never returns the input.
 */
export function sanitizeLocationLabel(input: string, fallback?: string): AreaName | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const exact = AREAS.find((a) => a.toLowerCase() === lower);
    if (exact) return exact;
    const m = COORDINATE_PAIR.exec(trimmed);
    if (m) {
      const bucketed = bucketCoordinatesToArea(Number(m[1]), Number(m[2]));
      if (bucketed) return bucketed;
    }
  }
  if (fallback !== undefined) {
    const lower = fallback.trim().toLowerCase();
    return AREAS.find((a) => a.toLowerCase() === lower) ?? null;
  }
  return null;
}

export function formatVicinityLabel(area: AreaName): string {
  return `${area} · ${VICINITY_RADIUS_LABEL}`;
}
