import { describe, expect, it, vi } from 'vitest';

import { requestVicinity, type GeolocationLike, type VicinityResolver } from './vicinity';

const fake = (impl: GeolocationLike['getCurrentPosition']): GeolocationLike => ({
  getCurrentPosition: impl,
});

describe('requestVicinity', () => {
  it('reports unsupported without a geolocation API', async () => {
    const resolver = vi.fn<VicinityResolver>();
    expect(await requestVicinity(null, resolver)).toEqual({ ok: false, reason: 'unsupported' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps error code %i to %s', async (code, reason) => {
    const geo = fake((_ok, fail) => fail({ code }));
    const resolver = vi.fn<VicinityResolver>();
    expect(await requestVicinity(geo, resolver)).toEqual({ ok: false, reason });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('asks for a coarse, time-boxed fix', async () => {
    const spy = vi.fn<GeolocationLike['getCurrentPosition']>((_ok, fail) => fail({ code: 2 }));
    await requestVicinity(fake(spy), vi.fn<VicinityResolver>());
    const options = spy.mock.calls[0][2]!;
    expect(options.enableHighAccuracy).toBe(false);
    expect(options.timeout ?? 0).toBeGreaterThan(0);
  });

  it('coarsens coordinates on-device so raw GPS never reaches resolver or result', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 13.0067, longitude: 80.2574 } }));
    const resolver = vi.fn<VicinityResolver>(async () => 'Adyar, Chennai');

    const result = await requestVicinity(geo, resolver);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(13.01, 80.26);
    expect(result).toEqual({ ok: true, area: 'Adyar, Chennai' });
    expect(JSON.stringify(result)).not.toMatch(/13\.0067|80\.2574/);
  });

  it('reports out-of-area when resolver returns null', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 0.001, longitude: 0.002 } }));
    const resolver = vi.fn<VicinityResolver>(async () => null);

    expect(await requestVicinity(geo, resolver)).toEqual({ ok: false, reason: 'out-of-area' });
    expect(resolver).toHaveBeenCalledWith(0, 0);
  });

  it('reports unavailable when resolver rejects', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 12.9716, longitude: 77.5946 } }));
    const resolver = vi.fn<VicinityResolver>(async () => {
      throw new Error('network error');
    });

    expect(await requestVicinity(geo, resolver)).toEqual({ ok: false, reason: 'unavailable' });
    expect(resolver).toHaveBeenCalledWith(12.97, 77.59);
  });

  it('reports unavailable without calling resolver when coordinates are invalid', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: NaN, longitude: 77.5946 } }));
    const resolver = vi.fn<VicinityResolver>();

    expect(await requestVicinity(geo, resolver)).toEqual({ ok: false, reason: 'unavailable' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects coordinate-like or reserved labels returned by a resolver', async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 12.9716, longitude: 77.5946 } }));
    expect(await requestVicinity(geo, async () => '12.9716, 77.5946')).toEqual({ ok: false, reason: 'out-of-area' });
    expect(await requestVicinity(geo, async () => 'All locations')).toEqual({ ok: false, reason: 'out-of-area' });
  });
});
