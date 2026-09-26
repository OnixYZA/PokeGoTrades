import { Lock } from 'lucide-react-native';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { SURFACE } from '@/constants/theme';
import type { ChatRole } from '@/data/types';
import type { Confirmation } from '@/store/trade-store';

interface LockedBannerProps {
  partner: string;
  /** Supabase chats only. Without it the banner keeps the mock's single, role-less wording. */
  role?: ChatRole;
  confirmation?: Confirmation;
}

export function LockedBanner({ partner, role, confirmation = 'none' }: LockedBannerProps) {
  const detail =
    role === 'seller'
      ? `You accepted ${partner}'s offer. Competing offers are frozen.`
      : role === 'buyer'
        ? `${partner} accepted your offer. Meet within 24h.`
        : `Competing offers hidden. Meet ${partner} within 24h.`;

  // D2: the trade completes only when both trainers confirm, so say who the trade is waiting on.
  const waiting =
    confirmation === 'awaiting_partner'
      ? `Waiting for ${partner} to confirm`
      : confirmation === 'awaiting_me'
        ? `${partner} confirmed — tap the handshake to confirm`
        : null;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      className="flex-row items-center gap-2.5 border-b px-[22px] py-2.5"
      style={[SURFACE.lockedBanner, { borderBottomColor: 'rgba(245,197,24,.25)' }]}
    >
      <Lock size={16} color="#f5c518" />
      <View className="flex-1">
        <Text className="font-display" style={{ fontSize: 12, letterSpacing: 0.6, color: '#f5c518' }}>
          TRADE LOCKED
        </Text>
        <Text style={{ fontSize: 11, color: '#a89568', marginTop: 1 }}>{detail}</Text>
        {waiting ? (
          <Text className="font-display-semi" style={{ fontSize: 11, color: '#f5c518', marginTop: 2 }}>
            {waiting}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
