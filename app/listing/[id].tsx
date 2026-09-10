import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Bolt, Dumbbell, MapPin, Send, Trophy, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LookingForRow } from '@/components/listing/LookingForRow';
import { StardustCard } from '@/components/listing/StardustCard';
import { IconButton } from '@/components/ui/IconButton';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Sprite } from '@/components/ui/Sprite';
import { BackgroundBadge } from '@/components/ui/BackgroundBadge';
import { StatTile } from '@/components/ui/StatTile';
import { hueHeroBleed, SURFACE } from '@/constants/theme';
import { listings } from '@/data/listings';

const SHEET_TRAVEL = 900;
const DISMISS_THRESHOLD = 120;

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = listings.find((l) => l.id === id);
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(SHEET_TRAVEL);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    overlayOpacity.value = withTiming(1, { duration: 260 });
  }, [translateY, overlayOpacity]);

  const defaultNavigate = () => router.back();

  const close = (navigate?: () => void) => {
    const navFunc = navigate ?? defaultNavigate;
    translateY.value = withTiming(SHEET_TRAVEL, { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    overlayOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(navFunc)();
    });
  };

  const dragGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD) {
        runOnJS(close)();
      } else {
        translateY.value = withTiming(0, { duration: 180, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  if (!listing) return null;

  return (
    <View className="flex-1 items-center justify-end" pointerEvents="box-none">
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
          style={hueHeroBleed(listing.hue)}
        >
          <View className="absolute right-4 top-3">
            <IconButton size={34} radius={12} accessibilityLabel="Close" onPress={() => close()}>
              <X size={16} color="#8b93a7" />
            </IconButton>
          </View>

          <View className="flex-row items-start gap-4">
            <Sprite pokemonId={listing.pokemonId} hue={listing.hue} shiny={listing.shiny} size={92} />
            <View className="min-w-0 flex-1">
              <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 10, letterSpacing: 1.2 }}>
                {listing.form} · {listing.year} catch
              </Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                {listing.shiny && (
                  <Text style={{ color: '#ff6bd6', textShadowColor: '#ff6bd6', textShadowRadius: 8, fontSize: 22 }}>✦</Text>
                )}
                <Text className="font-display text-text-primary" style={{ fontSize: 22, letterSpacing: -0.44 }}>
                  {listing.name}
                </Text>
              </View>
              <View className="mt-2 flex-row flex-wrap gap-1.5 items-center">
                {listing.lucky && <LuckyBadge />}
                <BackgroundBadge bg={listing.bg} hue={listing.hue} accent={listing.accent} />
                {listing.untradable && (
                  <View className="rounded-[6px] border px-2 py-[3px]" style={{ backgroundColor: 'rgba(255,92,138,0.15)', borderColor: 'rgba(255,92,138,0.3)' }}>
                    <Text className="font-display-semi uppercase" style={{ fontSize: 10, letterSpacing: 0.8, color: '#ff5c8a' }}>
                      Untradable
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 22 }} showsVerticalScrollIndicator={false}>
          <View className="mb-[18px] flex-row gap-2">
            <StatTile label="PvP Rank" value={listing.pvp} color="#4fb3ff" icon={<Bolt size={12} color="#4fb3ff" />} radius={12} valueSize={18} />
            <StatTile label="Top Traded" value={listing.demand} color="#f5c518" icon={<Trophy size={12} color="#f5c518" />} radius={12} valueSize={18} />
            <StatTile label="IV Spread" value={listing.iv} color="#e8ecf5" icon={<Dumbbell size={12} color="#e8ecf5" />} radius={12} mono valueSize={12} />
          </View>

          <StardustCard baseStardust={listing.stardust} />

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
                <LookingForRow key={creature.name} creature={creature} index={i} />
              ))}
            </View>
          </View>
        </ScrollView>

        <View
          className="flex-row gap-2 border-t border-border-subtle px-[22px] pt-3.5"
          style={[SURFACE.ctaFade, { paddingBottom: Math.max(insets.bottom, 26) }]}
        >
          <IconButton size={52} radius={14} accessibilityLabel="View meetup location">
            <MapPin size={20} color="#4fb3ff" />
          </IconButton>
          <PrimaryButton
            label={listing.untradable ? 'Untradable' : 'Make Offer'}
            flex={1}
            style={SURFACE.ctaBlue}
            textColor="#04121f"
            icon={!listing.untradable ? <Send size={16} color="#04121f" /> : undefined}
            onPress={() => close(() => router.dismissTo('/chats'))}
            disabled={listing.untradable}
          />
        </View>
      </Animated.View>
    </View>
  );
}
