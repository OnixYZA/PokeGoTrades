import { useEffect, useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Bolt, Car, CircleDot, Clock, Dumbbell, MapPin, Ruler, Send, Trash2, Trophy, X, Zap } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafeMeetZone } from '@/components/profile/SafeMeetZone';
import { LookingForRow } from '@/components/listing/LookingForRow';
import { StardustCard } from '@/components/listing/StardustCard';
import { BuyerOfferModal } from '@/components/modals/BuyerOfferModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { DynamaxBadge } from '@/components/ui/DynamaxBadge';
import { GigantamaxBadge } from '@/components/ui/GigantamaxBadge';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { ShinyGlint } from '@/components/ui/ShinyGlint';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Sprite } from '@/components/ui/Sprite';
import { BackgroundBadge, hasSpecialBackground } from '@/components/ui/BackgroundBadge';
import { StatTile } from '@/components/ui/StatTile';
import { ToastHost } from '@/components/ui/ToastHost';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { creatureHue } from '@/constants/pokedex';
import { hueHeroBleed, SURFACE } from '@/constants/theme';
import { demandTier, marketLabel } from '@/constants/market';
import { POKEBALL_LABELS, TRADE_TIMELINE_LABELS } from '@/constants/listing-attributes';
import { formatVicinityLabel } from '@/constants/locations';
import { getPostingReadiness } from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';
import { creatureDisplayName, creatureFormLabel, formatCp } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { withdrawRefusal } from '@/store/listing-lifecycle';
import { useTradeStore } from '@/store/trade-store';

