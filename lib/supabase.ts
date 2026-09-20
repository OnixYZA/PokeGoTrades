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
