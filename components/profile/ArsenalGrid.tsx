import { Plus } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { EqualGrid } from '@/components/ui/EqualGrid';
import { IconButton } from '@/components/ui/IconButton';
import { Chip } from '@/components/ui/Chip';
import { RemoveCreatureButton } from '@/components/profile/RemoveCreatureButton';
import { hueBleed, SURFACE } from '@/constants/theme';
import { creatureDisplayName } from '@/lib/format';
import type { TrainerCreature } from '@/lib/creature-list';

interface ArsenalGridProps {
  /** Entries, not bare creatures: each carries its row id, which is both the React key (duplicates are
   *  legal, so the creature alone can't be one) and what `onRemove` hands back. Read-only callers wrap
   *  theirs with `toReadOnlyEntries`. */
  arsenal: readonly TrainerCreature[];
  /** Only passed by the signed-in trainer's own profile screen; a public profile leaves it out. */
  onEdit?: () => void;
  /** Only passed by the signed-in trainer's own profile screen, same as `onEdit`: its presence is what
   *  puts a remove button on every tile, so a read-only grid can't offer a delete it has no row to run. */
  onRemove?: (entry: TrainerCreature) => void;
}

const COLUMNS = 3;

export function ArsenalGrid({ arsenal, onEdit, onRemove }: ArsenalGridProps) {
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
      <EqualGrid
        items={arsenal}
        columns={COLUMNS}
        keyExtractor={(entry) => entry.id}
        renderItem={(entry) => (
          <View className="relative items-center gap-2 overflow-hidden rounded-2xl border border-border bg-bg-card p-2.5">
            <View className="absolute h-20 w-20 self-center" style={[{ top: -20, pointerEvents: 'none' }, hueBleed(entry.creature.hue)]} />
            {/* A lucky entry shows both the Chip's small gold "L" and this tile's "✦ LUCKY" caption below. */}
            <Chip creature={entry.creature} size={52} />
            {/* numberOfLines: 3 narrow columns (Task 1) + the "Shiny " prefix means a name like "Shiny
             *  Crabominable" needs to wrap — capped at 2 lines so a long one still fits its tile instead
             *  of pushing the row's height around unpredictably. */}
            <Text
              numberOfLines={2}
              className="text-center font-display-semi text-text-primary"
              style={{ fontSize: 11, lineHeight: 13.2 }}
            >
              {creatureDisplayName(entry.creature)}
            </Text>
            {entry.creature.lucky && (
              <Text className="font-display" style={{ fontSize: 8, letterSpacing: 0.9, color: '#f5c518' }}>
                ✦ LUCKY
              </Text>
            )}
            {/* Top-right: the Chip is centered and narrower than the tile, so that corner is clear of it
             *  and of the (centered) name below. Last child, so it paints and hit-tests above the rest. */}
            {onRemove && (
              <RemoveCreatureButton
                creature={entry.creature}
                listLabel="Arsenal"
                placement={{ top: 4, right: 4 }}
                onPress={() => onRemove(entry)}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}
