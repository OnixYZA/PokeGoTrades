/**
 * Flexible place labels and the location privacy model (decision D3, revised for Sprint 2.1).
 *
 * PRIVACY MODEL
 *  - A location is a free-text PLACE LABEL ("Adyar", "Indiranagar, Bengaluru", "Phoenix Mall gate"), never a
 *    coordinate. The only way to obtain a `LocationName` is `sanitizeLocationLabel`, which canonicalises known
 *    places, keeps custom labels as typed, snaps a coordinate pair to the nearest KNOWN locality and REJECTS
 *    anything else that looks like a coordinate (plus codes, degree notation, geo: URIs, long decimals).
 *  - A trainer's exact position never leaves the device. A GPS fix is snapped HERE, on-device, to the nearest
 *    known locality (`snapToLocality`) and only that name is used. We never snap to a grid and never build a
 *    label out of numbers: a grid cell is still a coordinate.
 *  - The database enforces the same rule: `listings.loc` and `profile_private.safe_loc` carry CHECK constraints
 *    that refuse coordinate-like text even from a modified client (migration 20261112000300_flexible_locations.sql).
 *    `looksLikeCoordinates` below is the client mirror of those regexes; keep them in step.
 *  - Distances are never shown. The UI says "<Place> · ~1–2 km vicinity" and nothing finer.
 *  - Functions here never store, log or return the input coordinates.
 *
 * `AREAS` is the original six Chennai presets and must equal the `public.areas` seed in the same order
 * (`sort_order`); constants/locations.test.ts parses the migration and fails if they drift. That table is now a
 * legacy preset list: nothing references it any more.
 *
 * Zero dependencies (relative imports only, no React Native, no network): loadable from vitest and from React
 * Native alike.
 */

/** The original Chennai presets, pinned to the `public.areas` seed. */
export const AREAS = ['Adyar', 'East Tambaram', 'Velachery', 'T. Nagar', 'Anna Nagar', 'Besant Nagar'] as const;

/**
 * A place label. Only ever produced by `sanitizeLocationLabel` (or `customLocationChoice` / `snapToLocality`,
 * which share its rules), so a value of this type is never coordinate-like. It is a plain string on purpose:
 * custom labels are free text.
 */
export type LocationName = string;

export interface Locality {
  name: string;
  lat: number;
  lng: number;
  /** Alternative spellings / names that resolve to `name` (matched case-insensitively). */
  aliases?: readonly string[];
}

/**
 * APPROXIMATE locality centres, hand-placed from general map knowledge. NOT surveyed data and not boundaries:
 * they only need to be good enough to snap a GPS fix to the nearest known town. The six `AREAS` come first
 * with their original coordinates.
 */
