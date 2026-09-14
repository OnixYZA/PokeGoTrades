import { Snowflake } from 'lucide-react-native';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

export function FrozenBanner() {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      className="flex-row items-center gap-2.5 border-b px-[22px] py-2.5"
      style={{ backgroundColor: 'rgba(79,179,255,.08)', borderBottomColor: 'rgba(79,179,255,.25)' }}
    >
      <Snowflake size={16} color="#4fb3ff" />
      <View className="flex-1">
        <Text className="font-display" style={{ fontSize: 12, letterSpacing: 0.6, color: '#4fb3ff' }}>
          CHAT FROZEN: TRADE PENDING
        </Text>
        <Text style={{ fontSize: 11, color: '#6b90b8', marginTop: 1 }}>
          The seller locked in a different offer for this listing.
        </Text>
      </View>
    </Animated.View>
  );
}
