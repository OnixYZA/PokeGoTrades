import { Lock } from 'lucide-react-native';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { SURFACE } from '@/constants/theme';

export function LockedBanner({ partner }: { partner: string }) {
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
        <Text style={{ fontSize: 11, color: '#a89568', marginTop: 1 }}>
          Competing offers hidden. Meet {partner} within 24h.
        </Text>
      </View>
    </Animated.View>
  );
}
