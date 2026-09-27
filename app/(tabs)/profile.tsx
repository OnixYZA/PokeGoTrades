import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, LogOut, Share2, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { PokemonPickerModal } from '@/components/modals/PokemonPickerModal';
import { ShareTradeListModal } from '@/components/modals/ShareTradeListModal';
import { ArsenalGrid } from '@/components/profile/ArsenalGrid';
import { LiveIdentityCard } from '@/components/profile/LiveIdentityCard';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ProfileNotice } from '@/components/profile/ProfileNotice';
import { RepStats } from '@/components/profile/RepStats';
import { TradeHistoryGrid } from '@/components/profile/TradeHistoryGrid';
import { WishlistGrid } from '@/components/profile/WishlistGrid';
import { IconButton } from '@/components/ui/IconButton';
import { findPokemon } from '@/constants/pokedex';
import { trainer } from '@/data/trainer';
import type { CreatureRef, TradeHistoryEntry } from '@/data/types';
import {
  addToArsenal,
  addToWishlist,
  fetchMyArsenal,
  fetchMyProfile,
  fetchMyTradeHistory,
  fetchMyWishlist,
  isProfileReady,
  type MyProfile,
} from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useTradeStore } from '@/store/trade-store';

/** Which grid the "+" button on the live profile opened the picker for. */
type CreatureListKind = 'arsenal' | 'wishlist';

interface MyProfileData {
  status: 'loading' | 'ready' | 'error';
  profile: MyProfile | null;
  arsenal: CreatureRef[];
  wishlist: CreatureRef[];
  tradeHistory: TradeHistoryEntry[];
  error: string | null;
  retry: () => void;
  /** Re-fetches Arsenal + Wishlist + Trade History in place, leaving `status`/`profile` untouched so
   *  the screen the trainer is already looking at doesn't flash back to the loading spinner. Called
   *  both after adding a Pokémon and on tab focus (a trade completed in Chats can add a history row). */
  refresh: () => Promise<void>;
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
  const [wishlist, setWishlist] = useState<CreatureRef[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  // Shared by `load` and `refresh` below: whichever fetch resolves last for the *current* permanent
  // user wins, the same guard `lib/use-feed.ts` uses for the feed.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (!permanentUserId) return;
    const request = ++latestRequest.current;
    setStatus('loading');
    setError(null);
    try {
      const [nextProfile, nextArsenal, nextWishlist, nextTradeHistory] = await Promise.all([
        fetchMyProfile(),
        fetchMyArsenal(),
        fetchMyWishlist(),
        fetchMyTradeHistory(),
      ]);
      if (request !== latestRequest.current) return; // a newer load started while this one was in flight
      setProfile(nextProfile);
      setArsenal(nextArsenal);
      setWishlist(nextWishlist);
      setTradeHistory(nextTradeHistory);
      setStatus('ready');
    } catch (reason) {
      if (request !== latestRequest.current) return;
      setError(reason instanceof Error ? reason.message : 'Could not load your profile.');
      setStatus('error');
    }
  }, [permanentUserId]);

  // Called after adding a Pokémon, and on tab focus: only Arsenal/Wishlist/Trade History can have
  // changed (the profile identity fields haven't), so only those three are re-read — and
  // `status`/`profile` are never touched, so the screen stays exactly as it was instead of dropping
  // back to the loading spinner mid-scroll.
  const refresh = useCallback(async () => {
    if (!permanentUserId) return;
    const request = ++latestRequest.current;
    try {
      const [nextArsenal, nextWishlist, nextTradeHistory] = await Promise.all([
        fetchMyArsenal(),
        fetchMyWishlist(),
        fetchMyTradeHistory(),
      ]);
      if (request !== latestRequest.current) return;
      setArsenal(nextArsenal);
      setWishlist(nextWishlist);
      setTradeHistory(nextTradeHistory);
    } catch (reason) {
      if (request !== latestRequest.current) return;
      toast(reason instanceof Error ? reason.message : 'Could not refresh your profile.');
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
      setWishlist([]);
      setTradeHistory([]);
      setStatus('loading');
      setError(null);
    }
  }, [permanentUserId, load]);

  return { status, profile, arsenal, wishlist, tradeHistory, error, retry: load, refresh };
}

