import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { BackgroundBadge } from '@/components/ui/BackgroundBadge';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { Sprite } from '@/components/ui/Sprite';
import { hueBleed, SURFACE } from '@/constants/theme';
import type { Listing } from '@/data/types';

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Pressable
      onPress={() => router.push(`/listing/${listing.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${listing.name}, ${listing.dist.toFixed(1)} km away, from ${listing.seller}`}
      className="relative flex-row gap-3.5 overflow-hidden rounded-[18px] border border-border bg-bg-card p-3.5 active:opacity-90"
      style={SURFACE.card}
    >
      <View pointerEvents="none" className="absolute h-[120px] w-[120px] rounded-full" style={[{ top: -30, right: -30 }, hueBleed(listing.hue)]} />

      <Sprite pokemonId={listing.pokemonId} hue={listing.hue} shiny={listing.shiny} size={72} />

      <View className="min-w-0 flex-1 gap-1.5">
        <View className="flex-row flex-wrap items-center gap-1.5">
          {listing.shiny && (
            <Text style={{ fontSize: 11, color: '#ff6bd6', textShadowColor: '#ff6bd6', textShadowRadius: 6 }}>✦</Text>
          )}
          <Text className="font-display text-text-primary" style={{ fontSize: 16, letterSpacing: -0.16 }}>
            {listing.name}
          </Text>
        </View>
        <Text className="font-mono text-text-subtle" style={{ fontSize: 12 }}>
          {listing.form} · {listing.year}
        </Text>

        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          <BackgroundBadge bg={listing.bg} hue={listing.hue} accent={listing.accent} />
          {listing.lucky && <LuckyBadge size="sm" />}
        </View>

        <View className="mt-1.5 flex-row items-center justify-between">
          <View className="flex-row items-center gap-1">
            <MapPin size={12} color="#6d7690" />
            <Text className="font-mono text-text-muted" style={{ fontSize: 11 }}>
              {listing.dist.toFixed(1)} km ·
            </Text>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                router.push(`/profile/${encodeURIComponent(listing.seller)}`);
              }}
              accessibilityRole="button"
              accessibilityLabel={`View ${listing.seller}'s profile`}
              hitSlop={4}
              className="flex-row items-center gap-1 active:opacity-70"
            >
              <Avatar name={listing.seller} size={16} radius={5} fontSize={9} />
              <Text className="font-mono text-text-muted" style={{ fontSize: 11 }}>
                {listing.seller}
              </Text>
            </Pressable>
          </View>
          <View className="flex-row items-center gap-1 rounded-lg border border-border-strong bg-bg-panel px-2 py-1">
            <Text style={{ color: '#f5c518', fontSize: 11 }}>★</Text>
            <Text className="font-display text-text-primary" style={{ fontSize: 12 }}>
              {listing.demand}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
