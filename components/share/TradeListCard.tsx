import { Image } from 'expo-image';
import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { COLORS, GO_SPRITE_ZOOM } from '@/constants/theme';
import {
  CARD_PADDING,
  CARD_WIDTH,
  EMPTY_SECTION_HEIGHT,
  FOOTER_HEIGHT,
  GRID_GAP,
  GRID_TILE_SIZE,
  HEADER_HANDLE_ROW_HEIGHT,
  HEADER_ROW_GAP,
  HEADER_TEAM_ROW_HEIGHT,
  HEADER_WORDMARK_ROW_HEIGHT,
  OVERFLOW_ROW_HEIGHT,
  SECTION_GAP,
  SECTION_LABEL_HEIGHT,
  computeHeaderHeight,
  computeSectionHeight,
  computeTradeListLayout,
  type TradeListSection,
} from '@/constants/trade-list-layout';
import type { CreatureRef } from '@/data/types';
import { spriteVariantOf } from '@/lib/sprite-url';
import { useSpriteSource } from '@/lib/use-sprite-source';

/** How long a slow or dead sprite host gets before the export gives up waiting on it — see `onReady`. */
const SETTLE_TIMEOUT_MS = 5000;

export interface TradeListCardProps {
  handle: string;
  /** `null` when the trainer hasn't picked a team yet — live profiles only; the mock trainer always has one. */
  team: string | null;
  /** Mock-only concept (`data/trainer.ts`'s `lvl`) — live `MyProfile` has no level field, so callers omit
   *  this instead of inventing one (same call `LiveIdentityCard` already makes for the live header card). */
  level?: number;
  arsenal: CreatureRef[];
  wishlist: CreatureRef[];
  /**
   * Fires exactly once: when every visible sprite (after the per-list cap) has either loaded or
   * errored, or after `SETTLE_TIMEOUT_MS` — whichever comes first. Drives the Share button's disabled
   * state in `ShareTradeListModal`; a dead or slow raw.githubusercontent.com host must never leave the
   * export stuck waiting forever.
   */
  onReady?: () => void;
}

/**
 * The exportable "Arsenal + Wishlist" card (Task 2B). Rendered VISIBLY by `ShareTradeListModal` — never
 * off-screen, since Android can skip laying out a view that's never on screen — and captured from there
 * by `lib/share-image.ts` / `.web.ts`. `collapsable={false}` on the outer View stops Android's view
 * flattener from optimizing it out of the native tree that `captureRef` walks.
 *
 * Every block below (`CardHeader`, `CardSection`, `CardFooter`) is given an explicit height straight out
 * of `constants/trade-list-layout.ts`, and `overflow: 'hidden'` on each, so the sum the layout module
 * computes as `canvasHeight` — which `lib/share-image.ts` / `.web.ts` need before they can size
 * `captureRef`'s output — can never drift from what this component actually paints.
 *
 * Solid colours from `constants/theme.ts` only, never `hueChipBg` or any other `backgroundImage`
 * gradient: those are unreliable on Android (see constants/gradient.ts's header comment), and this
 * card's only job is to be captured as a bitmap, so a wrong pixel here is permanent. Never renders the
 * friend code — `profile_private` is private, and this component is never handed it in the first place.
 */
