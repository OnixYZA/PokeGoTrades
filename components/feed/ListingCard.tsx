import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { BackgroundBadge } from '@/components/ui/BackgroundBadge';
import { DemandBadge } from '@/components/ui/DemandBadge';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { Sprite } from '@/components/ui/Sprite';
import { TextBadge } from '@/components/ui/TextBadge';
import { hueBleed, SURFACE } from '@/constants/theme';
import type { Listing } from '@/data/types';
import { creatureDisplayName } from '@/lib/format';

/** At most this many attribute/tag badges render before the row collapses the rest into "+N" — keeps
 *  a listing with every attribute set (and a full 5 tags) from overflowing a 360pt-wide card. */
const MAX_VISIBLE_BADGES = 4;

/** Purified / Costume / a verified size, plus every seller tag ("Level 1" included) — one flat list so
 *  the "+N" overflow count and the wrap behavior are consistent regardless of which kind of badge a
 *  listing happens to carry. */
function attributeBadges(listing: Listing): { key: string; label: string }[] {
  const badges: { key: string; label: string }[] = [];
  if (listing.purified) badges.push({ key: 'purified', label: 'Purified' });
  if (listing.costume) badges.push({ key: 'costume', label: 'Costume' });
  // Service-role only, set once an appraisal proof verifies it (constants/listing-attributes.ts) — the
  // "✓" marks it as OCR-confirmed rather than a seller's own (unverifiable) claim.
  if (listing.sizeClass) badges.push({ key: 'size', label: `${listing.sizeClass} ✓` });
  for (const tag of listing.tags) badges.push({ key: `tag:${tag}`, label: tag });
  return badges;
}

export function ListingCard({ listing }: { listing: Listing }) {
  const badges = attributeBadges(listing);
  const visibleBadges = badges.slice(0, MAX_VISIBLE_BADGES);
  const hiddenBadgeCount = badges.length - visibleBadges.length;

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
        <Sprite creature={listing} purified={listing.purified} size={72} />
      </View>

      <View className="min-w-0 flex-1 gap-1.5" style={{ pointerEvents: 'box-none' }}>
        <View className="flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
          {listing.shiny && (
            <Text style={{ fontSize: 11, color: '#ff6bd6', textShadow: '0 0 6px #ff6bd6' } as any}>✦</Text>
          )}
          {/* `flexShrink: 1` + `numberOfLines`: the "Shiny " prefix (Task 1) is ~6 characters longer, and
           *  a Text next to the fixed-size glyph in this row doesn't shrink by default in RN — without
           *  this a long name (e.g. "Shiny Blacephalon") would overflow the card instead of eliding. */}
          <Text
            numberOfLines={1}
            className="font-display text-text-primary"
            style={{ fontSize: 16, letterSpacing: -0.16, flexShrink: 1 }}
          >
            {creatureDisplayName(listing)}
          </Text>
        </View>
        <Text className="font-mono text-text-subtle" style={{ fontSize: 12, pointerEvents: 'none' }}>
          {listing.form} · {listing.year}
        </Text>

        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
          <BackgroundBadge bg={listing.bg} hue={listing.hue} accent={listing.accent} />
          {listing.lucky && <LuckyBadge size="sm" />}
        </View>

        {visibleBadges.length > 0 && (
          <View className="flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
            {visibleBadges.map((badge) => (
              <TextBadge key={badge.key} label={badge.label} size="sm" selected />
            ))}
            {hiddenBadgeCount > 0 && <TextBadge label={`+${hiddenBadgeCount}`} size="sm" />}
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
          <View style={{ pointerEvents: 'none' }}>
            <DemandBadge market={listing.market} />
          </View>
        </View>
      </View>
    </View>
  );
}

