/**
 * React Native's New Architecture only paints CSS gradients on native platforms via the
 * `experimental_backgroundImage` style prop; plain `backgroundImage` is a web-only alias
 * (see expo/types/react-native-web.d.ts) that native silently ignores. This picks the prop
 * that actually renders per platform and always sets `backgroundColor` as a solid fallback.
 */
import { Platform, type ViewStyle } from 'react-native';

export function gradient(css: string, fallback: string): ViewStyle {
  return Platform.OS === 'web'
    ? { backgroundColor: fallback, backgroundImage: css }
    : { backgroundColor: fallback, experimental_backgroundImage: css };
}
