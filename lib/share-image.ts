/**
 * Captures the visible `TradeListCard` (components/share/TradeListCard.tsx) and hands the PNG to the
 * native share sheet. iOS / Android; `lib/share-image.web.ts` is Metro's pick when bundling for web —
 * same exported signature, so `components/modals/ShareTradeListModal.tsx` can import either one
 * without caring which it got.
 *
 * https://docs.expo.dev/versions/v57.0.0/sdk/captureRef/ — the only documented options this needs are
 * `format`, `result` and `width`/`height`. `width` alone is not enough: the underlying native module
 * reads both keys through `RCTConvert CGSize:`, which zero-fills a key that isn't in the JS object at
 * all, and then — because it treats *any* dimension under 0.1 as "not really provided" — throws the
 * whole size away and falls back to the view's own natural bounds, silently ignoring the width too.
 * Passing an explicit `height` (derived from `canvasHeight`, the same total
 * `constants/trade-list-layout.ts`'s `computeTradeListLayout` gave `TradeListCard` to size itself)
 * sidesteps that: it's how the output stays exactly `SHARE_IMAGE_OUTPUT_WIDTH` px wide on every device,
 * per `PixelRatio` or not.
 *
 * https://docs.expo.dev/versions/v57.0.0/sdk/sharing/ — `shareAsync`'s completion handler on iOS
 * "resolves unconditionally" whether the trainer picked a target or dismissed the sheet, and Android's
 * `ACTION_SEND` chooser has no cancellation signal to report in the first place — so a cancelled share
 * is never an error here; nothing extra to catch.
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { SHARE_IMAGE_OUTPUT_WIDTH, SHARE_IMAGE_SCALE } from '@/constants/trade-list-layout';

export type ShareTradeListResult = { ok: true } | { ok: false; message: string };

/**
 * @param cardRef Ref to `TradeListCard`'s root View (that component forwards it). Typed
 *   `RefObject<View | null>`, not `RefObject<View>`: that's what `useRef<View>(null)` actually
 *   produces (React 19's `useRef` overloads resolve a literal `null` argument to
 *   `RefObject<T | null>`, not `RefObject<T>` — see @types/react's `useRef` overloads).
 * @param canvasHeight `computeTradeListLayout(arsenal, wishlist).canvasHeight` — in pt, at the card's
 *   own fixed width — so the captured image's aspect ratio always matches what's on screen.
 */
export async function shareTradeListImage(
  cardRef: RefObject<View | null>,
  canvasHeight: number,
): Promise<ShareTradeListResult> {
  try {
    const uri = await captureRef(cardRef, {
      format: 'png',
      result: 'tmpfile',
      width: SHARE_IMAGE_OUTPUT_WIDTH,
      height: Math.round(canvasHeight * SHARE_IMAGE_SCALE),
    });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Share trade list',
    });
    return { ok: true };
  } catch (reason) {
    return { ok: false, message: reason instanceof Error ? reason.message : 'Could not share the trade list image.' };
  }
}
