// Pure (relative imports only) so the unit tests can run it in Node; the React hook lives in `use-vicinity.ts`.
import { bucketCoordinatesToArea, type AreaName } from '../constants/locations';

/** Why a vicinity lookup produced no area. */
export type VicinityFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'out-of-area';

export type VicinityResult = { ok: true; area: AreaName } | { ok: false; reason: VicinityFailure };

/** The slice of the browser Geolocation API this module uses; lets tests pass a fake. */
export interface GeolocationLike {
  getCurrentPosition(
    onSuccess: (position: { coords: { latitude: number; longitude: number } }) => void,
    onError: (error: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

export const VICINITY_FAILURE_MESSAGES: Record<VicinityFailure, string> = {
  unsupported: 'Location lookup is not available on this device.',
  denied: 'Location permission was denied. Pick your neighbourhood from the list instead.',
  unavailable: 'Could not determine your location. Pick your neighbourhood from the list instead.',
  timeout: 'Locating you took too long. Pick your neighbourhood from the list instead.',
  'out-of-area': 'You appear to be outside the supported neighbourhoods. Pick one from the list.',
};

/** The browser Geolocation API when present. React Native has no global `navigator.geolocation` and this
 *  app ships no location module, so on native this is null and the shortcut stays hidden. */
export function getGeolocation(): GeolocationLike | null {
  if (typeof navigator === 'undefined') return null;
  const geo = (navigator as { geolocation?: GeolocationLike }).geolocation;
  return geo ?? null;
}

/** Ask for one coarse fix and turn it into a neighbourhood immediately. The coordinates exist only inside
 *  the success callback: they are bucketed on the spot and never returned, stored, logged or sent. */
export function requestVicinity(geo: GeolocationLike | null = getGeolocation()): Promise<VicinityResult> {
  if (!geo) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        ({ coords }) => {
          const area = bucketCoordinatesToArea(coords.latitude, coords.longitude);
          resolve(area ? { ok: true, area } : { ok: false, reason: 'out-of-area' });
        },
        (error) => resolve({ ok: false, reason: error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable' }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
      );
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
    }
  });
}
