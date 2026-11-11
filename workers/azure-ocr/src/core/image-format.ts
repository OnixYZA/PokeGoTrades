/**
 * Detects the real image format from the leading bytes. The buckets' MIME allowlist only trusts the client's
 * Content-Type header, so this is the real gate before sharp or tesseract see an upload. Mirrors the app-side
 * check in `lib/image-sniff.ts` (UX only); keep the two in sync.
 */
export function sniffImageFormat(image: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return 'jpeg';
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (image.length >= 12 && image.toString('latin1', 0, 4) === 'RIFF' && image.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}
