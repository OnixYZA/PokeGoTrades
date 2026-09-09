import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { formalOffer } from '@/data/chats';

export function FormalOfferCard() {
  return (
    <View
      className="mt-1 self-start gap-2.5 rounded-2xl border p-3"
      style={{ maxWidth: '82%', borderColor: 'rgba(79,179,255,.3)', backgroundColor: '#0f1524' }}
    >
      <Text className="font-mono uppercase text-accent-blue" style={{ fontSize: 9, letterSpacing: 1 }}>
        Formal Offer
      </Text>
      <View className="flex-row items-center gap-2.5">
        <Chip pokemonId={formalOffer.pokemonId} hue={formalOffer.hue} lucky size={40} />
        <View>
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
            {formalOffer.name}
          </Text>
          <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
            {formalOffer.move} · {formalOffer.iv}
          </Text>
        </View>
      </View>
    </View>
  );
}
