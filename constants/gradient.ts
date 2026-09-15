/**
 * `experimental_backgroundImage` (native's only CSS-gradient style prop) has proven unreliable
 * on Android — observed rendering solid black instead of the gradient, stomping the fallback
 * `backgroundColor` underneath it. Native gets the solid fallback only, full stop; the gradient
 * string is used solely on web, where `backgroundImage` is a stable, standard CSS property.
 */
import { Platform, type ViewStyle } from 'react-native';

export function gradient(css: string, fallback: string): ViewStyle {
  if (Platform.OS !== 'web') {
    return { backgroundColor: fallback };
  }
  return { backgroundColor: fallback, backgroundImage: css };
}
