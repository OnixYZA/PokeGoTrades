import { Image } from 'expo-image';
import { useCallback, useRef } from 'react';

const LOGO = require('@/assets/images/logo.png');

interface BrandLogoProps {
  size: number;
  /** Fires at most once, when the bitmap has loaded or failed — `TradeListCard` counts it toward its
   *  export-ready gate the same way it counts sprite tiles, so a capture never catches a blank badge. */
  onSettled?: () => void;
}

/** The PokeGoTrades badge — the same art as the app icon and favicon, cut out as a transparent circle. */
export function BrandLogo({ size, onSettled }: BrandLogoProps) {
  const settledRef = useRef(false);
  const settle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSettled?.();
  }, [onSettled]);

  return (
    <Image
      source={LOGO}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel="PokeGoTrades"
      onLoad={settle}
      onError={settle}
    />
  );
}
