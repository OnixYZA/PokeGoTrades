import { Plus } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { EqualGrid } from '@/components/ui/EqualGrid';
import { IconButton } from '@/components/ui/IconButton';
import { Chip } from '@/components/ui/Chip';
import { RemoveCreatureButton } from '@/components/profile/RemoveCreatureButton';
import { SURFACE } from '@/constants/theme';
import { creatureFullName } from '@/lib/format';
import type { TrainerCreature } from '@/lib/creature-list';

interface WishlistGridProps {
  /** Entries, not bare creatures: each carries its row id, which is both the React key (duplicates are
   *  legal, so the creature alone can't be one) and what `onRemove` hands back. Read-only callers wrap
   *  theirs with `toReadOnlyEntries`. */
  wishlist: readonly TrainerCreature[];
  /** Only passed by the signed-in trainer's own profile screen; a public profile leaves it out. */
  onEdit?: () => void;
  /** Only passed by the signed-in trainer's own profile screen, same as `onEdit`: its presence is what
   *  puts a remove button on every tile, so a read-only grid can't offer a delete it has no row to run. */
  onRemove?: (entry: TrainerCreature) => void;
}

const COLUMNS = 2;

export function WishlistGrid({ wishlist, onEdit, onRemove }: WishlistGridProps) {
  return (
    <View>
      {/* Inlines SectionHeading's own layout (title + divider + meta) instead of reusing it, so the
       *  edit button can sit in the same row as the meta text — SectionHeading has no slot for one. */}
      <View className="mb-3 flex-row items-center gap-2">
        <Text className="font-display text-text-primary" style={{ fontSize: 15, letterSpacing: -0.15 }}>
          Wishlist
        </Text>
        <View className="h-px flex-1" style={SURFACE.divider} />
        <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
          {`hunting ${wishlist.length}`}
        </Text>
        {onEdit && (
          <IconButton size={26} radius={9} accessibilityLabel="Edit Wishlist" onPress={onEdit}>
            <Plus size={14} color="#4fb3ff" />
          </IconButton>
        )}
      </View>
      <EqualGrid
        items={wishlist}
        columns={COLUMNS}
        keyExtractor={(entry) => entry.id}
        renderItem={(entry) => (
          <View
            className="flex-row items-center gap-2.5 rounded-2xl border border-dashed p-3"
            style={[SURFACE.card, { borderColor: '#2a3350' }]}
          >
            <Chip creature={entry.creature} size={44} />
            <View className="min-w-0 flex-1">
              {/* The FULL name (`creatureFullName`: "Alolan Vulpix"), on up to two lines. Two columns leave only
               *  ~90px beside the sprite, so one line elided even "Shiny Crabominable" before forms existed here.
               *  Two lines (28px) plus the caption (~11px) still fit inside the 44px sprite's height, so a form
               *  does not make its tile taller than the rest. The form is part of the name rather than a line of
               *  its own because the caption below is the only other line this tile has. */}
              <Text numberOfLines={2} className="font-display-semi text-text-primary" style={{ fontSize: 12, lineHeight: 14 }}>
                {creatureFullName(entry.creature)}
              </Text>
              <Text className="font-mono text-accent-blue" style={{ fontSize: 9, letterSpacing: 0.72, marginTop: 2 }}>
                HUNTING
              </Text>
            </View>
            {/* Bottom-right, not top-right like the Arsenal: here the name runs the full width of the
             *  tile's upper half (up to two lines, ending just above this button), while the short "HUNTING"
             *  caption beneath leaves this corner free. */}
            {onRemove && (
              <RemoveCreatureButton
                creature={entry.creature}
                listLabel="Wishlist"
                placement={{ bottom: 4, right: 4 }}
                onPress={() => onRemove(entry)}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}