export const KNOWN_LOCALITIES: readonly Locality[] = [
  { name: 'Adyar', lat: 13.0012, lng: 80.2565 },
  { name: 'East Tambaram', lat: 12.9249, lng: 80.1 },
  { name: 'Velachery', lat: 12.9815, lng: 80.218 },
  { name: 'T. Nagar', lat: 13.0418, lng: 80.2341 },
  { name: 'Anna Nagar', lat: 13.085, lng: 80.2101 },
  { name: 'Besant Nagar', lat: 13.0002, lng: 80.2668 },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1275 },
  { name: 'Chromepet', lat: 12.9516, lng: 80.1462 },
  { name: 'Guindy', lat: 13.0067, lng: 80.2206 },
  { name: 'Mylapore', lat: 13.0368, lng: 80.2676 },
  { name: 'Nungambakkam', lat: 13.0569, lng: 80.2425 },
  { name: 'Porur', lat: 13.0382, lng: 80.1565 },
  { name: 'Sholinganallur', lat: 12.901, lng: 80.2279, aliases: ['OMR'] },
  { name: 'Perambur', lat: 13.1167, lng: 80.2333 },
  { name: 'Thiruvanmiyur', lat: 12.9830, lng: 80.2594 },
  { name: 'Kilpauk', lat: 13.0836, lng: 80.2412 },
  { name: 'Puducherry', lat: 11.9416, lng: 79.8083, aliases: ['Pondicherry', 'Pondy'] },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, aliases: ['Bangalore'] },
  { name: 'Indiranagar', lat: 12.9784, lng: 77.6408 },
  { name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
  { name: 'Whitefield', lat: 12.9698, lng: 77.75 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
  { name: 'Madurai', lat: 9.9252, lng: 78.1198 },
  { name: 'Tiruchirappalli', lat: 10.7905, lng: 78.7047, aliases: ['Trichy'] },
  { name: 'Vellore', lat: 12.9165, lng: 79.1325 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { name: 'Delhi', lat: 28.6139, lng: 77.209, aliases: ['New Delhi'] },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
];

/** The feed's initial location, and the fallback when nothing else is known. */
export const DEFAULT_LOCATION: LocationName = 'Adyar';

/** Longest custom label a listing may carry. Mirrors `listings_loc_is_place_label` (migration 20261112000300). */
export const LOCATION_MAX_LENGTH = 60;

/** Longest home location. Mirrors `profile_private_safe_loc_is_place_label`. Any sanitized label is shorter. */
export const HOME_LOCATION_MAX_LENGTH = 80;

export const VICINITY_RADIUS_LABEL = '~1–2 km vicinity';

/** A coordinate farther than this from every known locality has no label (it is not "near" anything we know). */
export const SNAP_CUTOFF_KM = 25;

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Nearest KNOWN locality to a coordinate, or null for non-finite / out-of-range input or a point farther than
 * `SNAP_CUTOFF_KM` from every locality. Never returns or logs the input.
 */
export function snapToLocality(lat: number, lng: number): LocationName | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  let best: string | null = null;
  let bestKm = Infinity;
  for (const loc of KNOWN_LOCALITIES) {
    const km = haversineKm(lat, lng, loc.lat, loc.lng);
    if (km < bestKm) {
      bestKm = km;
      best = loc.name;
    }
  }
  return bestKm <= SNAP_CUTOFF_KM ? best : null;
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
const DECIMAL_PAIR_CAPTURE = /(-?\d{1,3}\.\d+)\s*[,;/ ]\s*(-?\d{1,3}\.\d+)/;

/**
 * The app's OWN display suffix (" · ~500m radius" from older clients, " · ~1–2 km vicinity" from
 * `formatVicinityLabel`), and nothing else: a trainer's own "Besant Nagar · Elliot's Beach" keeps its second
 * half. Mirrored by the `safe_loc` clean-up in supabase/migrations/20261112000300_flexible_locations.sql.
 */
const VICINITY_SUFFIX = /\s*·\s*~?\s*\d+(?:\s*[–-]\s*\d+)?\s*(?:m|km)\b.*$/i;

function cleanLabel(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim()
    .replace(VICINITY_SUFFIX, '')
    .trim();
}

function findKnown(cleaned: string): string | null {
  const lower = cleaned.toLowerCase();
  for (const loc of KNOWN_LOCALITIES) {
    if (loc.name.toLowerCase() === lower) return loc.name;
    if (loc.aliases?.some((a) => a.toLowerCase() === lower)) return loc.name;
  }
  return null;
}

export type CustomLocationChoice =
  | { ok: true; label: LocationName }
  | { ok: false; reason: 'coordinates' | 'too_long' | 'empty' };

/** Applies the label rules to one string and reports why it failed. The single source of truth for them. */
export function customLocationChoice(query: string): CustomLocationChoice {
  if (typeof query !== 'string') return { ok: false, reason: 'empty' };
  const cleaned = cleanLabel(query);
  if (cleaned === '') return { ok: false, reason: 'empty' };
  const known = findKnown(cleaned);
  if (known) return { ok: true, label: known };
  const pair = DECIMAL_PAIR_CAPTURE.exec(cleaned);
  if (pair) {
    const snapped = snapToLocality(Number(pair[1]), Number(pair[2]));
    return snapped ? { ok: true, label: snapped } : { ok: false, reason: 'coordinates' };
  }
  if (looksLikeCoordinates(cleaned)) return { ok: false, reason: 'coordinates' };
  if (cleaned.length > LOCATION_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, label: cleaned };
}

/**
 * Coerces any location-ish string to a place label: a known place (case-insensitive name or alias) becomes its
 * canonical spelling, a custom label is kept as typed (trimmed, whitespace collapsed, control characters
 * removed, at most 60 chars), a decimal coordinate pair is snapped to the nearest KNOWN locality, and any other
 * coordinate-like text is rejected. A legacy " · ~500m radius" display suffix is stripped. On failure it falls
 * back to `fallback`, sanitized by the same rules without a further fallback. Never returns coordinate-like text.
 */
export function sanitizeLocationLabel(input: string, fallback?: string): LocationName | null {
  const first = customLocationChoice(input);
  if (first.ok) return first.label;
  if (fallback === undefined) return null;
  const second = customLocationChoice(fallback);
  return second.ok ? second.label : null;
}

/**
 * Place suggestions for a query: with no query, the original presets followed by a few cities; otherwise
 * case-insensitive prefix matches on a name or alias first, then substring matches, as canonical names.
 */
export function suggestLocalities(query: string, limit = 8): LocationName[] {
  const q = (typeof query === 'string' ? query : '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (q === '') {
    return [...AREAS, 'Puducherry', 'Bengaluru', 'Coimbatore', 'Madurai'].slice(0, limit);
  }
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const loc of KNOWN_LOCALITIES) {
    const names = [loc.name, ...(loc.aliases ?? [])].map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(q))) prefix.push(loc.name);
    else if (names.some((n) => n.includes(q))) contains.push(loc.name);
  }
  return [...new Set([...prefix, ...contains])].slice(0, limit);
}

/** Case-insensitive match key. Mirrors the DB's `listings.loc_key` generated column (`lower(loc)`). */
export function locationKey(label: LocationName): string {
  return label.toLowerCase();
}

export function formatVicinityLabel(label: LocationName): string {
  return `${label} · ${VICINITY_RADIUS_LABEL}`;
}

/**
 * Shared bad-input fixtures: each must be refused (or snapped to a known name) by `sanitizeLocationLabel` and
 * refused by the database CHECK constraints. Keep in sync with supabase/tests/flexible_locations.test.sql.
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
