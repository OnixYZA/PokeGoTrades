import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BIGDATACLOUD_REVERSE_URL,
  DEFAULT_PHOTON_BASE_URL,
  clearLocationApiCache,
  reverseGeocodeVicinity,
  searchLocations,
} from './location-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearLocationApiCache();
});

describe('searchLocations', () => {
  it('skips short queries, coordinates, and All locations without calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await searchLocations('', { fetchImpl })).toEqual([]);
    expect(await searchLocations('a', { fetchImpl })).toEqual([]);
    expect(await searchLocations('13.0012, 80.2565', { fetchImpl })).toEqual([]);
    expect(await searchLocations('7JFJ+2V', { fetchImpl })).toEqual([]);
    expect(await searchLocations('All locations', { fetchImpl })).toEqual([]);
    expect(await searchLocations('  all locations ', { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls Photon with layer params (never osm_tag), formats aliases, and deduplicates case-insensitively', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        features: [
          { properties: { name: 'Indiranagar', city: 'Bangalore', state: 'Karnataka' } },
          { properties: { name: 'indiranagar', city: 'Bengaluru Urban', state: 'Karnataka' } },
          { properties: { name: 'Bengaluru', city: 'Bangalore', state: 'Karnataka' } },
          { properties: { name: '12.9716, 77.5946' } },
        ],
      }),
    );

    const results = await searchLocations('Indiranagar', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain(`${DEFAULT_PHOTON_BASE_URL}/api?`);
    expect(calledUrl).toContain('q=Indiranagar');
    expect(calledUrl).toContain('layer=city&layer=district&layer=locality');
    expect(calledUrl).not.toContain('osm_tag');
    expect(results).toEqual(['Indiranagar, Bengaluru', 'Bengaluru']);
  });

  it('supports custom baseUrl and caches identical queries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        features: [{ properties: { name: 'Koramangala', city: 'Bengaluru' } }],
      }),
    );

    const first = await searchLocations('Kora', { fetchImpl, baseUrl: 'https://geo.example.com/' });
    const second = await searchLocations('  kora ', { fetchImpl, baseUrl: 'https://geo.example.com' });

    expect(first).toEqual(['Koramangala, Bengaluru']);
    expect(second).toEqual(['Koramangala, Bengaluru']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('https://geo.example.com/api?');
  });

  it('throws on non-OK HTTP responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'rate limit' }, 429));
    await expect(searchLocations('Bengaluru', { fetchImpl })).rejects.toThrow(/429/);
  });
});

describe('reverseGeocodeVicinity', () => {
  it('returns null without fetching for invalid coordinates', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await reverseGeocodeVicinity(NaN, 80, { fetchImpl })).toBeNull();
    expect(await reverseGeocodeVicinity(91, 80, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('coarsens coordinates to 2 decimals before issuing any network request and uses BigDataCloud primary', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        countryCode: 'IN',
        locality: 'Adyar',
        city: 'Chennai',
        principalSubdivision: 'Tamil Nadu',
      }),
    );

    const area = await reverseGeocodeVicinity(13.0067, 80.2574, { fetchImpl });
    expect(area).toBe('Adyar, Chennai');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain(BIGDATACLOUD_REVERSE_URL);
    expect(url).toContain('latitude=13.01');
    expect(url).toContain('longitude=80.26');
    expect(url).not.toContain('13.0067');
    expect(url).not.toContain('80.2574');
  });

  it('falls back to Photon reverse when BigDataCloud fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith(BIGDATACLOUD_REVERSE_URL)) {
        return jsonResponse({ error: 'down' }, 503);
      }
      return jsonResponse({
        features: [{ properties: { name: 'Indiranagar', city: 'Bangalore', state: 'Karnataka' } }],
      });
    });

    const area = await reverseGeocodeVicinity(12.9784, 77.6408, { fetchImpl });
    expect(area).toBe('Indiranagar, Bengaluru');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const photonUrl = String(fetchImpl.mock.calls[1][0]);
    expect(photonUrl).toContain(`${DEFAULT_PHOTON_BASE_URL}/reverse?`);
    expect(photonUrl).toContain('lat=12.98&lon=77.64');
    expect(photonUrl).toContain('layer=locality&layer=district&layer=city');
  });

  it('returns null (out-of-area) and caches when endpoints return HTTP 200 with no locality (e.g. ocean 0,0)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith(BIGDATACLOUD_REVERSE_URL)) {
        return jsonResponse({ countryCode: '', locality: '', city: '', principalSubdivision: '' });
      }
      return jsonResponse({ features: [] });
    });

    expect(await reverseGeocodeVicinity(0, 0, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Cached null should not re-fetch.
    expect(await reverseGeocodeVicinity(0.001, -0.002, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws when both BigDataCloud and Photon fail', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('network down');
    });

    await expect(reverseGeocodeVicinity(12.97, 77.59, { fetchImpl })).rejects.toThrow(/Reverse geocoding failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caches reverse results by coarsened key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        countryCode: 'IN',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        principalSubdivision: 'Karnataka',
      }),
    );

    expect(await reverseGeocodeVicinity(12.971, 77.641, { fetchImpl })).toBe('Indiranagar, Bengaluru');
    // Same coarsened bucket (12.97, 77.64):
    expect(await reverseGeocodeVicinity(12.974, 77.638, { fetchImpl })).toBe('Indiranagar, Bengaluru');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