export default function ProfileScreen() {
  const { user, isAnonymous, error: sessionError, retry: retrySession, signOut } = useSession();
  const resetTradeStore = useTradeStore((s) => s.reset);
  const [signingOut, setSigningOut] = useState(false);
  // Which grid's "+" button opened the picker, if any — also doubles as the picker's `visible` flag.
  const [pickerFor, setPickerFor] = useState<CreatureListKind | null>(null);
  // Blocks a second selection from firing a second insert while the first is still in flight; the
  // picker itself is already closed by then (see `addPokemon`), so this only guards a fast re-open.
  const [addingCreature, setAddingCreature] = useState(false);
  // "Share trade list" (Task 2B) — gates the modal below; there's nothing else to track here since
  // Arsenal/Wishlist stay out of the store (AGENTS.md) and the modal reads them straight off `shareData`.
  const [shareVisible, setShareVisible] = useState(false);

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

  const goToOnboarding = () => router.push('/onboarding');

  const showSignOut = USE_SUPABASE && !isAnonymous && !!user;

  // Re-reads the lists + trade history whenever the tab regains focus, so a trade just completed in
  // Chats shows up here. `useFocusEffect` re-runs whenever its callback's identity changes, so the
  // callback depends only on `live.refresh` (stable per `permanentUserId`) and reads `status` through
  // a ref: depending on `live.status` would re-fire a redundant refresh the instant the first load
  // lands on 'ready'.
  const statusRef = useRef(live.status);
  statusRef.current = live.status;

  useFocusEffect(
    useCallback(() => {
      // Only once the initial `load()` has actually settled: `refresh()` bumps the same
      // `latestRequest` counter `load()` uses, so calling it while that first load is still in flight
      // would make the load's own result look stale and get silently discarded — the screen would then
      // sit on its loading spinner forever, since nothing else ever flips `status` to 'ready'.
      if (statusRef.current === 'ready') void live.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [live.refresh]),
  );

  /** Shared by both grids' pickers: add the chosen Pokémon, refresh in place, then toast. Errors
   *  (an unknown id, a full list, a lost race on the last free slot) surface the same way. */
  const addPokemon = async (list: CreatureListKind, pokemonId: number, shiny: boolean) => {
    if (addingCreature) return;
    const entry = findPokemon(pokemonId);
    const listLabel = list === 'arsenal' ? 'Arsenal' : 'Wishlist';
    const displayName = entry ? (shiny ? `Shiny ${entry.name}` : entry.name) : 'That Pokémon';
    setAddingCreature(true);
    try {
      await (list === 'arsenal' ? addToArsenal(pokemonId, shiny) : addToWishlist(pokemonId, shiny));
      await live.refresh();
      toast(`${displayName} added to your ${listLabel}`, 'success');
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : `Could not add that Pokémon to your ${listLabel}.`, 'error');
    } finally {
      setAddingCreature(false);
    }
  };

  const handleSelectPokemon = (pokemonId: number, shiny: boolean) => {
    const list = pickerFor;
    setPickerFor(null); // close before the toast — see lib/toast.ts on modals and their own ToastHost
    if (list) void addPokemon(list, pokemonId, shiny);
  };

  // What "Share trade list" needs — only ever available in the two branches below that actually have
  // both lists loaded (the mock trainer, and a live profile that's finished onboarding). `null`
  // everywhere else, which is also everywhere the button itself is never rendered.
  const shareData =
    !USE_SUPABASE
      ? { handle: trainer.handle, team: trainer.team, level: trainer.lvl, arsenal: trainer.arsenal, wishlist: trainer.wishlist }
      : live.profile && isProfileReady(live.profile)
        ? { handle: live.profile.handle, team: live.profile.team, level: undefined, arsenal: live.arsenal, wishlist: live.wishlist }
        : null;

  let body: ReactNode;
  if (!USE_SUPABASE) {
    // Mock data source: there is no write path (no Supabase table to insert into), so no `onEdit` is
    // passed — the grids hide their "+" button entirely rather than opening a picker that can't work.
    body = (
      <>
        <ProfileHero trainer={trainer} />
        <RepStats trainer={trainer} />
        <ArsenalGrid arsenal={trainer.arsenal} />
        <WishlistGrid wishlist={trainer.wishlist} />
        <ShareTradeListButton onPress={() => setShareVisible(true)} />
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
        body="You're browsing as a guest. Sign in to set up a trainer profile — your Arsenal, Wishlist and trade history will live here."
        actionLabel="Sign in"
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
    // Ready: real handle/team, real arsenal, real wishlist, real trade history (`my_trade_history`).
    // Rep, streak and bio still have no live source, so those are left out rather than filled with
    // invented numbers — see LiveIdentityCard's own comment.
    body = (
      <>
        <LiveIdentityCard profile={live.profile} />
        <ArsenalGrid arsenal={live.arsenal} onEdit={() => setPickerFor('arsenal')} />
        <WishlistGrid wishlist={live.wishlist} onEdit={() => setPickerFor('wishlist')} />
        <ShareTradeListButton onPress={() => setShareVisible(true)} />
        <TradeHistoryGrid history={live.tradeHistory} />
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

      {/* Mounted unconditionally: `pickerFor` can only ever be set from the live "ready" branch above,
       *  so this is inert (closed) in every other state. */}
      <PokemonPickerModal
        visible={pickerFor !== null}
        title={pickerFor === 'wishlist' ? 'Add to Wishlist' : 'Add to Arsenal'}
        onClose={() => setPickerFor(null)}
        onSelect={handleSelectPokemon}
        exclude={pickerFor === 'wishlist' ? live.wishlist : live.arsenal}
      />

      {/* Only ever mounted with real data: `shareData` is null in every branch that doesn't render the
       *  button above, so `shareVisible` can never be true without it. */}
      {shareData && (
        <Modal visible={shareVisible} animationType="slide" onRequestClose={() => setShareVisible(false)}>
          <ShareTradeListModal
            handle={shareData.handle}
            team={shareData.team}
            level={shareData.level}
            arsenal={shareData.arsenal}
            wishlist={shareData.wishlist}
            onClose={() => setShareVisible(false)}
          />
        </Modal>
      )}
    </View>
  );
}

/** "Share trade list" (Task 2B): exports the Arsenal + Wishlist grids above as a single PNG. Sits right
 *  under both grids in both branches that render it — see the two call sites above. */
function ShareTradeListButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Share trade list"
      className="mb-[22px] flex-row items-center justify-center gap-2 rounded-2xl border border-border-strong bg-bg-card py-3 active:opacity-80"
    >
      <Share2 size={15} color="#4fb3ff" />
      <Text className="font-display text-accent-blue" style={{ fontSize: 13 }}>
        Share trade list
      </Text>
    </Pressable>
  );
}
