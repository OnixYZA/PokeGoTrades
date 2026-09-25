import { router } from 'expo-router';
import { ChevronLeft, LogOut, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { ArsenalGrid } from '@/components/profile/ArsenalGrid';
import { LiveIdentityCard } from '@/components/profile/LiveIdentityCard';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ProfileNotice } from '@/components/profile/ProfileNotice';
import { RepStats } from '@/components/profile/RepStats';
import { TradeHistoryGrid } from '@/components/profile/TradeHistoryGrid';
import { WishlistGrid } from '@/components/profile/WishlistGrid';
import { IconButton } from '@/components/ui/IconButton';
import { trainer } from '@/data/trainer';
import type { CreatureRef } from '@/data/types';
import { fetchMyArsenal, fetchMyProfile, isProfileReady, type MyProfile } from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useTradeStore } from '@/store/trade-store';

interface MyProfileData {
  status: 'loading' | 'ready' | 'error';
  profile: MyProfile | null;
  arsenal: CreatureRef[];
  error: string | null;
  retry: () => void;
}

/**
 * Live profile + arsenal for the signed-in trainer. Refetches whenever `permanentUserId` changes,
 * which covers both onboarding's anonymous -> permanent upgrade (same uid, `isAnonymous` flips) and
 * a returning-user sign-in (a different uid). Guards the same race `lib/use-feed.ts` guards for the
 * feed — a fetch resolving after a newer one already started — with the same `latestRequest` ref.
 */
function useMyProfileData(permanentUserId: string | null): MyProfileData {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [arsenal, setArsenal] = useState<CreatureRef[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (!permanentUserId) return;
    const request = ++latestRequest.current;
    setStatus('loading');
    setError(null);
    try {
      const [nextProfile, nextArsenal] = await Promise.all([fetchMyProfile(), fetchMyArsenal()]);
      if (request !== latestRequest.current) return; // a newer load started while this one was in flight
      setProfile(nextProfile);
      setArsenal(nextArsenal);
      setStatus('ready');
    } catch (reason) {
      if (request !== latestRequest.current) return;
      setError(reason instanceof Error ? reason.message : 'Could not load your profile.');
      setStatus('error');
    }
  }, [permanentUserId]);

  useEffect(() => {
    if (permanentUserId) {
      void load();
    } else {
      // Anonymous, or the session bootstrap failed outright: nothing to show, and a previous
      // permanent session's data (e.g. right after sign-out) must not linger unseen in state.
      latestRequest.current++; // invalidate any load already in flight for the old user
      setProfile(null);
      setArsenal([]);
      setStatus('loading');
      setError(null);
    }
  }, [permanentUserId, load]);

  return { status, profile, arsenal, error, retry: load };
}

