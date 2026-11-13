/**
 * Pure API client for Photon location search and BigDataCloud / Photon reverse-geocoding.
 * Zero React Native imports (relative imports only) so Node / Vitest tests can run it directly.
 */
import {
  coarsenCoords,
  formatPlaceLabel,
  isAllLocations,
  locationKey,
  looksLikeCoordinates,
  sanitizeLocationLabel,
  type LocationName,
  type PlaceComponents,
} from '../constants/locations';

export const DEFAULT_PHOTON_BASE_URL = 'https://photon.komoot.io';
export const BIGDATACLOUD_REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
export const REQUEST_TIMEOUT_MS = 4500;
export const CACHE_TTL_MS = 10 * 60_000;
export const MAX_CACHE_ENTRIES = 60;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlLruCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  get(key: string): { hit: true; value: T } | { hit: false } {
    const entry = this.store.get(key);
    if (!entry) return { hit: false };
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return { hit: false };
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return { hit: true, value: entry.value };
  }

  set(key: string, value: T): void {
    this.store.delete(key);
    if (this.store.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  clear(): void {
    this.store.clear();
  }
}

const searchCache = new TtlLruCache<LocationName[]>();
const reverseCache = new TtlLruCache<LocationName | null>();

export function clearLocationApiCache(): void {
  searchCache.clear();
  reverseCache.clear();
}

function resolvePhotonBaseUrl(override?: string): string {
  const envUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_LOCATION_API_URL : undefined;
  const raw = (override ?? envUrl ?? DEFAULT_PHOTON_BASE_URL).trim();
  return (raw || DEFAULT_PHOTON_BASE_URL).replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch = fetch,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
      throw externalSignal.reason instanceof Error ? externalSignal.reason : new Error('Aborted');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`Location request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

interface PhotonResponse {
  features?: {
    properties?: PlaceComponents | null;
  }[];
}

function parsePhotonFeatures(data: PhotonResponse | null | undefined, limit?: number): LocationName[] {
  const features = Array.isArray(data?.features) ? data.features : [];
  const results: LocationName[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    if (!feature?.properties) continue;
    const formatted = formatPlaceLabel(feature.properties);
    const label = formatted ? sanitizeLocationLabel(formatted) : null;
    if (!label) continue;
    const key = locationKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(label);
    if (limit !== undefined && results.length >= limit) break;
  }

  return results;
}

export async function searchLocations(
  query: string,
  options?: { signal?: AbortSignal; limit?: number; fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<LocationName[]> {
  if (typeof query !== 'string') return [];
  const trimmed = query.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2 || looksLikeCoordinates(trimmed) || isAllLocations(trimmed)) {
    return [];
  }

  const limit = options?.limit ?? 8;
  const baseUrl = resolvePhotonBaseUrl(options?.baseUrl);
  const cacheKey = `${baseUrl}|${limit}|${trimmed.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached.hit) return [...cached.value];

  const url = `${baseUrl}/api?q=${encodeURIComponent(trimmed)}&lang=en&limit=${limit}&layer=city&layer=district&layer=locality`;
  const response = await fetchWithTimeout(url, options?.fetchImpl, options?.signal);
  if (!response.ok) {
    throw new Error(`Location search failed with status ${response.status}`);
  }
  const data = (await response.json()) as PhotonResponse;
  const results = parsePhotonFeatures(data, limit);
  searchCache.set(cacheKey, results);
  return [...results];
}

interface BigDataCloudResponse {
  countryCode?: string | null;
  locality?: string | null;
  city?: string | null;
  principalSubdivision?: string | null;
}

export async function reverseGeocodeVicinity(
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<LocationName | null> {
  const coarse = coarsenCoords(lat, lng);
  if (!coarse) return null;

  const baseUrl = resolvePhotonBaseUrl(options?.baseUrl);
  const coarseKey = `${coarse.lat.toFixed(2)},${coarse.lng.toFixed(2)}`;
  const cacheKey = `${baseUrl}|${coarseKey}`;
  const cached = reverseCache.get(cacheKey);
  if (cached.hit) return cached.value;

  const fetchImpl = options?.fetchImpl ?? fetch;

  let bdcSucceeded = false;
  let bdcLabel: LocationName | null = null;
  let bdcError: unknown = null;

  try {
    const bdcUrl = `${BIGDATACLOUD_REVERSE_URL}?latitude=${coarse.lat}&longitude=${coarse.lng}&localityLanguage=en`;
    const res = await fetchWithTimeout(bdcUrl, fetchImpl, options?.signal);
    if (!res.ok) {
      throw new Error(`BigDataCloud reverse geocode failed with status ${res.status}`);
    }
    bdcSucceeded = true;
    const data = (await res.json()) as BigDataCloudResponse;
    if (data && (data.countryCode || data.city || data.principalSubdivision)) {
      const formatted = formatPlaceLabel({
        locality: data.locality,
        city: data.city,
        state: data.principalSubdivision,
      });
      bdcLabel = formatted ? sanitizeLocationLabel(formatted) : null;
    }
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    bdcError = error;
  }

  if (bdcLabel !== null) {
    reverseCache.set(cacheKey, bdcLabel);
    return bdcLabel;
  }

  // Fallback to Photon reverse when BigDataCloud failed or returned no locality.
  try {
    const photonUrl = `${baseUrl}/reverse?lat=${coarse.lat}&lon=${coarse.lng}&lang=en&radius=10&layer=locality&layer=district&layer=city`;
    const res = await fetchWithTimeout(photonUrl, fetchImpl, options?.signal);
    if (!res.ok) {
      throw new Error(`Photon reverse geocode failed with status ${res.status}`);
    }
    const data = (await res.json()) as PhotonResponse;
    const label = parsePhotonFeatures(data, 1)[0] ?? null;
    reverseCache.set(cacheKey, label);
    return label;
  } catch (photonError) {
    if (options?.signal?.aborted) throw photonError;
    // If BigDataCloud already returned HTTP 200 with no locality (e.g. ocean 0,0), treat as out-of-area.
    if (bdcSucceeded) {
      reverseCache.set(cacheKey, null);
      return null;
    }
    throw new Error(
      `Reverse geocoding failed: ${bdcError instanceof Error ? bdcError.message : String(bdcError)}; ${photonError instanceof Error ? photonError.message : String(photonError)}`,
    );
  }
}
