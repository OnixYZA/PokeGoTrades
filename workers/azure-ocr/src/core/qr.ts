import jsQR from 'jsqr';
import sharp from 'sharp';

/**
 * The longest side a QR scan is downscaled to before decoding. The "My Trainer Code" screen's QR block is a
 * small fraction of a phone screenshot, and jsQR locates finder patterns by scanning rows of pixels: on a full
 * multi-megapixel screenshot that is a lot of scanning for a code that is legible at a few hundred pixels
 * across. This keeps decode time bounded without touching recall — a real QR code is not visually fine enough
 * to lose at this size, and if it does, `interpretProfile` falls back to the OCR-read friend code anyway.
 */
const MAX_QR_SIDE = 1600;

/**
 * Reads a QR code out of a proof screenshot, if the screen shows one. Called from `src/core/process.ts` after
 * the shared `measure()` pixel-count guard has already accepted the image, so this never has to defend against
 * a decoder bomb on its own — that check is the one place `MAX_PIXELS` is enforced.
 *
 * Returns the raw payload string, or `null` when there is no code, the image cannot be decoded, or anything
 * else goes wrong. This function must never throw: a QR miss is routine (many trainers will screenshot a
 * different profile screen with no QR block at all) and simply means `interpretProfile` reads the friend code
 * from OCR text instead. A thrown error here would turn "no QR code on this screen" into a released-for-retry
 * proof that can never succeed, since retrying decodes the same bytes the same way.
 */
export async function decodeProfileQr(image: Buffer): Promise<string | null> {
  try {
    const rotated = sharp(image, { limitInputPixels: false }).rotate(); // apply EXIF orientation before measuring
    const { width, height } = await rotated.metadata();
    if (!width || !height) return null;

    const longest = Math.max(width, height);
    const scale = longest > MAX_QR_SIDE ? MAX_QR_SIDE / longest : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const { data, info } = await rotated
      .resize(targetWidth, targetHeight, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    const code = jsQR(rgba, info.width, info.height);
    return code?.data ?? null;
  } catch {
    return null;
  }
}
