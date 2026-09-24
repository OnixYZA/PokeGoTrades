import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

/** A first launch on a dead network must not hold the splash screen forever. */
const BOOTSTRAP_TIMEOUT_MS = 10_000;

interface SessionContextValue {
  session: Session | null;
  user: User | null;
  /** True until the stored session was read and, when there was none, the anonymous sign-in settled. */
  isLoading: boolean;
  /** Anonymous sessions can browse; writes need the email upgrade (D9). */
  isAnonymous: boolean;
  /** Set when the first-launch anonymous sign-in failed. The app still renders; call `retry`. */
  error: Error | null;
  retry: () => void;
  /**
   * Ends the current session. The `onAuthStateChange` listener below reacts to the resulting
   * `SIGNED_OUT` event the same way it does on first launch: it bumps `attempt`, so a fresh
   * anonymous session starts right away and the app never sits in a signed-out limbo.
   */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out reaching the server.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      }
    );
  });
}

async function ensureSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session;

  const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
  if (anonError) throw anonError;
  return anon.session;
}

// Shared across effect runs: React StrictMode mounts effects twice in dev, and two concurrent
// getSession() calls would each see "no session" and create two anonymous users.
let inFlight: Promise<Session | null> | null = null;

function bootstrapSession(): Promise<Session | null> {
  inFlight ??= withTimeout(ensureSession(), BOOTSTRAP_TIMEOUT_MS).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Owns the Supabase auth session. On first launch there is none, so it signs in anonymously
 * (SUPABASE_PLAN.md §3.4): every read needs an `authenticated` JWT. The email OTP upgrade in
 * `app/onboarding.tsx` keeps the same uid, so nothing has to migrate.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    bootstrapSession()
      .then((next) => {
        if (!active) return;
        setSession(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    // Do not await other supabase-js calls in this callback: auth-js holds a lock while it runs.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Nothing is granted to `anon`, so a signed-out app has nothing to read: start a fresh anonymous session.
      if (event === 'SIGNED_OUT') setAttempt((n) => n + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isAnonymous: session?.user.is_anonymous ?? false,
      error,
      retry,
      signOut,
    }),
    [session, isLoading, error, retry, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
