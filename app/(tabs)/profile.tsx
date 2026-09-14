import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ArsenalGrid } from '@/components/profile/ArsenalGrid';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { RepStats } from '@/components/profile/RepStats';
import { TradeHistoryGrid } from '@/components/profile/TradeHistoryGrid';
import { WishlistGrid } from '@/components/profile/WishlistGrid';
import { trainer } from '@/data/trainer';

export default function ProfileScreen() {
  return (
    <View style={{ flex: 1 }}>
      {/* Header with back button */}
      <View className="flex-row items-center gap-2.5 border-b border-border-subtle px-4 pb-3 pt-1.5">
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
          My Profile
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHero trainer={trainer} />
        <RepStats trainer={trainer} />
        <ArsenalGrid arsenal={trainer.arsenal} />
        <WishlistGrid wishlist={trainer.wishlist} />
        <TradeHistoryGrid history={trainer.tradeHistory} />
      </ScrollView>
    </View>
  );
}

