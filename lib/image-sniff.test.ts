import { describe, expect, it } from 'vitest';

import { sniffImageMime } from './image-sniff';

const ascii = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')]);
const WAVE = Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVEfmt ')]);

describe('sniffImageMime', () => {
  it('accepts jpeg, png and webp', () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    expect(sniffImageMime(JPEG.buffer.slice(0) as ArrayBuffer)).toBe('image/jpeg');
    expect(sniffImageMime(PNG.buffer.slice(0) as ArrayBuffer)).toBe('image/png');
    expect(sniffImageMime(WEBP.buffer.slice(0) as ArrayBuffer)).toBe('image/webp');
  });

  it('rejects other formats', () => {
    expect(sniffImageMime(ascii('GIF89a......'))).toBeNull();
    expect(sniffImageMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageMime(ascii('%PDF-1.7 ......'))).toBeNull();
    expect(sniffImageMime(WAVE)).toBeNull();
  });

  it('rejects empty and too-short input', () => {
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMime(new ArrayBuffer(0))).toBeNull();
  });
});
