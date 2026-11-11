export type SniffedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Detects the real image format from the leading bytes. The buckets' MIME allowlist only trusts the client's
 * Content-Type header, so the app checks the bytes before upload (UX). The OCR worker checks again on the server
 * (`workers/azure-ocr/src/core/image-format.ts`), which is the real gate. Keep the two in sync.
 */
export function sniffImageMime(bytes: ArrayBuffer | Uint8Array): SniffedImageMime | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte)
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    [0x52, 0x49, 0x46, 0x46].every((byte, i) => b[i] === byte) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, i) => b[8 + i] === byte)
  ) {
    return 'image/webp';
  }
  return null;
}
