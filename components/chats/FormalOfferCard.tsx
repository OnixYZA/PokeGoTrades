import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { formalOffer } from '@/data/chats';
import type { FormalOffer } from '@/data/types';

export function FormalOfferCard({ offer = formalOffer }: { offer?: FormalOffer }) {
  return (
    <View
      className="mt-1 gap-2.5 rounded-2xl border p-3"
      style={{ maxWidth: '82%', borderColor: 'rgba(79,179,255,.3)', backgroundColor: '#0f1524' }}
    >
      <Text className="font-mono uppercase text-accent-blue" style={{ fontSize: 9, letterSpacing: 1 }}>
        Formal Offer
      </Text>
      <View className="flex-row items-center gap-2.5">
        <Chip pokemonId={offer.pokemonId} hue={offer.hue} lucky size={40} />
        <View>
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
            {offer.name}
          </Text>
          <Text className="font-mono" style={{ fontSize: 10, color: '#94a3b8' }}>
            {[offer.move, offer.iv].filter(Boolean).join(' · ') || 'Awaiting details'}
          </Text>
        </View>
      </View>
    </View>
  );
}
