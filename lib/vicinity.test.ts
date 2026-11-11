import { describe, expect, it, vi } from 'vitest';

import { KNOWN_LOCALITIES } from '../constants/locations';
import { requestVicinity, type GeolocationLike } from './vicinity';

const fake = (impl: GeolocationLike['getCurrentPosition']): GeolocationLike => ({
  getCurrentPosition: impl,
});

describe('requestVicinity', () => {
  it('reports unsupported without a geolocation API', async () => {
    expect(await requestVicinity(null)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps error code %i to %s', async (code, reason) => {
    const geo = fake((_ok, fail) => fail({ code }));
    expect(await requestVicinity(geo)).toEqual({ ok: false, reason });
  });

  it('asks for a coarse, time-boxed fix', async () => {
    const spy = vi.fn<GeolocationLike['getCurrentPosition']>((_ok, fail) => fail({ code: 2 }));
    await requestVicinity(fake(spy));
    const options = spy.mock.calls[0][2]!;
    expect(options.enableHighAccuracy).toBe(false);
    expect(options.timeout ?? 0).toBeGreaterThan(0);
  });

  it('is out-of-area far from every supported neighbourhood', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 0, longitude: 0 } }));
    expect(await requestVicinity(geo)).toEqual({ ok: false, reason: 'out-of-area' });
  });

  it('never returns coordinates, only a locality name', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 13.0067, longitude: 80.2574 } }));
    const result = await requestVicinity(geo);
    if (result.ok) expect(KNOWN_LOCALITIES.map((l) => l.name)).toContain(result.area);
    expect(JSON.stringify(result)).not.toMatch(/13\.0067|80\.2574/);
  });
});
