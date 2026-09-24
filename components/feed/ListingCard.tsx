import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { BackgroundBadge } from '@/components/ui/BackgroundBadge';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { Sprite } from '@/components/ui/Sprite';
import { TextBadge } from '@/components/ui/TextBadge';
import { hueBleed, SURFACE } from '@/constants/theme';
import type { Listing } from '@/data/types';

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <View
      className="relative flex-row gap-3.5 overflow-hidden rounded-[18px] border border-border bg-bg-card p-3.5"
      style={SURFACE.card}
    >
      {/* Invisible pressable underlay covers the whole card — avoids nesting <button> on web */}
      <Pressable
        onPress={() => router.push(`/listing/${listing.id}`)}
        accessibilityRole="button"
        accessibilityHint="View listing details"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      />

      <View className="absolute h-[120px] w-[120px] rounded-full" style={[{ top: -30, right: -30, pointerEvents: 'none' }, hueBleed(listing.hue)]} />

      <View style={{ pointerEvents: 'none' }}>
        <Sprite pokemonId={listing.pokemonId} hue={listing.hue} shiny={listing.shiny} size={72} />
      </View>

      <View className="min-w-0 flex-1 gap-1.5" style={{ pointerEvents: 'box-none' }}>
        <View className="flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
          {listing.shiny && (
            <Text style={{ fontSize: 11, color: '#ff6bd6', textShadow: '0 0 6px #ff6bd6' } as any}>✦</Text>
          )}
          <Text className="font-display text-text-primary" style={{ fontSize: 16, letterSpacing: -0.16 }}>
            {listing.name}
          </Text>
        </View>
        <Text className="font-mono text-text-subtle" style={{ fontSize: 12, pointerEvents: 'none' }}>
          {listing.form} · {listing.year}
        </Text>

        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
          <BackgroundBadge bg={listing.bg} hue={listing.hue} accent={listing.accent} />
          {listing.lucky && <LuckyBadge size="sm" />}
        </View>

        {listing.tags && listing.tags.length > 0 && (
          <View className="flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
            {listing.tags.map((tag) => (
              <TextBadge key={tag} label={tag} size="sm" selected />
            ))}
          </View>
        )}

        {listing.notes ? (
          <Text
            numberOfLines={2}

            className="text-text-body"
            style={{ fontSize: 12, lineHeight: 18, fontStyle: 'italic', pointerEvents: 'none' }}
          >
            {listing.notes}
          </Text>
        ) : null}

        <View className="mt-1.5 flex-row items-center justify-between" style={{ pointerEvents: 'box-none' }}>
          <View className="flex-row items-center gap-1" style={{ pointerEvents: 'box-none' }}>
            {listing.dist !== undefined ? (
              <>
                <MapPin size={12} color="#6d7690" />
                <Text className="font-mono text-text-muted" style={{ fontSize: 11, pointerEvents: 'none' }}>
                  {listing.dist.toFixed(1)} km ·
                </Text>
              </>
            ) : null}
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                router.push(`/profile/${encodeURIComponent(listing.seller)}`);
              }}
              accessibilityRole="link"
              accessibilityHint="View profile"
              hitSlop={4}
              style={{ position: 'relative', zIndex: 1 }}
              className="flex-row items-center gap-1 active:opacity-70"
            >
              <Avatar name={listing.seller} size={16} radius={5} fontSize={9} />
              <Text className="font-mono text-text-muted" style={{ fontSize: 11 }}>
                {listing.seller}
              </Text>
            </Pressable>
          </View>
          <View className="flex-row items-center gap-1 rounded-lg border border-border-strong bg-bg-panel px-2 py-1" style={{ pointerEvents: 'none' }}>
            <Text style={{ color: '#f5c518', fontSize: 11 }}>★</Text>
            <Text className="font-display text-text-primary" style={{ fontSize: 12 }}>
              {listing.demand}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

