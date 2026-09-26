import type { AuthError } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type OAuthProvider = 'google' | 'azure';

/** Supabase requires an explicit scope for Azure; Google's default scopes already cover email. */
const PROVIDER_SCOPES: Partial<Record<OAuthProvider, string>> = {
  azure: 'email',
};

/**
 * `pokegotrades://onboarding` in a dev/standalone build, `exp://…/--/onboarding` in Expo Go, and
 * `<origin>/onboarding` on web — always back to this screen, which owns `completeOAuthRedirect`.
 */
export function redirectUri(): string {
  return makeRedirectUri({ path: 'onboarding' });
}

/** A problem starting or finishing an OAuth sign-in, already phrased for display. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

function describeAuthError(error: AuthError): string {
  switch (error.code) {
    case 'provider_disabled':
      return 'That sign-in method is not available right now. Try the other one.';
    case 'validation_failed':
      // GoTrue's message for an unrecognized/disabled provider name is literally "Unsupported provider".
      return error.message === 'Unsupported provider'
        ? 'That sign-in method is not available right now. Try the other one.'
        : error.message;
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return error.message;
  }
}

/**
 * Every `exchangeCodeForSession` this process has started, keyed by the authorization code. PKCE codes are
 * single-use, and the same code can reach `completeOAuthRedirect` more than once: a StrictMode double-mount,
 * the screen re-rendering before its params are cleared, or Android delivering the `pokegotrades://onboarding`
 * deep link to expo-router AFTER `openAuthSessionAsync` already redeemed it. Entries are kept once settled
 * (a code is a few dozen bytes, and a handful per app run at most), so a late duplicate gets the original
 * outcome instead of a second, failing exchange that would show an error on a successful sign-in.
 */
const exchanges = new Map<string, Promise<void>>();

interface OAuthRedirectParams {
  code?: string | string[] | undefined;
  error?: string | string[] | undefined;
  error_description?: string | string[] | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Finishes an OAuth round trip once the provider has redirected back to `onboarding`, whether that
 * redirect arrived as a web query string or as a native deep link parsed by `Linking.parse`.
 */
export async function completeOAuthRedirect(params: OAuthRedirectParams): Promise<void> {
  const error = first(params.error);
  if (error) {
    const description = first(params.error_description);
    throw new OAuthError(
      error === 'access_denied' ? 'Sign-in was cancelled.' : description ?? 'Sign-in failed. Try again.'
    );
  }

  const code = first(params.code);
  if (!code) return;

  let exchange = exchanges.get(code);
  if (!exchange) {
    exchange = supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) throw new OAuthError(describeAuthError(exchangeError));
    });
    exchanges.set(code, exchange);
  }
  await exchange;
}

/**
 * Starts an OAuth sign-in with Google or Microsoft (Supabase provider name `azure`). This REPLACES
 * whatever anonymous session is active (D9: anonymous users own no data, so there is nothing to
 * migrate) — there is no account linking and no separate "new" vs "returning" mode, because
 * `signInWithOAuth` transparently creates the account on its first use and signs it in after that.
 *
 * Native opens the provider in an ephemeral browser tab and waits for it to redirect back to our own
 * `redirectUri()`; the metro dev server sends `Cross-Origin-Opener-Policy: same-origin`, which breaks
 * popup-based OAuth, so web instead does a full-page redirect and this function returns before the
 * sign-in finishes (the redirect back is handled by `completeOAuthRedirect` on the next page load).
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const redirectTo = redirectUri();
  const scopes = PROVIDER_SCOPES[provider];

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, scopes } });
    if (error) throw new OAuthError(describeAuthError(error));
    return; // The page is navigating away; there is nothing left to do on this side of the redirect.
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true, scopes },
  });
  if (error) throw new OAuthError(describeAuthError(error));
  if (!data.url) throw new OAuthError('Could not start sign-in. Try again.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // Cancel/dismiss: the trainer backed out, not an error.

  const { queryParams } = Linking.parse(result.url);
  await completeOAuthRedirect(queryParams ?? {});
}
