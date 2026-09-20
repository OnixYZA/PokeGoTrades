/**
 * iOS / Android: install the SQLite-backed `localStorage` global that supabase-js stores its session in.
 *
 * This is split across two files on purpose, and the reason is about Metro's *resolver*, not runtime.
 *
 * Neither `import 'expo-sqlite/localStorage/install'` nor `if (Platform.OS !== 'web') require(...)` keeps
 * this off the web. Metro builds its dependency graph by statically scanning for import/require call
 * sites, so a runtime `Platform` check does not stop it walking into the module: it follows the require,
 * finds the web Worker that expo-sqlite declares (`expo-sqlite/web/worker.ts`), and the dev server then
 * fails to serve that chunk — `Worker chunk not found`, HTTP 500, before a line of app code executes.
 * (The production export happens to survive it, which is why `expo export -p web` looks fine while
 * `expo start --web` is broken — a difference that makes this easy to misdiagnose.)
 *
 * A `.native` platform extension is resolved by Metro *before* any file is read. Bundling for web picks
 * ./install-local-storage.ts, which names no native module, so the worker is never discovered. Native
 * builds pick this file.
 *
 * Keep this as a static import: `lib/supabase.ts` reads `localStorage` while creating its client, so the
 * global has to exist by then, and a static import is hoisted ahead of that module's body.
 */
import 'expo-sqlite/localStorage/install';
