import { Text, View } from 'react-native';

import { SectionHeading } from '@/components/ui/SectionHeading';
import { Chip } from '@/components/ui/Chip';
import { SURFACE } from '@/constants/theme';
import type { CreatureRef } from '@/data/types';

export function WishlistGrid({ wishlist }: { wishlist: CreatureRef[] }) {
  return (
    <View>
      <SectionHeading title="Wishlist" meta={`hunting ${wishlist.length}`} />
      <View className="flex-row flex-wrap gap-2">
        {wishlist.map((p, i) => (
          <View
            key={i}
            className="flex-row items-center gap-2.5 rounded-2xl border border-dashed p-3"
            style={[SURFACE.card, { width: '48%', borderColor: '#2a3350' }]}
          >
            <Chip pokemonId={p.pokemonId} hue={p.hue} shiny={p.shiny} size={44} />
            <View className="min-w-0 flex-1">
              <Text className="font-display-semi text-text-primary" style={{ fontSize: 12 }}>
                {p.name}
              </Text>
              <Text className="font-mono text-accent-blue" style={{ fontSize: 9, letterSpacing: 0.72, marginTop: 2 }}>
                HUNTING
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
