/**
 * Flexible place labels and the location privacy model (decision D3, revised for Sprint 2.1 + API-backed search).
 *
 * PRIVACY MODEL
 *  - A location is a free-text PLACE LABEL ("Adyar", "Indiranagar, Bengaluru", "Phoenix Mall gate"), never a
 *    coordinate. The only ways to obtain a `LocationName` are `sanitizeLocationLabel` / `customLocationChoice` /
 *    `formatPlaceLabel`, which normalize city aliases, keep custom labels as typed, and UNCONDITIONALLY REJECT
 *    anything that looks like a coordinate (decimal pairs, plus codes, degree notation, geo: URIs, long decimals)
 *    as well as the reserved filter value `'All locations'`.
 *  - A trainer's exact position never leaves the device. Any GPS fix is coarsened HERE, on-device (`coarsenCoords`,
 *    rounded to 2 decimal places / ~1.1 km) before any network reverse-geocode request is ever issued.
 *  - The database enforces the same coordinate rule: `listings.loc` and `profile_private.safe_loc` carry CHECK
 *    constraints that refuse coordinate-like text even from a modified client (migration 20261112000300).
 *    `looksLikeCoordinates` below is the client mirror of those regexes; keep them in step.
 *  - Distances are never shown. The UI says "<Place> · ~1–2 km vicinity" and nothing finer.
 *  - Functions here never store, log or return the input coordinates.
 *
 * Zero dependencies (relative imports only, no React Native, no network): loadable from vitest and from React
 * Native alike.
 */

/**
 * A place label. Only ever produced by `sanitizeLocationLabel` / `customLocationChoice` / `formatPlaceLabel`
 * (or `sanitizeFilterLocation` when `'All locations'` is allowed), so a value of this type is never
 * coordinate-like. It is a plain string on purpose: custom labels are free text.
 */
export type LocationName = string;

/** Sentinel filter value meaning "show listings from every location". Never stored on a listing or home profile. */
export const ALL_LOCATIONS = 'All locations' as const;

/** Longest custom label a listing may carry. Mirrors `listings_loc_is_place_label` (migration 20261112000300). */
export const LOCATION_MAX_LENGTH = 60;

/** Longest home location. Mirrors `profile_private_safe_loc_is_place_label`. Any sanitized label is shorter. */
export const HOME_LOCATION_MAX_LENGTH = 80;

export const VICINITY_RADIUS_LABEL = '~1–2 km vicinity';

/** True when `loc` is the reserved "All locations" filter sentinel (case-insensitive, trimmed). */
export function isAllLocations(loc: string | null | undefined): boolean {
  if (typeof loc !== 'string') return false;
  return loc.replace(/\s+/g, ' ').trim().toLowerCase() === 'all locations';
}

/**
 * Validates and coarsens raw GPS coordinates on-device to 2 decimal places (~1.1 km) before any network
 * reverse-geocode request. Returns null for non-number, non-finite, or out-of-range coordinates.
 */
export function coarsenCoords(lat: number, lng: number): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const round2 = (n: number): number => {
    const rounded = Math.round(n * 100) / 100;
    return rounded === 0 ? 0 : rounded;
  };
  return { lat: round2(lat), lng: round2(lng) };
}

/**
 * The patterns that make text "coordinate-like". The database CHECK constraints use the same regexes
 * (20261112000300_flexible_locations.sql); keep both in step.
 */
/** A decimal lat/lng pair: "13.0012, 80.2565", "-33.8688 151.2093", "12.9716; 77.5946". */
export const DECIMAL_PAIR_PATTERN = /-?\d{1,3}\.\d+\s*[,;/ ]\s*-?\d{1,3}\.\d+/;
/** A high-precision decimal fragment: any number with 3+ decimals ("13.00123"). */
export const HIGH_PRECISION_PATTERN = /\d+\.\d{3,}/;
/** Degree notation: "13°00′N". */
export const DEGREE_PATTERN = /[°º]/;
/** An Open Location Code / plus code such as "7JFJ+2V" (case-insensitive). */
export const PLUS_CODE_PATTERN = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;
/** A geo: URI. */
export const GEO_URI_PATTERN = /geo:/i;

const COORDINATE_PATTERNS: readonly RegExp[] = [
  DECIMAL_PAIR_PATTERN,
  HIGH_PRECISION_PATTERN,
  DEGREE_PATTERN,
  PLUS_CODE_PATTERN,
  GEO_URI_PATTERN,
];

