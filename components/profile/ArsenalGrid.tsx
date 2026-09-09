import { Text, View } from 'react-native';

import { SectionHeading } from '@/components/ui/SectionHeading';
import { Chip } from '@/components/ui/Chip';
import { hueBleed } from '@/constants/theme';
import type { CreatureRef } from '@/data/types';

export function ArsenalGrid({ arsenal }: { arsenal: CreatureRef[] }) {
  return (
    <View className="mb-[22px]">
      <SectionHeading title="Arsenal" meta={`${arsenal.length} high-value`} />
      <View className="flex-row flex-wrap gap-2">
        {arsenal.map((p, i) => (
          <View
            key={i}
            className="relative items-center gap-2 overflow-hidden rounded-2xl border border-border bg-bg-card p-2.5"
            style={{ width: '31.5%' }}
          >
            <View pointerEvents="none" className="absolute h-20 w-20 self-center" style={[{ top: -20 }, hueBleed(p.hue)]} />
            <Chip pokemonId={p.pokemonId} hue={p.hue} shiny={p.shiny} size={52} />
            <Text className="text-center font-display-semi text-text-primary" style={{ fontSize: 11, lineHeight: 13.2 }}>
              {p.name}
            </Text>
            {p.lucky && (
              <Text className="font-display" style={{ fontSize: 8, letterSpacing: 0.9, color: '#f5c518' }}>
                ✦ LUCKY
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
