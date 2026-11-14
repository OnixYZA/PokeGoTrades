import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sniffImageFormat } from '../src/core/image-format';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const WAVE = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt ')]);

describe('sniffImageFormat', () => {
  it('accepts jpeg, png and webp', () => {
    assert.equal(sniffImageFormat(JPEG), 'jpeg');
    assert.equal(sniffImageFormat(PNG), 'png');
    assert.equal(sniffImageFormat(WEBP), 'webp');
  });

  it('rejects other formats', () => {
    assert.equal(sniffImageFormat(Buffer.from('GIF89a......')), null);
    assert.equal(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(sniffImageFormat(Buffer.from('%PDF-1.7 ......')), null);
    assert.equal(sniffImageFormat(WAVE), null);
  });

  it('rejects empty and too-short input', () => {
    assert.equal(sniffImageFormat(Buffer.alloc(0)), null);
    assert.equal(sniffImageFormat(Buffer.from([0xff, 0xd8])), null);
  });
});
