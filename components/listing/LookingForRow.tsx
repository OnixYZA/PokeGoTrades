import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import type { CreatureRef } from '@/data/types';

const CONSTRAINT = ['Any IV', 'Hundo pref.', '96%+ IV'];

export function LookingForRow({ creature, index }: { creature: CreatureRef; index: number }) {
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-bg-card p-2.5">
      <Chip pokemonId={creature.pokemonId} hue={creature.hue} shiny={creature.shiny} lucky={creature.lucky} size={44} />
      <View className="min-w-0 flex-1">
        <Text className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
          {creature.name}
        </Text>
        <Text className="mt-0.5 font-mono text-text-subtle" style={{ fontSize: 10 }}>
          {CONSTRAINT[index] ?? 'Any IV'}
        </Text>
      </View>
      <Text className="font-mono text-accent-blue" style={{ fontSize: 10, letterSpacing: 0.6 }}>
        MATCH?
      </Text>
    </View>
  );
}
