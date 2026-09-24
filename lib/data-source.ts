/**
 * Temporary migration switch (SUPABASE_PLAN.md §4.6, Phase 1): lets screens move from the local
 * mock store to Supabase one at a time. Read with dot access only — Expo inlines
 * `process.env.EXPO_PUBLIC_*` at bundle time, so restart the dev server after changing it.
 *
 *   EXPO_PUBLIC_DATA_SOURCE=supabase   feed + listing creation use Supabase
 *   EXPO_PUBLIC_DATA_SOURCE=mock       (default) everything stays on the local mock store
 *
 * Deleted in Phase 5, when the module-load seeding goes away.
 */
export type DataSource = 'mock' | 'supabase';

export const DATA_SOURCE: DataSource = process.env.EXPO_PUBLIC_DATA_SOURCE === 'supabase' ? 'supabase' : 'mock';

export const USE_SUPABASE = DATA_SOURCE === 'supabase';
