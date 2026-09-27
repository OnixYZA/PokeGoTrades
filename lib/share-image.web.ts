/**
 * Web counterpart to `lib/share-image.ts` — same exported signature; Metro picks this file
 * automatically when bundling for web (same convention as e.g. `lib/install-local-storage.native.ts`
 * being the override there and the bare `.ts` the default — here it's the reverse: this `.web.ts`
 * overrides the native-effective `lib/share-image.ts`).
 *
 * https://docs.expo.dev/versions/v57.0.0/sdk/captureRef/ documents no web support at all, but the
 * installed `react-native-view-shot@5.1.0` ships its own web implementation
 * (`node_modules/react-native-view-shot/src/RNViewShot.web.ts`, built on `html2canvas`) that Metro
 * resolves the same way it resolves this file — so `captureRef` from `'react-native-view-shot'` just
 * works here unchanged, and `html-to-image` was never needed.
 *
 * https://docs.expo.dev/versions/v57.0.0/sdk/sharing/ is explicit that `expo-sharing` "cannot share
 * local file URIs on web" and needs the page served over HTTPS — so this file never imports
 * `expo-sharing` at all. It goes straight to the Web Share API with a `File`, falling back to a plain
 * `<a download>` when the API (or sharing actual files specifically) isn't there.
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { SHARE_IMAGE_OUTPUT_WIDTH, SHARE_IMAGE_SCALE } from '@/constants/trade-list-layout';

export type ShareTradeListResult = { ok: true } | { ok: false; message: string };

const FILE_NAME = 'pokegotrades-trade-list.png';

/** The web `captureRef` (see this file's header comment) returns a `data:image/png;base64,...` URI
 *  even when asked for `result: 'tmpfile'` (that result isn't implemented on web, so it warns once and
 *  falls back to the same thing `'data-uri'` returns) — both the Web Share API's `files` and the
 *  `<a download>` fallback below need an actual `Blob`, not a string, so this decodes it into one. */
function dataUriToBlob(dataUri: string): Blob {
  const [header, base64 = ''] = dataUri.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Last-resort fallback: no Web Share API, or it can't take files (older Safari/Firefox desktop). */
function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = FILE_NAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked on a delay, not immediately: some browsers cancel an in-flight download if the blob URL
  // backing it disappears right away.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * @param cardRef Ref to `TradeListCard`'s root View (that component forwards it). Typed
 *   `RefObject<View | null>` — see `lib/share-image.ts`'s matching doc comment on why (React 19's
 *   `useRef<View>(null)` produces exactly this, not `RefObject<View>`). React Native Web forwards a
 *   `View`'s ref straight to its underlying DOM node, which is exactly what the web `captureRef`
 *   (html2canvas) expects to be handed.
 * @param canvasHeight `computeTradeListLayout(arsenal, wishlist).canvasHeight` — see
 *   `lib/share-image.ts`'s matching doc comment for why this (not width alone) is what pins the
 *   output to `SHARE_IMAGE_OUTPUT_WIDTH` px.
 */
export async function shareTradeListImage(
  cardRef: RefObject<View | null>,
  canvasHeight: number,
): Promise<ShareTradeListResult> {
  let dataUri: string;
  try {
    // `useCORS: true` is baked into the web captureRef implementation; combined with Supabase
    // Storage's public-object endpoint (`lib/sprite-url.ts`'s sprite host) serving a permissive
    // `access-control-allow-origin: *` on every response, the canvas this draws into is never
    // tainted, so the `toDataURL` inside `captureRef` below doesn't throw. (metro.config.js's
    // COEP/COOP response headers are for expo-sqlite's SharedArrayBuffer use and irrelevant here —
    // canvas tainting is governed entirely by the *image's own* CORS headers, not the page's.)
    dataUri = await captureRef(cardRef, {
      format: 'png',
      result: 'tmpfile',
      width: SHARE_IMAGE_OUTPUT_WIDTH,
      height: Math.round(canvasHeight * SHARE_IMAGE_SCALE),
    });
  } catch (reason) {
    return { ok: false, message: reason instanceof Error ? reason.message : 'Could not render the trade list image.' };
  }

  const blob = dataUriToBlob(dataUri);

  const shareApiAvailable =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

  if (shareApiAvailable) {
    const file = new File([blob], FILE_NAME, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'PokeGoTrades trade list' });
        return { ok: true };
      } catch (reason) {
        // The trainer closing the share sheet without picking a target is an AbortError, not a failure.
        if (reason instanceof Error && reason.name === 'AbortError') return { ok: true };
        return { ok: false, message: 'Could not share the trade list image.' };
      }
    }
  }

  try {
    downloadBlob(blob);
    return { ok: true };
  } catch (reason) {
    return { ok: false, message: reason instanceof Error ? reason.message : 'Could not download the trade list image.' };
  }
}
