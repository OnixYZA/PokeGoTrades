import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { formalOffer } from '@/data/chats';
import type { FormalOffer } from '@/data/types';
import { USE_SUPABASE } from '@/lib/data-source';

export function FormalOfferCard({ offer = formalOffer }: { offer?: FormalOffer }) {
  // Server offers say whether they are lucky/shiny. The mock offers predate those fields and were
  // always drawn with the lucky sparkle, so the mock keeps doing that.
  const lucky = USE_SUPABASE ? offer.lucky === true : true;

  return (
    <View
      className="mt-1 gap-2.5 rounded-2xl border p-3"
      style={{ maxWidth: '82%', borderColor: 'rgba(79,179,255,.3)', backgroundColor: '#0f1524' }}
    >
      <Text className="font-mono uppercase text-accent-blue" style={{ fontSize: 9, letterSpacing: 1 }}>
        Formal Offer
      </Text>
      <View className="flex-row items-center gap-2.5">
        <Chip pokemonId={offer.pokemonId} hue={offer.hue} shiny={offer.shiny} lucky={lucky} size={40} />
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
