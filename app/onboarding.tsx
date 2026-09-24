import type { AuthError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { ChevronLeft, Mail, ShieldCheck, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PhoneFrame } from '@/components/layout/PhoneFrame';
import { ProfileForm } from '@/components/onboarding/ProfileForm';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import { fetchMyProfile, isProfileReady, type MyProfile } from '@/lib/api/profile';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'new' | 'returning';

function describeAuthError(error: AuthError, mode: Mode): string {
  switch (error.code) {
    case 'email_exists':
    case 'identity_already_exists':
      return 'That email already belongs to a trainer account. Switch to "Returning user" to sign in.';
    case 'signup_disabled':
    case 'otp_disabled':
    case 'user_not_found':
      return mode === 'returning'
        ? 'No trainer account uses that email. Switch to "New trainer" to create one.'
        : error.message;
    case 'email_address_invalid':
    case 'validation_failed':
      return 'That email address was not accepted. Check it and try again.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Request a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'session_not_found':
    case 'session_expired':
      return 'Your session ended. Go back and reopen this screen.';
    default:
      return error.message;
  }
}

/**
 * Two ways in (SUPABASE_PLAN.md §3.4), both ending in the same 6-digit code:
 *  - New trainer: the anonymous session is upgraded in place. `updateUser({ email })` mails the code and
 *    `verifyOtp({ type: 'email_change' })` confirms it. The uid never changes.
 *  - Returning user: `signInWithOtp({ shouldCreateUser: false })` + `verifyOtp({ type: 'email' })` signs
 *    the existing account in on this device, replacing the throwaway anonymous session.
 * Once the session is permanent, a profile without a handle, team and friend code is completed here
 * too, because RLS refuses listings, offers and chat until `private.profile_ready()` holds.
 */
export default function OnboardingScreen() {
  const { user, isAnonymous, isLoading, retry } = useSession();
  const [mode, setMode] = useState<Mode>('new');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'incomplete' | 'error'>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [done, setDone] = useState(false);

  const permanentUserId = user && !isAnonymous ? user.id : null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // A permanent session (just verified, or opened later by someone half-way through setup) either
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

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const requestCode = async (candidate: string) =>
    mode === 'new'
      ? supabase.auth.updateUser({ email: candidate })
      : supabase.auth.signInWithOtp({ email: candidate, options: { shouldCreateUser: false } });

  const sendCode = async () => {
    const candidate = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(candidate)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: sendError } = await requestCode(candidate);
    setBusy(false);
    if (sendError) {
      setError(describeAuthError(sendError, mode));
      return;
    }
    setEmail(candidate);
    setCode('');
    setCooldown(RESEND_COOLDOWN_S);
    setStep('code');
  };

  const resendCode = async () => {
    setBusy(true);
    setError(null);
    // `resend` only knows the email-change flow; a returning user just asks for a fresh sign-in code.
    const { error: resendError } =
      mode === 'new' ? await supabase.auth.resend({ type: 'email_change', email }) : await requestCode(email);
    setBusy(false);
    if (resendError) {
      setError(describeAuthError(resendError, mode));
      return;
    }
    setCooldown(RESEND_COOLDOWN_S);
  };

  const verifyCode = async () => {
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: mode === 'new' ? 'email_change' : 'email',
    });
    setBusy(false);
    if (verifyError) setError(describeAuthError(verifyError, mode));
    // On success the session listener hands us the permanent user and the profile effect above takes over.
  };

  const showProfileStep = permanentUserId !== null;

  let icon = <Mail size={26} color="#04121f" strokeWidth={2.2} />;
  let title = mode === 'new' ? 'Verify your email to trade' : 'Welcome back';
  let subtitle =
    mode === 'new'
      ? 'You can browse right away. Listing, offers and chat need a verified account so blocks and trade history stay with you.'
      : 'Enter the email you signed up with. We will send a 6-digit code to sign you in on this device.';
  if (step === 'code') {
    icon = <ShieldCheck size={26} color="#04121f" strokeWidth={2.2} />;
    title = 'Enter your code';
    subtitle = `We sent a ${OTP_LENGTH}-digit code to ${email}.`;
  }
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
          {showProfileStep ? 'Your profile' : 'Secure your account'}
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
          profileState === 'incomplete' ? (
            <ProfileForm initial={profile} onSaved={() => setDone(true)} />
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
        ) : step === 'email' ? (
          <View className="mt-7 gap-3">
            <ModeToggle mode={mode} onChange={switchMode} disabled={busy} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#6d7690"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              editable={!busy}
              onSubmitEditing={sendCode}
              accessibilityLabel="Email address"
              className="rounded-[14px] border border-border bg-bg-card px-4 py-[14px]"
              style={{ fontSize: 15, color: '#e8ecf5' }}
            />
            {error ? <ErrorText message={error} /> : null}
            <PrimaryButton
              label={busy ? 'Sending…' : 'Send code'}
              style={SURFACE.ctaBlue}
              textColor="#04121f"
              disabled={busy || email.trim().length === 0}
              onPress={sendCode}
            />
          </View>
        ) : (
          <View className="mt-7 gap-3">
            <TextInput
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              placeholder="000000"
              placeholderTextColor="#4a5169"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={OTP_LENGTH}
              editable={!busy}
              onSubmitEditing={code.length === OTP_LENGTH ? verifyCode : undefined}
              accessibilityLabel={`${OTP_LENGTH}-digit verification code`}
              className="rounded-[14px] border border-border bg-bg-card px-4 py-[14px] text-center font-mono-bold"
              style={{ fontSize: 26, letterSpacing: 10, color: '#e8ecf5' }}
            />
            {error ? <ErrorText message={error} /> : null}
            <PrimaryButton
              label={busy ? 'Verifying…' : 'Verify'}
              style={SURFACE.ctaBlue}
              textColor="#04121f"
              disabled={busy || code.length !== OTP_LENGTH}
              onPress={verifyCode}
            />
            {busy ? <ActivityIndicator color="#4fb3ff" /> : null}
            <View className="mt-1 flex-row items-center justify-between">
              <Pressable
                onPress={() => {
                  setStep('email');
                  setError(null);
                }}
                accessibilityRole="button"
                hitSlop={8}
                className="active:opacity-70"
              >
                <Text className="font-display-med text-text-muted" style={{ fontSize: 13 }}>
                  Use a different email
                </Text>
              </Pressable>
              <Pressable
                onPress={resendCode}
                disabled={busy || cooldown > 0}
                accessibilityRole="button"
                hitSlop={8}
                className={cooldown > 0 || busy ? 'opacity-50' : 'active:opacity-70'}
              >
                <Text className="font-display-semi text-accent-blue" style={{ fontSize: 13 }}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </PhoneFrame>
  );
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'new', label: 'New trainer' },
  { value: 'returning', label: 'Returning user' },
];

/** New trainer upgrades this device's anonymous session; a returning user signs in to an existing account. */
function ModeToggle({ mode, onChange, disabled }: { mode: Mode; onChange: (mode: Mode) => void; disabled?: boolean }) {
  return (
    <View
      accessibilityRole="radiogroup"
      className="flex-row gap-1 rounded-[14px] border border-border bg-bg-card p-1"
    >
      {MODES.map(({ value, label }) => {
        const selected = value === mode;
        return (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            className="flex-1 items-center rounded-[10px] py-2.5 active:opacity-80"
            style={selected ? { backgroundColor: 'rgba(79,179,255,.14)' } : undefined}
          >
            <Text className="font-display-semi" style={{ fontSize: 13, color: selected ? '#4fb3ff' : '#8b93a7' }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" className="font-display-med text-accent-danger" style={{ fontSize: 13 }}>
      {message}
    </Text>
  );
}
