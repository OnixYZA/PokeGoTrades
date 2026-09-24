import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Config } from './env';

/** A service-role client: no session to persist or refresh, since there is no user. */
export function createServiceClient(config: Pick<Config, 'supabaseUrl' | 'serviceRoleKey'>): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
