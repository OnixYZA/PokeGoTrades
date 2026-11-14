import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { BackgroundBadge, hasSpecialBackground } from '@/components/ui/BackgroundBadge';
import { DemandBadge } from '@/components/ui/DemandBadge';
import { DynamaxBadge } from '@/components/ui/DynamaxBadge';
import { GigantamaxBadge } from '@/components/ui/GigantamaxBadge';
import { LuckyBadge } from '@/components/ui/LuckyBadge';
import { ShinyGlint } from '@/components/ui/ShinyGlint';
import { Sprite } from '@/components/ui/Sprite';
import { TextBadge } from '@/components/ui/TextBadge';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { attributeBadges } from '@/constants/listing-attributes';
import { creatureHue } from '@/constants/pokedex';
import { hueBleed, SURFACE } from '@/constants/theme';
import type { Listing } from '@/data/types';
import { creatureDisplayName, creatureFormLabel, formatCp } from '@/lib/format';

/** At most this many attribute/tag badges render before the row collapses the rest into "+N" — keeps
 *  a listing with every attribute set (and a full 5 tags) from overflowing a 360pt-wide card. */
const MAX_VISIBLE_BADGES = 4;

export { attributeBadges };

export function ListingCard({ listing }: { listing: Listing }) {
  const badges = attributeBadges(listing);
  const visibleBadges = badges.slice(0, MAX_VISIBLE_BADGES);
  const hiddenBadgeCount = badges.length - visibleBadges.length;
  const hasSpecialRowBadges =
    hasSpecialBackground(listing.bg) ||
    listing.lucky ||
    Boolean(listing.isGigantamax) ||
    Boolean(listing.isDynamax);

  return (
    <View
      className="relative flex-row gap-3.5 overflow-hidden rounded-[18px] border border-border bg-bg-card p-3.5"
      style={SURFACE.card}
    >
      {/* Invisible pressable underlay covers the whole card — avoids nesting <button> on web */}
      <Pressable
        onPress={() => router.push(`/listing/${listing.id}`)}
        accessibilityRole="button"
        accessibilityLabel={[creatureDisplayName(listing), listing.cp != null ? formatCp(listing.cp) : null].filter(Boolean).join(', ')}
        accessibilityHint="View listing details"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      />

      <View className="absolute h-[120px] w-[120px] rounded-full" style={[{ top: -30, right: -30, pointerEvents: 'none' }, hueBleed(creatureHue(listing))]} />

      <View style={{ pointerEvents: 'none' }}>
        <Sprite creature={listing} purified={listing.purified} size={72} />
      </View>

      <View className="min-w-0 flex-1 gap-1.5" style={{ pointerEvents: 'box-none' }}>
        <View className="flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
          {listing.shiny && <ShinyGlint size={11} glow />}
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
        {/* Its own row straight under the name, never beside it: the name keeps its row to itself so it can
         *  elide. Two `sm` pills are well inside the ~170pt text column of a 320pt screen, and they wrap
         *  rather than overflow if large text sizes ever make them too wide. */}
        <TypeBadge creature={listing} size="sm" />
        {/* The form is the structured `formCode`, labelled by `creatureFormLabel`, and absent for the default form:
         *  joining only the parts that exist means no form never leaves a dangling "· 2024". */}
        <Text numberOfLines={1} className="font-mono text-text-subtle" style={{ fontSize: 12, pointerEvents: 'none' }}>
          {[creatureFormLabel(listing), String(listing.year)].filter(Boolean).join(' · ')}
        </Text>
        {/* CP gets its own line, in the primary color, so it reads as a headline stat; absent for a listing
         *  that predates the field (`cp` null), where nothing renders rather than "CP null". */}
        {listing.cp != null && (
          <Text numberOfLines={1} className="font-display-semi text-text-primary" style={{ fontSize: 13, pointerEvents: 'none' }}>
            {formatCp(listing.cp)}
          </Text>
        )}

        {hasSpecialRowBadges && (
          <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5" style={{ pointerEvents: 'none' }}>
            <BackgroundBadge bg={listing.bg} hue={creatureHue(listing)} accent={listing.accent} />
            {listing.lucky && <LuckyBadge size="sm" />}
            {listing.isGigantamax && <GigantamaxBadge size="sm" />}
            {listing.isDynamax && <DynamaxBadge size="sm" />}
          </View>
        )}

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
          <View className="flex-row items-center gap-1" style={{ flexShrink: 1, pointerEvents: 'box-none' }}>
            {/* The neighbourhood, never a distance: the same fact in mock and Supabase mode, and the only
             *  location a listing reveals. */}
            <MapPin size={12} color="#6d7690" />
            <Text className="font-mono text-text-muted" numberOfLines={1} style={{ fontSize: 11, flexShrink: 1, pointerEvents: 'none' }}>
              {listing.loc} ·
            </Text>
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