/** True when the text carries a coordinate in any of the supported notations. */
export function looksLikeCoordinates(text: string): boolean {
  return COORDINATE_PATTERNS.some((p) => p.test(text));
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The app's OWN display suffix (" · ~500m radius" from older clients, " · ~1–2 km vicinity" from
 * `formatVicinityLabel`), and nothing else: a trainer's own "Besant Nagar · Elliot's Beach" keeps its second
 * half. Mirrored by the `safe_loc` clean-up in supabase/migrations/20261112000300_flexible_locations.sql.
 */
const VICINITY_SUFFIX = /\s*·\s*~?\s*\d+(?:\s*[–-]\s*\d+)?\s*(?:m|km)\b.*$/i;

const CITY_ALIASES: Readonly<Record<string, string>> = {
  bangalore: 'Bengaluru',
  'bengaluru urban': 'Bengaluru',
  pondicherry: 'Puducherry',
  pondy: 'Puducherry',
  trichy: 'Tiruchirappalli',
  gurgaon: 'Gurugram',
  'new delhi': 'Delhi',
  madras: 'Chennai',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  cochin: 'Kochi',
  mysore: 'Mysuru',
  mangalore: 'Mangaluru',
  trivandrum: 'Thiruvananthapuram',
  vizag: 'Visakhapatnam',
};

function normalizeCityAlias(segment: string): string {
  return CITY_ALIASES[segment.toLowerCase()] ?? segment;
}

function cleanLabel(input: string): string {
  const collapsed = input
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim()
    .replace(VICINITY_SUFFIX, '')
    .trim();
  if (collapsed === '') return '';
  if (!collapsed.includes(',')) return normalizeCityAlias(collapsed);
  // Leave coordinate-like strings intact so `looksLikeCoordinates` always detects them reliably.
  if (looksLikeCoordinates(collapsed)) return collapsed;
  return collapsed
    .split(',')
    .map((part) => normalizeCityAlias(part.trim()))
    .filter(Boolean)
    .join(', ');
}

export type CustomLocationChoice =
  | { ok: true; label: LocationName }
  | { ok: false; reason: 'coordinates' | 'too_long' | 'empty' | 'reserved' };

/** Applies the label rules to one string and reports why it failed. The single source of truth for them. */
export function customLocationChoice(query: string): CustomLocationChoice {
  if (typeof query !== 'string') return { ok: false, reason: 'empty' };
  const cleaned = cleanLabel(query);
  if (cleaned === '') return { ok: false, reason: 'empty' };
  if (isAllLocations(cleaned)) return { ok: false, reason: 'reserved' };
  if (looksLikeCoordinates(cleaned)) return { ok: false, reason: 'coordinates' };
  if (cleaned.length > LOCATION_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, label: cleaned };
}

/**
 * Coerces a place-label string: normalizes known city aliases, collapses whitespace, strips control
 * characters and legacy vicinity suffixes, caps at `LOCATION_MAX_LENGTH` (60), and unconditionally rejects
 * coordinate-like text as well as the reserved `'All locations'` sentinel. On failure it falls back to
 * `fallback`, sanitized by the same rules without recursing. Never returns coordinate-like text.
 */
export function sanitizeLocationLabel(input: string, fallback?: string): LocationName | null {
  const first = customLocationChoice(input);
  if (first.ok) return first.label;
  if (fallback === undefined) return null;
  const second = customLocationChoice(fallback);
  return second.ok ? second.label : null;
}

/**
 * Sanitizes a feed-filter location: accepts `'All locations'` (normalized to `ALL_LOCATIONS`) or delegates
 * to `sanitizeLocationLabel`. Falls back to `fallback` under the same rules if `input` is invalid.
 */
export function sanitizeFilterLocation(input: string, fallback?: string): LocationName | null {
  if (typeof input === 'string') {
    const cleaned = cleanLabel(input);
    if (isAllLocations(cleaned)) return ALL_LOCATIONS;
  }
  const direct = sanitizeLocationLabel(input);
  if (direct !== null) return direct;
  if (fallback === undefined) return null;
  if (typeof fallback === 'string') {
    const cleanedFallback = cleanLabel(fallback);
    if (isAllLocations(cleanedFallback)) return ALL_LOCATIONS;
  }
  return sanitizeLocationLabel(fallback);
}

export interface PlaceComponents {
  name?: string | null;
  locality?: string | null;
  district?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
}

function cleanComponent(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanLabel(value);
  if (cleaned === '' || isAllLocations(cleaned) || looksLikeCoordinates(cleaned)) return null;
  return cleaned;
}

/**
 * Formats structured geocoder components (Photon / BigDataCloud) into canonical `'Neighbourhood, City'` or
 * `'City'`, deduplicating when primary equals city, normalizing aliases, falling back cleanly if the combined
 * label exceeds `LOCATION_MAX_LENGTH`, and always passing through `sanitizeLocationLabel`.
 */
