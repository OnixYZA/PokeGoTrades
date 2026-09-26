import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, LogIn, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { PhoneFrame } from '@/components/layout/PhoneFrame';
import { ProfileProofStep } from '@/components/onboarding/ProfileProofStep';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import { fetchMyProfile, isProfileReady, type MyProfile } from '@/lib/api/profile';
import { completeOAuthRedirect, signInWithProvider, type OAuthProvider } from '@/lib/auth';
import { useSession } from '@/lib/session';

const SECONDARY_BUTTON_STYLE = { ...SURFACE.card, borderWidth: 1, borderColor: '#1a2032' };

/**
 * Two steps, neither of them email OTP:
 *  - Sign-in: `signInWithProvider` (lib/auth.ts) sends the trainer to Google or Microsoft (Entra ID,
 *    Supabase provider `azure`) via `signInWithOAuth`, which REPLACES the anonymous session outright
 *    (D9: an anonymous session owns no data, so there is nothing to migrate). The provider redirects
 *    back here — as a web query string or, cold-start on Android, as this same route reopened from the
 *    `pokegotrades://onboarding` deep link — and `completeOAuthRedirect` below finishes the exchange.
 *  - Profile: `ProfileProofStep` handles "screenshot first, manual fallback" — a trainer uploads their
 *    My Trainer Code screenshot for OCR, or drops into the plain `ProfileForm` if that doesn't pan out.
 * Once the profile has a handle, team and friend code, `private.profile_ready()` holds and RLS starts
 * allowing listings, offers and chat.
 */
export default function OnboardingScreen() {
  const { user, isAnonymous, isLoading, retry } = useSession();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();

  const [completingOAuth, setCompletingOAuth] = useState(() => Boolean(params.code || params.error));
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'incomplete' | 'error'>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [done, setDone] = useState(false);

  const permanentUserId = user && !isAnonymous ? user.id : null;

  // The web return and the Android cold-start deep link both land here as `?code=…` (or `?error=…`).
  // A warm native app already finished the exchange inside `signInWithProvider` itself; if a deep-link
  // event fires anyway, `completeOAuthRedirect`'s code-dedupe map makes the second call a no-op.
  useEffect(() => {
    if (!params.code && !params.error) return;
    let active = true;
    setCompletingOAuth(true);
    completeOAuthRedirect(params)
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Sign-in failed. Try again.');
      })
      .finally(() => {
        if (!active) return;
        setCompletingOAuth(false);
        // Clear the one-time redirect params so a refresh/back doesn't replay the exchange or leave
        // them sitting in the URL; `undefined` drops a key rather than setting it to the string "undefined".
        router.setParams({ code: undefined, error: undefined, error_description: undefined });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.error, params.error_description]);

  // A permanent session (just signed in, or opened later by someone half-way through setup) either
  // has a ready profile and is done, or lands on the profile step.
  useEffect(() => {
    if (!permanentUserId) {
      setProfileState('idle');
      return;
    }
    let active = true;
    setProfileState('loading');
    fetchMyProfile()
      .then((loaded) => {
        if (!active) return;
        setProfile(loaded);
        if (isProfileReady(loaded)) setDone(true);
        else setProfileState('incomplete');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setProfileError(reason instanceof Error ? reason.message : 'Could not load your profile.');
        setProfileState('error');
      });
    return () => {
      active = false;
    };
  }, [permanentUserId, profileAttempt]);

  // Pops back to the tabs screen that opened onboarding (or replaces to it when opened by URL),
  // rather than stacking a second copy of it the way a <Redirect> would.
  useEffect(() => {
    if (done) router.dismissTo('/');
  }, [done]);

  if (done) return null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const signIn = async (next: OAuthProvider) => {
    setProvider(next);
    setError(null);
    try {
      await signInWithProvider(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed. Try again.');
    } finally {
      setProvider(null);
    }
  };

  const showProfileStep = permanentUserId !== null;

  let icon = <LogIn size={26} color="#04121f" strokeWidth={2.2} />;
  let title = 'Sign in to trade';
  let subtitle =
    'You can browse right away. Listing, offers and chat need a signed-in account so blocks and trade history stay with you.';
  if (showProfileStep) {
    icon = <UserRound size={26} color="#04121f" strokeWidth={2.2} />;
    title = 'Set up your trainer profile';
    subtitle = 'One last step. Other trainers see your name and team; your friend code is shared only when you lock a trade.';
  }

  return (
    <PhoneFrame>
      <View className="flex-row items-center gap-2.5 border-b border-border-subtle px-4 pb-3 pt-1.5">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          className="h-8 w-8 items-center justify-center active:opacity-70"
        >
          <ChevronLeft size={20} color="#8b93a7" />
        </Pressable>
        <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
          {showProfileStep ? 'Your profile' : 'Sign in'}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 28, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5 h-14 w-14 items-center justify-center rounded-full" style={SURFACE.avatarHero}>
          {icon}
        </View>

        <Text className="font-display text-text-primary" style={{ fontSize: 22, letterSpacing: -0.3 }}>
          {title}
        </Text>
        <Text className="mt-2 font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
          {subtitle}
        </Text>

        {showProfileStep ? (
          profileState === 'incomplete' && profile ? (
            <ProfileProofStep profile={profile} onReady={() => setDone(true)} />
          ) : profileState === 'error' ? (
            <View className="mt-7 gap-3">
              <ErrorText message={profileError ?? 'Could not load your profile.'} />
              <PrimaryButton
                label="Retry"
                style={SURFACE.ctaBlue}
                textColor="#04121f"
                onPress={() => setProfileAttempt((n) => n + 1)}
              />
            </View>
          ) : (
            <ActivityIndicator color="#4fb3ff" style={{ marginTop: 32 }} />
          )
        ) : !isLoading && !user ? (
          <View className="mt-7 gap-3">
            <ErrorText message="Could not start a session. Check your connection." />
            <PrimaryButton label="Retry" style={SURFACE.ctaBlue} textColor="#04121f" onPress={retry} />
          </View>
        ) : completingOAuth ? (
          <View className="mt-7 items-center gap-3">
            <ActivityIndicator color="#4fb3ff" />
            <Text className="font-display-med text-text-muted" style={{ fontSize: 13 }}>
              Completing sign-in…
            </Text>
          </View>
        ) : (
          <View className="mt-7 gap-3">
            {error ? <ErrorText message={error} /> : null}
            <PrimaryButton
              label={provider === 'google' ? 'Opening Google…' : 'Continue with Google'}
              style={SURFACE.ctaBlue}
              textColor="#04121f"
              disabled={provider !== null}
              onPress={() => signIn('google')}
            />
            <PrimaryButton
              label={provider === 'azure' ? 'Opening Microsoft…' : 'Continue with Microsoft'}
              style={SECONDARY_BUTTON_STYLE}
              textColor="#e8ecf5"
              disabled={provider !== null}
              onPress={() => signIn('azure')}
            />
            {provider ? <ActivityIndicator color="#4fb3ff" /> : null}
          </View>
        )}
      </ScrollView>
    </PhoneFrame>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" className="font-display-med text-accent-danger" style={{ fontSize: 13 }}>
      {message}
    </Text>
  );
}
