// Provides `localStorage` on native and resolves to a no-op on web. It must stay a static import so it
// is hoisted ahead of the `createClient` call below, which reads that global. The native-only dependency
// is kept out of the web bundle by a platform extension rather than a runtime check — Metro's resolver
// decides that, and a runtime `if` comes far too late; see ./install-local-storage.native.ts.
import './install-local-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)');
}

// Bare regex authority extraction, not `new URL(url).hostname`: React Native's own URL shim
// (Libraries/Blob/URL.js) is a lossy regex polyfill, not a spec parser, and mangles a bracketed
// IPv6 host — this has to behave the same here and in the Node static-export pass below.
function hostOf(rawUrl: string): string {
  // The scheme is optional on purpose: a scheme-less value (`127.0.0.1:54321`) is exactly the kind of
  // .env.local typo this guard exists to catch, and it must still resolve to a host rather than ''.
  const authority = rawUrl.match(/^(?:[a-zA-Z][a-zA-Z\d+.-]*:\/\/)?([^/?#]+)/)?.[1] ?? '';
  const afterUserinfo = authority.slice(authority.lastIndexOf('@') + 1);
  if (afterUserinfo.startsWith('[')) {
    // IPv6 literal, e.g. "[::1]:54321" — the host is the bracketed part, colon-and-all.
    const close = afterUserinfo.indexOf(']');
    return close === -1 ? afterUserinfo : afterUserinfo.slice(0, close + 1);
  }
  const port = afterUserinfo.indexOf(':');
  return port === -1 ? afterUserinfo : afterUserinfo.slice(0, port);
}

// The whole 127.0.0.0/8 block loops back, not just 127.0.0.1, plus localhost, 0.0.0.0 and the IPv6
// loopback. Compared as an exact host, never a substring of the full URL — a hosted project ref that
// happens to contain the word "localhost" must not false-positive.
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

if (__DEV__ && Platform.OS !== 'web' && isLoopbackHost(hostOf(url))) {
  // A physical device (including over a tunnel) reaches the Metro bundler fine, but "localhost" /
  // 127.0.0.1 baked into the JS bundle resolves on the PHONE, not the dev machine — every Supabase
  // call then fails with an opaque network error. This is the one warning that exists to explain
  // that opacity before it costs someone an hour. __DEV__ keeps it out of production bundles.
  console.warn(
    [
      '',
      '================================================================',
      '[supabase] WARNING: You are using localhost for Supabase on a native device.',
      "[supabase] Network requests will fail. Use your machine's LAN IP instead.",
      `[supabase] Configured EXPO_PUBLIC_SUPABASE_URL: ${url}`,
      '[supabase] Find your LAN IP (Windows: `ipconfig`; mac/Linux: `ifconfig` or',
      '[supabase] `ipconfig getifaddr en0`) and put it in .env.local, then restart `expo start`',
      '[supabase] — Expo inlines EXPO_PUBLIC_* at bundle time, so a reload alone will not pick it up.',
      '================================================================',
      '',
    ].join('\n')
  );
}

// app.json sets web.output: 'static', so this module is also evaluated in Node during export,
// where there is no window and no localStorage.
const isStaticRender = Platform.OS === 'web' && typeof window === 'undefined';

// Session storage is unencrypted SQLite: it holds a refresh token, and friend codes are never cached.
export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: isStaticRender ? undefined : localStorage,
    autoRefreshToken: !isStaticRender,
    persistSession: !isStaticRender,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  // Register once: refresh tokens only while the app is foregrounded.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