export function formatPlaceLabel(parts: PlaceComponents): LocationName | null {
  const primary = cleanComponent(parts.name) ?? cleanComponent(parts.locality) ?? cleanComponent(parts.district);
  const city = cleanComponent(parts.city) ?? cleanComponent(parts.county);
  const state = cleanComponent(parts.state);

  if (primary && city) {
    if (locationKey(primary) === locationKey(city)) {
      // Prefer whichever spelling carries casing (e.g. 'Chennai' over 'chennai').
      const preferred = city === city.toLowerCase() && primary !== primary.toLowerCase() ? primary : city;
      return sanitizeLocationLabel(preferred);
    }
    const combined = `${primary}, ${city}`;
    return sanitizeLocationLabel(combined) ?? sanitizeLocationLabel(primary) ?? sanitizeLocationLabel(city);
  }

  if (primary) {
    return sanitizeLocationLabel(primary);
  }

  if (city) {
    return sanitizeLocationLabel(city);
  }

  if (state) {
    return sanitizeLocationLabel(state);
  }

  return null;
}

/**
 * Extracts the sanitized city scope from a comma-separated place label (e.g. `'Indiranagar, Bengaluru'` ->
 * `'Bengaluru'`). Returns `null` for single-segment labels (`'Bengaluru'`, `'Adyar'`) and `'All locations'`.
 */
export function extractCity(label: LocationName): LocationName | null {
  if (typeof label !== 'string' || isAllLocations(label)) return null;
  const idx = label.lastIndexOf(',');
  if (idx === -1) return null;
  return sanitizeLocationLabel(label.slice(idx + 1));
}

/**
 * Ranks how closely `listingLoc` matches `filterLoc`:
 * - `0`: `ALL_LOCATIONS`, exact match, exact neighbourhood match (e.g. filter `'Indiranagar, Bengaluru'` matches
 *        listing `'Indiranagar'`), or city-wide match when `filterLoc` itself is a city (e.g. `'Bengaluru'`
 *        matches `'Koramangala, Bengaluru'`).
 * - `1`: city-wide / sibling-neighbourhood match when `filterLoc` names a neighbourhood (e.g. filter
 *        `'Indiranagar, Bengaluru'` matches listing `'Bengaluru'` or `'Koramangala, Bengaluru'`).
 * - `2`: no match.
 */
export function locationMatchRank(listingLoc: LocationName, filterLoc: LocationName): 0 | 1 | 2 {
  if (isAllLocations(filterLoc)) return 0;

  const listing = sanitizeLocationLabel(listingLoc);
  const filter = sanitizeLocationLabel(filterLoc);
  if (!listing || !filter) return 2;

  if (locationKey(listing) === locationKey(filter)) return 0;

  const filterCity = extractCity(filter);
  const listingCity = extractCity(listing);

  if (filterCity) {
    const filterNeighbourhood = filter.slice(0, filter.lastIndexOf(',')).trim();
    if (!listingCity && filterNeighbourhood && locationKey(listing) === locationKey(filterNeighbourhood)) {
      return 0;
    }
    if (locationKey(listing) === locationKey(filterCity)) return 1;
    if (listingCity && locationKey(listingCity) === locationKey(filterCity)) return 1;
    return 2;
  }

  if (listingCity && locationKey(listingCity) === locationKey(filter)) return 0;

  return 2;
}

/** True when `listingLoc` passes `filterLoc` (`locationMatchRank < 2`). */
export function matchesLocationFilter(listingLoc: LocationName, filterLoc: LocationName): boolean {
  return locationMatchRank(listingLoc, filterLoc) < 2;
}

/** Case-insensitive match key. Mirrors the DB's `listings.loc_key` generated column (`lower(loc)`). */
export function locationKey(label: LocationName): string {
  return label.toLowerCase();
}

export function formatVicinityLabel(label: LocationName): string {
  if (isAllLocations(label)) return ALL_LOCATIONS;
  return `${label} · ${VICINITY_RADIUS_LABEL}`;
}

/**
 * Shared bad-input fixtures: each must be refused by `sanitizeLocationLabel` and refused by the database CHECK
 * constraints. Keep in sync with supabase/tests/flexible_locations.test.sql.
 */
export const COORDINATE_LIKE_SAMPLES: readonly string[] = [
  '13.0012, 80.2565',
  '13.0012,80.2565',
  '-33.8688 151.2093',
  '12.9716; 77.5946',
  '13.00123',
  '13°00′N 80°15′E',
  '7JFJ+2V Chennai',
  'geo:13.0,80.2',
  'Near 13.0012, 80.2565',
];
