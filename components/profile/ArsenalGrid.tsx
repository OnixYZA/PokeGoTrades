import { Plus } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { Chip } from '@/components/ui/Chip';
import { hueBleed, SURFACE } from '@/constants/theme';
import type { CreatureRef } from '@/data/types';

interface ArsenalGridProps {
  arsenal: CreatureRef[];
  /** Only passed by the signed-in trainer's own profile screen; a public profile leaves it out. */
  onEdit?: () => void;
}

export function ArsenalGrid({ arsenal, onEdit }: ArsenalGridProps) {
  return (
    <View className="mb-[22px]">
      {/* Inlines SectionHeading's own layout (title + divider + meta) instead of reusing it, so the
       *  edit button can sit in the same row as the meta text — SectionHeading has no slot for one. */}
      <View className="mb-3 flex-row items-center gap-2">
        <Text className="font-display text-text-primary" style={{ fontSize: 15, letterSpacing: -0.15 }}>
          Arsenal
        </Text>
        <View className="h-px flex-1" style={SURFACE.divider} />
        <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
          {`${arsenal.length} high-value`}
        </Text>
        {onEdit && (
          <IconButton size={26} radius={9} accessibilityLabel="Edit Arsenal" onPress={onEdit}>
            <Plus size={14} color="#4fb3ff" />
          </IconButton>
        )}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {arsenal.map((p, i) => (
          <View
            key={i}
            className="relative items-center gap-2 overflow-hidden rounded-2xl border border-border bg-bg-card p-2.5"
            style={{ width: '31.5%' }}
          >
            <View className="absolute h-20 w-20 self-center" style={[{ top: -20, pointerEvents: 'none' }, hueBleed(p.hue)]} />
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
