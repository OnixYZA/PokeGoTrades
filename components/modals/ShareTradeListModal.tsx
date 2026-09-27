import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Share2, X } from 'lucide-react-native';

import { TradeListCard } from '@/components/share/TradeListCard';
import { IconButton } from '@/components/ui/IconButton';
import { ToastHost } from '@/components/ui/ToastHost';
import { COLORS, SURFACE } from '@/constants/theme';
import { computeTradeListLayout } from '@/constants/trade-list-layout';
import type { CreatureRef } from '@/data/types';
import { shareTradeListImage } from '@/lib/share-image';
import { toast } from '@/lib/toast';

interface ShareTradeListModalProps {
  handle: string;
  /** `null` for a live profile that hasn't picked a team yet — see `TradeListCard`'s own prop doc. */
  team: string | null;
  /** Mock-only (`data/trainer.ts`'s `lvl`) — live profiles omit it, same as `TradeListCard`. */
  level?: number;
  arsenal: CreatureRef[];
  wishlist: CreatureRef[];
  onClose: () => void;
}

/**
 * Full-screen "Share trade list" flow (Task 2B), mounted by `app/(tabs)/profile.tsx` inside a native
 * `<Modal>` — same shape as `HandshakeModal` / `BailBlockModal`: this component is the content, the
 * screen owns the `<Modal>` wrapper. Renders `TradeListCard` VISIBLY, at its natural size, never
 * off-screen: Android can skip laying out a view that never becomes visible, and `captureRef` needs
 * real layout to have happened.
 *
 * The Share button stays disabled until `TradeListCard` reports every visible sprite has settled (see
 * its `onReady` prop), or when both lists are empty — either way with a one-line explanation instead
 * of a silently inert button.
 */
export function ShareTradeListModal({ handle, team, level, arsenal, wishlist, onClose }: ShareTradeListModalProps) {
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [spritesReady, setSpritesReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  const layout = useMemo(() => computeTradeListLayout(arsenal, wishlist), [arsenal, wishlist]);
  const isEmpty = arsenal.length === 0 && wishlist.length === 0;
  const canShare = spritesReady && !isEmpty && !sharing;

  const handleSpritesReady = useCallback(() => setSpritesReady(true), []);

  const handleShare = async () => {
    if (!canShare) return;
    setSharing(true);
    try {
      const result = await shareTradeListImage(cardRef, layout.canvasHeight);
      if (!result.ok) toast(result.message);
    } finally {
      setSharing(false);
    }
  };

  const disabledReason = isEmpty
    ? "Add something to your Arsenal or Wishlist first — there's nothing to share yet."
    : !spritesReady
      ? 'Loading sprites…'
      : null;

  return (
    <View className="w-full max-w-md flex-1 mx-auto" style={{ backgroundColor: COLORS.bgBase }}>
      <View
        className="flex-row items-center justify-between border-b border-border-subtle px-5 pb-3"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Text className="font-display text-text-primary" style={{ fontSize: 16 }}>
          Share trade list
        </Text>
        <IconButton accessibilityLabel="Close" onPress={onClose} size={34} radius={12}>
          <X size={16} color={COLORS.textPrimary} strokeWidth={2.5} />
        </IconButton>
      </View>

      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 20, paddingVertical: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-4 text-center text-text-subtle" style={{ fontSize: 12, lineHeight: 17 }}>
          A shareable PNG of your Arsenal and Wishlist. Your friend code never appears on it.
        </Text>
        <View className="overflow-hidden rounded-[20px] border" style={{ borderColor: COLORS.borderDefault }}>
          <TradeListCard
            ref={cardRef}
            handle={handle}
            team={team}
            level={level}
            arsenal={arsenal}
            wishlist={wishlist}
            onReady={handleSpritesReady}
          />
        </View>
        {disabledReason && (
          <Text className="mt-3 text-center text-text-subtle" style={{ fontSize: 12 }}>
            {disabledReason}
          </Text>
        )}
      </ScrollView>

      <View className="px-5" style={{ paddingBottom: insets.bottom + 20 }}>
        <Pressable
          onPress={() => void handleShare()}
          disabled={!canShare}
          accessibilityRole="button"
          accessibilityLabel="Share trade list"
          accessibilityState={{ disabled: !canShare, busy: sharing }}
          className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-4 ${!canShare ? 'opacity-50' : 'active:opacity-90'}`}
          style={SURFACE.ctaBlue}
        >
          {sharing ? (
            <ActivityIndicator color="#04121f" />
          ) : (
            <Share2 size={18} color="#04121f" strokeWidth={2.4} />
          )}
          <Text className="font-display" style={{ fontSize: 15, color: '#04121f', letterSpacing: -0.16 }}>
            {sharing ? 'Preparing…' : 'Share trade list'}
          </Text>
        </Pressable>
      </View>
      <ToastHost />
    </View>
  );
}