export const TradeListCard = forwardRef<View, TradeListCardProps>(function TradeListCard(
  { handle, team, level, arsenal, wishlist, onReady },
  ref,
) {
  const hasTeam = team !== null;
  const layout = computeTradeListLayout(arsenal, wishlist, hasTeam);
  const totalSprites = layout.arsenal.visible.length + layout.wishlist.visible.length;

  const settledCountRef = useRef(0);
  const firedRef = useRef(false);
  // Keeps `fireReady` callback-identity-stable while always calling the *latest* `onReady` — so the
  // effect below can depend on `totalSprites` alone without re-arming every time the parent re-renders.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const fireReady = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    firedRef.current = false;
    settledCountRef.current = 0;
    if (totalSprites === 0) {
      fireReady(); // both lists empty (or capped to zero, which never happens): nothing to wait for
      return;
    }
    const timer = setTimeout(fireReady, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // Re-arm only when the number of sprites to wait for changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSprites]);

  const handleTileSettled = useCallback(() => {
    settledCountRef.current += 1;
    if (settledCountRef.current >= totalSprites) fireReady();
  }, [totalSprites, fireReady]);

  return (
    <View ref={ref} collapsable={false} style={{ width: CARD_WIDTH, backgroundColor: COLORS.bgPanel }}>
      <CardHeader handle={handle} team={team} level={level} />
      {/* `padding` (not `paddingHorizontal`): top/bottom breathing room matching CARD_PADDING's
       *  horizontal rhythm, so "HAVE" doesn't start flush against the header and the last WANT row
       *  doesn't touch the footer's border. Both insets are in `computeTradeListLayout`'s `canvasHeight`
       *  sum (constants/trade-list-layout.ts) — never add spacing here without adding it there too. */}
      <View style={{ padding: CARD_PADDING }}>
        <CardSection label="HAVE" section={layout.arsenal} onTileSettled={handleTileSettled} />
        <View style={{ height: SECTION_GAP }} />
        <CardSection label="WANT" section={layout.wishlist} onTileSettled={handleTileSettled} />
      </View>
      <CardFooter />
    </View>
  );
});

/**
 * Every row below gets an explicit height from `constants/trade-list-layout.ts` instead of being left
 * to stack organically (padding/margin + whatever the text's natural line height happens to render at)
 * — the same fixed-height-block treatment `CardSection`/`CardFooter` already use. That's what lets
 * `computeHeaderHeight` compute this block's true height by arithmetic alone, so the space left below
 * the last row is always exactly `CARD_PADDING`, matching the top, in both the has-a-team and no-team
 * (`team` can be null) cases — never a slab whose size only happens to work out for one of them.
 */
function CardHeader({ handle, team, level }: { handle: string; team: string | null; level?: number }) {
  const hasTeam = team !== null;
  return (
    <View
      style={{
        height: computeHeaderHeight(hasTeam),
        overflow: 'hidden',
        backgroundColor: COLORS.bgCard,
        paddingHorizontal: CARD_PADDING,
        paddingTop: CARD_PADDING,
      }}
    >
      <View className="flex-row items-center gap-2" style={{ height: HEADER_WORDMARK_ROW_HEIGHT }}>
        <View
          className="items-center justify-center rounded-md"
          style={{ width: 22, height: 22, backgroundColor: COLORS.accentBlue }}
        >
          <Text className="font-display" style={{ fontSize: 12, color: COLORS.bgBase }}>
            P
          </Text>
        </View>
        <Text className="font-display" style={{ fontSize: 12, color: COLORS.accentBlue, letterSpacing: 1.2 }}>
          POKEGOTRADES
        </Text>
      </View>

      <View
        className="flex-row items-center gap-2"
        style={{ height: HEADER_HANDLE_ROW_HEIGHT, marginTop: HEADER_ROW_GAP }}
      >
        <Text
          numberOfLines={1}
          className="font-display"
          style={{ fontSize: 20, color: COLORS.textPrimary, letterSpacing: -0.3 }}
        >
          {handle}
        </Text>
        {typeof level === 'number' && (
          <View className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: COLORS.accentBlue }}>
            <Text className="font-display" style={{ fontSize: 10, color: COLORS.bgBase }}>
              LVL {level}
            </Text>
          </View>
        )}
      </View>

      {team && (
        <View
          className="flex-row items-center self-start rounded-full border px-2.5"
          style={{
            height: HEADER_TEAM_ROW_HEIGHT,
            marginTop: HEADER_ROW_GAP,
            backgroundColor: COLORS.bgCardAlt,
            borderColor: COLORS.borderDefault,
          }}
        >
          <Text className="font-display" style={{ fontSize: 10, color: COLORS.accentBlue, letterSpacing: 0.6 }}>
            TEAM {team.toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

function CardSection({
  label,
  section,
  onTileSettled,
}: {
  label: string;
  section: TradeListSection;
  onTileSettled: () => void;
}) {
  return (
    <View style={{ height: computeSectionHeight(section), overflow: 'hidden' }}>
      <View className="flex-row items-center gap-2" style={{ height: SECTION_LABEL_HEIGHT }}>
        <Text className="font-display" style={{ fontSize: 12, color: COLORS.textPrimary, letterSpacing: 0.4 }}>
          {label}
        </Text>
        <View style={{ height: 1, flex: 1, backgroundColor: COLORS.borderStrong }} />
        <Text className="font-mono" style={{ fontSize: 9, color: COLORS.textSubtle }}>
          {section.visible.length}
        </Text>
      </View>

      {section.visible.length === 0 ? (
        <View style={{ height: EMPTY_SECTION_HEIGHT }} className="items-center justify-center">
          <Text style={{ fontSize: 11, color: COLORS.textFaint }}>Nothing here yet</Text>
        </View>
      ) : (
        <>
          {section.rows.map((row, i) => (
            <View key={i} className="flex-row" style={{ gap: GRID_GAP, marginTop: i === 0 ? 0 : GRID_GAP }}>
              {row.map((creature, j) => (
                <CreatureTile key={`${creature.pokemonId}-${j}`} creature={creature} onSettled={onTileSettled} />
              ))}
            </View>
          ))}
          {section.overflowCount > 0 && (
            <View style={{ height: OVERFLOW_ROW_HEIGHT }} className="items-center justify-center">
              <Text className="font-mono" style={{ fontSize: 11, color: COLORS.textSubtle }}>
                +{section.overflowCount} more
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** A flat per-hue `backgroundColor` — never a `backgroundImage` gradient (see this file's header
 *  comment) — for a sprite that failed to load. Same idea as `components/ui/Avatar.tsx`'s monogram:
 *  something identifiable rendered on the spot rather than a blank tile. */
function hueSolidColor(hue: number): string {
  return `hsl(${hue}, 55%, 32%)`;
}

function CreatureTile({ creature, onSettled }: { creature: CreatureRef; onSettled: () => void }) {
  const { uri, loaded, exhausted, onLoad, onError } = useSpriteSource(spriteVariantOf(creature));
  const settledRef = useRef(false);
  // A tile settles once — either its sprite (some candidate in the fallback chain) actually loads, or
  // every candidate has failed — never on an intermediate `onError` that just advances to the next one.
  const settleOnce = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSettled();
  }, [onSettled]);

  useEffect(() => {
    if (loaded || exhausted) settleOnce();
  }, [loaded, exhausted, settleOnce]);

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-xl border"
      style={{
        width: GRID_TILE_SIZE,
        height: GRID_TILE_SIZE,
        backgroundColor: COLORS.bgCardAlt,
        borderColor: COLORS.borderDefault,
      }}
    >
      {exhausted ? (
        <View
          className="h-full w-full items-center justify-center"
          style={{ backgroundColor: hueSolidColor(creature.hue) }}
        >
          <Text className="font-display text-white" style={{ fontSize: GRID_TILE_SIZE * 0.32 }}>
            {creature.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri: uri ?? undefined }}
          recyclingKey={uri}
          style={{
            width: GRID_TILE_SIZE * 0.78,
            height: GRID_TILE_SIZE * 0.78,
            transform: [{ scale: GO_SPRITE_ZOOM }],
          }}
          contentFit="contain"
          onLoad={onLoad}
          onError={onError}
          accessibilityIgnoresInvertColors
          alt={`Pokemon ${creature.pokemonId} sprite`}
          accessibilityLabel={`Pokemon ${creature.pokemonId} sprite`}
        />
      )}
      {creature.shiny && (
        <Text
          className="absolute"
          style={{ top: 3, right: 4, fontSize: 9, color: '#fff', textShadow: '0 0 4px #ff6bd6' } as any}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ✦
        </Text>
      )}
      {creature.lucky && (
        <Text
          className="absolute font-display"
          style={{ bottom: 3, left: 4, fontSize: 8, color: COLORS.accentGold, letterSpacing: 0.4 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          L
        </Text>
      )}
    </View>
  );
}

function CardFooter() {
  return (
    <View
      style={{
        height: FOOTER_HEIGHT,
        overflow: 'hidden',
        borderTopWidth: 1,
        borderTopColor: COLORS.borderSubtle,
        paddingHorizontal: CARD_PADDING,
      }}
      className="items-center justify-center"
    >
      <Text className="font-mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: 0.6 }}>
        SHARED FROM POKEGOTRADES
      </Text>
    </View>
  );
}
