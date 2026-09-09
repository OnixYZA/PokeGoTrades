import { ScrollView } from 'react-native';

import { ArsenalGrid } from '@/components/profile/ArsenalGrid';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { RepStats } from '@/components/profile/RepStats';
import { WishlistGrid } from '@/components/profile/WishlistGrid';
import { trainer } from '@/data/trainer';

export default function ProfileScreen() {
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <ProfileHero trainer={trainer} />
      <RepStats trainer={trainer} />
      <ArsenalGrid arsenal={trainer.arsenal} />
      <WishlistGrid wishlist={trainer.wishlist} />
    </ScrollView>
  );
}
