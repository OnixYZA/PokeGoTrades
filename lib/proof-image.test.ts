import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  os: 'web' as 'web' | 'ios' | 'android',
  launchImageLibraryAsync: vi.fn(),
  fileArrayBuffer: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockState.os;
    },
  },
}));

vi.mock('expo-file-system', () => ({
  File: class MockFile {
    constructor(public uri: string) {}
    arrayBuffer() {
      return mockState.fileArrayBuffer(this.uri);
    }
  },
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mockState.launchImageLibraryAsync,
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));

import { sniffImageMime } from '@/lib/image-sniff';
import {
  isUnreadableFileError,
  pickProofImage,
  PROOF_MAX_BYTES,
  ProofImageError,
  readProofBytes,
  type PickedProof,
} from '@/lib/proof-image';

const ascii = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

function makeBuffer(bytes: Uint8Array, totalLength = bytes.length): ArrayBuffer {
  const buf = new ArrayBuffer(totalLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_HEADER = Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')]);

describe('proof-image', () => {
  beforeEach(() => {
    mockState.os = 'web';
    mockState.launchImageLibraryAsync.mockReset();
    mockState.fileArrayBuffer.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('sniffImageMime', () => {
    it('detects valid JPEG, PNG, and WebP headers and returns null for truncated or unknown bytes', () => {
      expect(sniffImageMime(JPEG_HEADER)).toBe('image/jpeg');
      expect(sniffImageMime(PNG_HEADER)).toBe('image/png');
      expect(sniffImageMime(WEBP_HEADER)).toBe('image/webp');

      expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
      expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
      expect(sniffImageMime(ascii('RIFF1234WEB'))).toBeNull();
      expect(sniffImageMime(ascii('GIF89a......'))).toBeNull();
      expect(sniffImageMime(new ArrayBuffer(0))).toBeNull();
    });
  });

  describe('isUnreadableFileError', () => {
    it('recognizes NotFoundError, NotReadableError, and matching messages', () => {
      expect(
        isUnreadableFileError(
          new DOMException(
            'A requested file or directory could not be found at the time an operation was processed.',
            'NotFoundError'
          )
        )
      ).toBe(true);
      expect(isUnreadableFileError({ name: 'NotReadableError', message: 'permission lost' })).toBe(true);
      expect(isUnreadableFileError(new Error('The file could not be found on disk'))).toBe(true);
      expect(isUnreadableFileError(new Error('Network request failed'))).toBe(false);
      expect(isUnreadableFileError(null)).toBe(false);
    });
  });

  describe('readProofBytes', () => {
    it('uses pre-cached proof.bytes without touching proof.webFile.arrayBuffer() even if webFile rejects with NotFoundError', async () => {
      const cachedBytes = makeBuffer(PNG_HEADER);
      const arrayBufferSpy = vi
        .fn()
        .mockRejectedValue(
          new DOMException(
            'A requested file or directory could not be found at the time an operation was processed.',
            'NotFoundError'
          )
        );
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const proof: PickedProof = {
        uri: 'blob:https://example.test/expired',
        filename: 'proof.png',
        contentType: 'image/png',
        sizeBytes: cachedBytes.byteLength,
        webFile: { arrayBuffer: arrayBufferSpy } as unknown as Blob,
        bytes: cachedBytes,
      };

      const result = await readProofBytes(proof);
      expect(result).toEqual({ data: cachedBytes, contentType: 'image/png' });
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockState.fileArrayBuffer).not.toHaveBeenCalled();
    });

    it('throws ProofImageError when proof.bytes exceeds PROOF_MAX_BYTES or has non-image magic bytes', async () => {
      const oversizedBytes = makeBuffer(JPEG_HEADER, PROOF_MAX_BYTES + 1);
      const oversizedProof: PickedProof = {
        uri: 'blob:https://example.test/huge',
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        sizeBytes: oversizedBytes.byteLength,
        bytes: oversizedBytes,
      };

      await expect(readProofBytes(oversizedProof)).rejects.toThrow(ProofImageError);
      await expect(readProofBytes(oversizedProof)).rejects.toThrow(/limit is 5 MB/i);

      const nonImageBytes = makeBuffer(ascii('%PDF-1.7 invalid'));
      const nonImageProof: PickedProof = {
        uri: 'blob:https://example.test/not-an-image',
        filename: 'fake.png',
        contentType: 'image/png',
        sizeBytes: nonImageBytes.byteLength,
        bytes: nonImageBytes,
      };

      await expect(readProofBytes(nonImageProof)).rejects.toThrow(ProofImageError);
      await expect(readProofBytes(nonImageProof)).rejects.toThrow(/not a JPEG, PNG or WebP image/i);
    });

    it('converts NotFoundError from webFile.arrayBuffer() into a user-friendly ProofImageError when proof.bytes is absent', async () => {
      const arrayBufferSpy = vi
        .fn()
        .mockRejectedValue(
          new DOMException(
            'A requested file or directory could not be found at the time an operation was processed.',
            'NotFoundError'
          )
        );

      const proof: PickedProof = {
        uri: 'blob:https://example.test/expired',
        filename: 'proof.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1234,
        webFile: { arrayBuffer: arrayBufferSpy } as unknown as Blob,
      };

      const promise = readProofBytes(proof);
      await expect(promise).rejects.toBeInstanceOf(ProofImageError);
      await expect(promise).rejects.toThrow(/Could not read that photo from your device/i);
      expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('pickProofImage on web', () => {
    it('eagerly caches bytes from asset.file.arrayBuffer() and sets contentType from magic-byte sniffing', async () => {
      const webpBytes = makeBuffer(WEBP_HEADER);
      const arrayBufferSpy = vi.fn().mockResolvedValue(webpBytes);
      const fakeFile = { arrayBuffer: arrayBufferSpy } as unknown as File;

      mockState.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'blob:https://example.test/123',
            fileName: 'screenshot.png',
            mimeType: 'application/octet-stream',
            fileSize: webpBytes.byteLength,
            file: fakeFile,
          },
        ],
      });

      const picked = await pickProofImage();
      expect(picked).toEqual({
        uri: 'blob:https://example.test/123',
        filename: 'screenshot.png',
        contentType: 'image/webp',
        sizeBytes: webpBytes.byteLength,
        webFile: fakeFile,
        bytes: webpBytes,
      });
      expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    });

    it('wraps pick-time NotFoundError in ProofImageError', async () => {
      const arrayBufferSpy = vi
        .fn()
        .mockRejectedValue(
          new DOMException(
            'A requested file or directory could not be found at the time an operation was processed.',
            'NotFoundError'
          )
        );

      mockState.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'blob:https://example.test/456',
            fileName: 'screenshot.jpg',
            mimeType: 'image/jpeg',
            file: { arrayBuffer: arrayBufferSpy } as unknown as File,
          },
        ],
      });

      const promise = pickProofImage();
      await expect(promise).rejects.toBeInstanceOf(ProofImageError);
      await expect(promise).rejects.toThrow(/Could not read that photo from your device/i);
    });

    it('rejects > 5 MB or non-image bytes right at pick time', async () => {
      // Case 1: asset.fileSize exceeds limit before even reading bytes
      mockState.launchImageLibraryAsync.mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: 'blob:https://example.test/too-big-meta',
            fileName: 'big.jpg',
            fileSize: PROOF_MAX_BYTES + 10,
            file: { arrayBuffer: vi.fn() } as unknown as File,
          },
        ],
      });
      await expect(pickProofImage()).rejects.toThrow(/limit is 5 MB/i);

      // Case 2: actual bytes exceed limit when fileSize was omitted
      const oversizedBytes = makeBuffer(PNG_HEADER, PROOF_MAX_BYTES + 1);
      mockState.launchImageLibraryAsync.mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: 'blob:https://example.test/too-big-bytes',
            fileName: 'big.png',
            file: { arrayBuffer: vi.fn().mockResolvedValue(oversizedBytes) } as unknown as File,
          },
        ],
      });
      await expect(pickProofImage()).rejects.toThrow(/limit is 5 MB/i);

      // Case 3: non-image magic bytes
      const fakeBytes = makeBuffer(ascii('GIF89a......'));
      mockState.launchImageLibraryAsync.mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: 'blob:https://example.test/gif',
            fileName: 'anim.jpg',
            mimeType: 'image/jpeg',
            file: { arrayBuffer: vi.fn().mockResolvedValue(fakeBytes) } as unknown as File,
          },
        ],
      });
      await expect(pickProofImage()).rejects.toThrow(/not a JPEG, PNG or WebP image/i);
    });
  });
});
