import { Ban } from 'lucide-react-native';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

/** A live chat the server closed. `withdrawn` says why when the seller took the listing down; any other
 *  closure (the listing completed with someone else, the pair was blocked) just says the chat is closed. */
export function ClosedBanner({ reason }: { reason: 'withdrawn' | 'closed' }) {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      className="flex-row items-center gap-2.5 border-b px-[22px] py-2.5"
      style={{ backgroundColor: 'rgba(139,147,167,.08)', borderBottomColor: 'rgba(139,147,167,.25)' }}
    >
      <Ban size={16} color="#8b93a7" />
      <View className="flex-1">
        <Text className="font-display" style={{ fontSize: 12, letterSpacing: 0.6, color: '#8b93a7' }}>
          CHAT CLOSED
        </Text>
        <Text style={{ fontSize: 11, color: '#6b7388', marginTop: 1 }}>
          {reason === 'withdrawn' ? 'The seller withdrew this listing. This chat is closed.' : 'This chat is closed.'}
        </Text>
      </View>
    </Animated.View>
  );
}
