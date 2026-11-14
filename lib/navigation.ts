import { router, type Href } from 'expo-router';

/**
 * The one way "back" in this app. A bare `router.back()` does nothing when there is no history (a deep link or a
 * web reload straight onto the screen), which soft-locks whatever was trying to close. Fall back to a known route.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