export default function ProfileScreen() {
  const { user, isAnonymous, error: sessionError, retry: retrySession, signOut } = useSession();
  const resetTradeStore = useTradeStore((s) => s.reset);
  const [signingOut, setSigningOut] = useState(false);

  // Same uid through the anonymous -> permanent upgrade, a new uid for a returning-user sign-in —
  // either way this is the one value the live fetch below needs to key off.
  const permanentUserId = USE_SUPABASE && user && !isAnonymous ? user.id : null;
  const live = useMyProfileData(permanentUserId);

  // Once ANY session lands again (even the fresh anonymous one) this is no longer "signing out" —
  // stops the brief post-sign-out gap from reading as a failed bootstrap (see the `!user` case below).
  // Also clears on `sessionError`: if the post-sign-out anonymous re-sign-in itself fails (dead
  // network right after `signOut()` resolves), no `user` is ever coming without a retry, and without
  // this the screen would sit on the spinner forever instead of reaching the "Retry" notice below.
  useEffect(() => {
    if (user || sessionError) setSigningOut(false);
  }, [user, sessionError]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // Belt-and-braces: `LiveSync`'s own effect clears this too once the session's uid changes, but
      // that only happens after the new anonymous sign-in round-trips — do it here as well so chat/lock
      // state for the old trainer can never be read again in between (AGENTS.md: state + chats UI stay in sync).
      resetTradeStore();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Could not sign out. Try again.');
      setSigningOut(false);
    }
  };

  const editComingSoon = () => toast('Coming soon', 'info');
  const goToOnboarding = () => router.push('/onboarding');

  const showSignOut = USE_SUPABASE && !isAnonymous && !!user;

  let body: ReactNode;
  if (!USE_SUPABASE) {
    // Mock data source: unchanged from before this screen knew about sessions at all.
    body = (
      <>
        <ProfileHero trainer={trainer} />
        <RepStats trainer={trainer} />
        <ArsenalGrid arsenal={trainer.arsenal} onEdit={editComingSoon} />
        <WishlistGrid wishlist={trainer.wishlist} onEdit={editComingSoon} />
        <TradeHistoryGrid history={trainer.tradeHistory} />
      </>
    );
  } else if (!user) {
    // No session at all: either the first-launch bootstrap failed, or we just signed out and the
    // fresh anonymous sign-in hasn't landed yet — the latter clears itself in a moment, so show a
    // spinner instead of an alarming "could not connect" message while `signingOut` is still true.
    body = signingOut ? (
      <ActivityIndicator color="#4fb3ff" style={{ marginTop: 32 }} />
    ) : (
      <ProfileNotice
        title="Could not start a session"
        body="Check your connection and try again."
        actionLabel="Retry"
        onAction={retrySession}
      />
    );
  } else if (isAnonymous) {
    body = (
      <ProfileNotice
        icon={<UserRound size={26} color="#04121f" strokeWidth={2.2} />}
        title="Unregistered"
        body="You're browsing as a guest. Verify your email to set up a trainer profile — your Arsenal, Wishlist and trade history will live here."
        actionLabel="Verify account"
        onAction={goToOnboarding}
      />
    );
  } else if (live.status === 'loading') {
    body = <ActivityIndicator color="#4fb3ff" style={{ marginTop: 32 }} />;
  } else if (live.status === 'error') {
    body = (
      <ProfileNotice
        title="Couldn't load your profile"
        body={live.error ?? 'Something went wrong.'}
        actionLabel="Retry"
        onAction={live.retry}
      />
    );
  } else if (!live.profile || !isProfileReady(live.profile)) {
    // Verified but never finished the handle/team/friend-code step in onboarding.
    body = (
      <ProfileNotice
        icon={<UserRound size={26} color="#04121f" strokeWidth={2.2} />}
        title="Almost there"
        body="Finish setting up your trainer profile — a handle, a team and a friend code — to see your Arsenal and Wishlist here."
        actionLabel="Finish setup"
        onAction={goToOnboarding}
      />
    );
  } else {
    // Ready: real handle/team and real arsenal. Rep, streak, bio and trade history have no live
    // source yet (only `fetchMyProfile`/`fetchMyArsenal` exist), so those sections are left out
    // rather than filled with invented numbers — see LiveIdentityCard's own comment.
    body = (
      <>
        <LiveIdentityCard profile={live.profile} />
        <ArsenalGrid arsenal={live.arsenal} onEdit={editComingSoon} />
        <WishlistGrid wishlist={[]} onEdit={editComingSoon} />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header with back button */}
      <View className="flex-row items-center gap-2.5 border-b border-border-subtle px-4 pb-3 pt-1.5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          className="h-8 w-8 items-center justify-center active:opacity-70"
        >
          <ChevronLeft size={20} color="#8b93a7" />
        </Pressable>
        <Text className="flex-1 font-display text-text-primary" style={{ fontSize: 15 }}>
          My Profile
        </Text>
        {showSignOut && (
          <IconButton size={34} radius={12} accessibilityLabel="Log out" onPress={() => void handleSignOut()}>
            <LogOut size={16} color="#8b93a7" />
          </IconButton>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}
