import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { PhoneFrame } from '@/components/layout/PhoneFrame';
import { ArsenalGrid } from '@/components/profile/ArsenalGrid';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { RepStats } from '@/components/profile/RepStats';
import { TradeHistoryGrid } from '@/components/profile/TradeHistoryGrid';
import { WishlistGrid } from '@/components/profile/WishlistGrid';
import { buildPublicTrainerProfile } from '@/data/publicProfile';

/** Public read-only profile for another trainer — reached by tapping a seller/partner avatar
 *  or name from the feed or chats. Not the current user's own `(tabs)/profile` tab. */
export default function PublicProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const handle = decodeURIComponent(userId ?? 'Trainer');
  const trainer = buildPublicTrainerProfile(handle);

  return (
    <PhoneFrame>
      <View className="flex-row items-center gap-2.5 border-b border-border-subtle px-4 pb-3.5 pt-1.5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          className="h-8 w-8 items-center justify-center active:opacity-70"
        >
          <ChevronLeft size={20} color="#8b93a7" />
        </Pressable>
        <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
          Trainer Profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHero trainer={trainer} />
        <RepStats trainer={trainer} />
        <ArsenalGrid arsenal={trainer.arsenal} />
        <WishlistGrid wishlist={trainer.wishlist} />
        <TradeHistoryGrid history={trainer.tradeHistory} />
      </ScrollView>
    </PhoneFrame>
  );
}