const SHEET_TRAVEL = 900;
const DISMISS_THRESHOLD = 120;

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useTradeStore((s) => (id ? s.listings[id] : undefined));
  const me = useTradeStore((s) => s.me);
  const subscribeToListing = useTradeStore((s) => s.subscribeToListing);
  const insets = useSafeAreaInsets();
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showMeetup, setShowMeetup] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawListing = useTradeStore((s) => s.withdrawListing);
  // A lock can live only in `lockByListing` (the mock, or a live `lock` event ahead of its `listing_status`), so
  // the withdraw control reads it too, through the same `withdrawRefusal` rule the store enforces.
  const lockHeld = useTradeStore((s) => (id ? s.lockByListing[id] !== undefined : false));

  const translateY = useSharedValue(SHEET_TRAVEL);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    overlayOpacity.value = withTiming(1, { duration: 260 });
  }, [translateY, overlayOpacity]);

  // Supabase: follow this listing live, so "Make Offer" disables itself the moment it locks, completes or
  // is withdrawn. Only for a server-backed listing; the channel is authorized for open / locked ones.
  const serverBacked = listing?.sellerId !== undefined;
  useEffect(() => {
    if (!USE_SUPABASE || !id || !serverBacked) return;
    return subscribeToListing(id);
  }, [id, serverBacked, subscribeToListing]);

  const defaultNavigate = () => goBack('/');

  // Closing is single-fire and guaranteed. `closingRef` (JS) and `isClosing` (worklet) stop a second tap or a
  // drag from restarting the animation; navigation runs once from `flushNav`, fired by the animation callback
  // whether or not it `finished`, with a timer as the backstop if the callback never runs at all.
  const closingRef = useRef(false);
  const isClosing = useSharedValue(false);
  const navigatedRef = useRef(false);
  const pendingNavRef = useRef<(() => void) | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      // Unmounted (e.g. a hardware back mid-animation): the screen is already gone, so a late animation
      // callback must not navigate again and pop the screen underneath.
      navigatedRef.current = true;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    [],
  );

  const flushNav = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    (pendingNavRef.current ?? defaultNavigate)();
  };

  const close = (navigate?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    isClosing.value = true;
    pendingNavRef.current = navigate ?? defaultNavigate;
    translateY.value = withTiming(SHEET_TRAVEL, { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    overlayOpacity.value = withTiming(0, { duration: 200 }, () => {
      runOnJS(flushNav)();
    });
    fallbackTimerRef.current = setTimeout(flushNav, 350);
  };

  const dragGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (isClosing.value) return;
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (isClosing.value) return;
      if (e.translationY > DISMISS_THRESHOLD) {
        runOnJS(close)();
      } else {
        translateY.value = withTiming(0, { duration: 180, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  if (!listing) return null;

  // The modal runs `open_offer` itself and hands back the chat it opened (or created locally, with the mock).
  const handleOffered = (chatId: string) => {
    setShowOfferModal(false);
    close(() => router.dismissTo(`/chats/${chatId}`));
  };

  // Writes need a verified account with a finished profile, so send anyone who is not there yet to
  // onboarding rather than into a sheet the server would refuse.
  const startOffer = async () => {
    if (USE_SUPABASE) {
      try {
        if ((await getPostingReadiness()) !== 'ready') {
          router.push('/onboarding');
          return;
        }
      } catch {
        toast('Could not check your account. Check your connection and try again.');
        return;
      }
    }
    setShowOfferModal(true);
  };

  // With Supabase the button reflects the listing's real state: yours, no longer open, or fair game.
  // The mock has no accounts: a listing the trainer created there is marked `seller: 'You'`.
  const isOwn = USE_SUPABASE ? listing.sellerId !== undefined && listing.sellerId === me?.id : listing.seller === 'You';
  const notOpen = USE_SUPABASE && listing.status !== undefined && listing.status !== 'open';
  const offerDisabled = listing.untradable || isOwn || notOpen;
  const offerLabel = listing.untradable
    ? 'Untradable'
    : isOwn
      ? 'Your listing'
      : notOpen
        ? listing.status === 'locked'
          ? 'Locked'
          : 'No longer available'
        : 'Make Offer';

  // Own listing: the seller manages it instead of offering on it. A locked one cannot be withdrawn until the
  // seller unlocks it in the chat (`withdraw_listing` raises `unlock_first`).
  const refusal = withdrawRefusal(listing, lockHeld);
  const ownLocked = refusal === 'unlock_first';
  const withdrawLabel = withdrawing
    ? 'Withdrawing…'
    : ownLocked
      ? 'Locked: unlock in chat first'
      : listing.status === 'withdrawn'
        ? 'Withdrawn'
        : listing.status === 'completed'
          ? 'Traded'
          : 'Withdraw listing';
  const canWithdraw = !withdrawing && refusal === null;
  const hasHeroRowBadges =
    Boolean(listing.lucky) ||
    Boolean(listing.isGigantamax) ||
    Boolean(listing.isDynamax) ||
    hasSpecialBackground(listing.bg) ||
    Boolean(listing.untradable);

  const handleWithdraw = async () => {
    setConfirmWithdraw(false);
    setWithdrawing(true);
    const r = await withdrawListing(listing.id);
    if (r.ok) {
      toast('Listing withdrawn.', 'success');
      close();
    } else {
      setWithdrawing(false); // the store already toasted why
    }
  };

  return (
    <View className="flex-1 items-center justify-end" style={{ pointerEvents: 'box-none' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, overlayStyle]}>
        <Pressable
          onPress={() => close()}
          accessibilityRole="button"
          accessibilityLabel="Close listing details"
          style={{ flex: 1 }}
        >
          <BlurView intensity={20} tint="dark" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.5)' }} />
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[
          {
            width: '100%',
            maxWidth: 420,
            maxHeight: '92%',
            backgroundColor: '#0a0f1c',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderWidth: 1,
            borderColor: '#1e2436',
            borderBottomWidth: 0,
            overflow: 'hidden',
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={dragGesture}>
          <View className="items-center pb-1.5 pt-2.5">
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: '#2a3350' }} />
          </View>
        </GestureDetector>

        <View
          className="relative border-b border-border-subtle px-[22px] pb-[22px] pt-[18px]"
          style={hueHeroBleed(creatureHue(listing))}
        >
          <View className="flex-row items-start gap-4">
            <Sprite creature={listing} purified={listing.purified} size={92} />
            <View className="min-w-0 flex-1">
              {/* "Armored · 2024 catch", or just "2024 catch" for the default form (`creatureFormLabel` is
               *  undefined there): only the parts that exist are joined, so there is never a dangling "· ". */}
              <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 10, letterSpacing: 1.2 }}>
                {[creatureFormLabel(listing), `${listing.year} catch`].filter(Boolean).join(' · ')}
              </Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                {listing.shiny && <ShinyGlint size={22} glow />}
                {/* `flexShrink: 1` + `numberOfLines`: "Shiny " (Task 1) makes this ~6 characters longer,
                 *  and a Text sibling next to a fixed-size glyph in a row doesn't shrink by default in RN
                 *  (unlike the web), so a long name would overflow past the card edge instead of eliding. */}
                <Text
                  numberOfLines={1}
                  className="font-display text-text-primary"
                  style={{ fontSize: 22, letterSpacing: -0.44, flexShrink: 1 }}
                >
                  {creatureDisplayName(listing)}
                </Text>
              </View>
              <TypeBadge creature={listing} style={{ marginTop: 8 }} />
              {hasHeroRowBadges && (
                <View className="mt-2 flex-row flex-wrap gap-1.5 items-center">
                  {listing.lucky && <LuckyBadge />}
                  {listing.isGigantamax && <GigantamaxBadge />}
                  {listing.isDynamax && <DynamaxBadge />}
                  <BackgroundBadge bg={listing.bg} hue={creatureHue(listing)} accent={listing.accent} />
                  {listing.untradable && (
                    <View className="rounded-[6px] border px-2 py-[3px]" style={{ backgroundColor: 'rgba(255,92,138,0.15)', borderColor: 'rgba(255,92,138,0.3)' }}>
                      <Text className="font-display-semi uppercase" style={{ fontSize: 10, letterSpacing: 0.8, color: '#ff5c8a' }}>
                        Untradable
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Must stay the LAST child, with a zIndex: the row above spans the full width, and anything
           *  painted before it loses the corner (and the touch) to its text column. */}
          <View className="absolute right-4 top-3" style={{ zIndex: 10, elevation: 10 }}>
            <IconButton size={34} radius={12} accessibilityLabel="Close" onPress={() => close()}>
              <X size={16} color="#8b93a7" />
            </IconButton>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 22 }} showsVerticalScrollIndicator={false}>
          <View className="mb-[18px] flex-row gap-2">
            {listing.cp != null && (
              <StatTile label="CP" value={formatCp(listing.cp).replace('CP ', '')} color="#f5c518" icon={<Zap size={12} color="#f5c518" />} radius={12} valueSize={18} />
            )}
            <StatTile label="PvP Rank" value={listing.pvp} color="#4fb3ff" icon={<Bolt size={12} color="#4fb3ff" />} radius={12} valueSize={18} />
            <StatTile
              label="Top Traded"
              value={
                <>
                  {marketLabel(demandTier(listing.market))}
                  {listing.market ? (
                    <Text style={{ fontSize: 9, color: '#8b93a7' }}>
                      {`\n${listing.market.wanted}↑ ${listing.market.offered}↓`}
                    </Text>
                  ) : null}
                </>
              }
              color="#f5c518"
              icon={<Trophy size={12} color="#f5c518" />}
              radius={12}
              valueSize={18}
            />
            <StatTile label="IV Spread" value={listing.iv} color="#e8ecf5" icon={<Dumbbell size={12} color="#e8ecf5" />} radius={12} mono valueSize={12} />
          </View>

          <StardustCard initialTradeType={listing.tradeType} />

          <View className="mb-[18px]">
            <View className="mb-3 flex-row items-center gap-2">
              <Text className="font-display text-text-primary" style={{ fontSize: 15, letterSpacing: -0.15 }}>
                Logistics
              </Text>
              <View className="h-px flex-1" style={SURFACE.divider} />
            </View>
            <View className="flex-row flex-wrap gap-2">
              <LogisticsChip icon={<MapPin size={12} color="#4fb3ff" />} label={formatVicinityLabel(listing.loc)} />
              <LogisticsChip icon={<Car size={12} color="#4fb3ff" />} label={listing.willTravel ? 'Will Travel' : 'Local Only'} />
              <LogisticsChip icon={<Clock size={12} color="#4fb3ff" />} label={TRADE_TIMELINE_LABELS[listing.tradeTimeline]} />
              {listing.sizeClass && <LogisticsChip icon={<Ruler size={12} color="#4fb3ff" />} label={`Size: ${listing.sizeClass}`} />}
              {listing.pokeball && (
                <LogisticsChip icon={<CircleDot size={12} color="#4fb3ff" />} label={POKEBALL_LABELS[listing.pokeball]} />
              )}
            </View>
          </View>

          <View className="mb-[18px]">
            <View className="mb-3 flex-row items-center gap-2">
              <Text className="font-display text-text-primary" style={{ fontSize: 15, letterSpacing: -0.15 }}>
                Looking For
              </Text>
              <View className="h-px flex-1" style={SURFACE.divider} />
              <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                {listing.looking.length} · any 1 accepted
              </Text>
            </View>
            <View className="gap-2">
              {listing.looking.map((creature, i) => (
                // Index, not name: a wanted list can hold two entries of one species (a shiny and a regular,
                // or two forms), and a name — the dex species now — no longer tells them apart. The list is
                // static for the life of this screen, so position is a stable identity.
                <LookingForRow key={i} creature={creature} index={i} />
              ))}
            </View>
          </View>
        </ScrollView>

        {showMeetup ? (
          <View className="border-t border-border-subtle px-[22px] pb-1 pt-3" accessibilityLiveRegion="polite">
            <Text className="font-display text-text-primary" style={{ fontSize: 13 }}>
              Safe meetup vicinity
            </Text>
            <SafeMeetZone location={formatVicinityLabel(listing.loc)} />
            <Text className="mt-2 font-mono text-text-muted" style={{ fontSize: 11, lineHeight: 16 }}>
              {listing.willTravel ? 'Seller is willing to travel for the meetup.' : 'Seller prefers to meet locally.'}
            </Text>
            <Text className="mt-1 text-text-body" style={{ fontSize: 12, lineHeight: 18 }}>
              Exact meetup spots are agreed in chat after the trade locks. Exact GPS is never shared.
            </Text>
          </View>
        ) : null}

        {isOwn && ownLocked ? (
          <View className="border-t border-border-subtle px-[22px] pt-3">
            <Text className="font-mono text-text-muted" style={{ fontSize: 11, lineHeight: 16 }}>
              A buyer&apos;s offer is locked. Unlock it from the chat before withdrawing.
            </Text>
          </View>
        ) : null}

        <View
          className="flex-row gap-2 border-t border-border-subtle px-[22px] pt-3.5"
          style={[SURFACE.ctaFade, { paddingBottom: Math.max(insets.bottom, 26) }]}
        >
          <IconButton
            size={52}
            radius={14}
            accessibilityLabel="View meetup location"
            onPress={() => setShowMeetup((v) => !v)}
          >
            <MapPin size={20} color="#4fb3ff" />
          </IconButton>
          {isOwn ? (
            <PrimaryButton
              label={withdrawLabel}
              flex={1}
              style={{ backgroundColor: '#ff5c8a' }}
              textColor="#1a0610"
              icon={canWithdraw ? <Trash2 size={16} color="#1a0610" /> : undefined}
              onPress={() => setConfirmWithdraw(true)}
              disabled={!canWithdraw}
            />
          ) : (
            <PrimaryButton
              label={offerLabel}
              flex={1}
              style={SURFACE.ctaBlue}
              textColor="#04121f"
              icon={!offerDisabled ? <Send size={16} color="#04121f" /> : undefined}
              onPress={() => void startOffer()}
              disabled={offerDisabled}
            />
          )}
        </View>
      </Animated.View>

      <Modal
        visible={showOfferModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowOfferModal(false)}
      >
        <BuyerOfferModal listing={listing} onCancel={() => setShowOfferModal(false)} onOffered={handleOffered} />
      </Modal>
      <ConfirmModal
        visible={confirmWithdraw}
        title="Withdraw this listing?"
        message="It leaves the feed and every open chat on it closes. This can't be undone."
        confirmLabel="Withdraw"
        destructive
        onConfirm={() => void handleWithdraw()}
        onCancel={() => setConfirmWithdraw(false)}
      />
      <ToastHost />
    </View>
  );
}

/** Small labeled pill for a single logistics fact (will-travel, timeline, caught-in ball) — same
 *  border/panel treatment as the feed card's old demand pill, just generic over icon + label. */
function LogisticsChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-lg border border-border-strong bg-bg-panel px-2.5 py-1.5">
      {icon}
      <Text className="font-mono text-text-body" style={{ fontSize: 11, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}
