import { Plus } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { Chip } from '@/components/ui/Chip';
import { SURFACE } from '@/constants/theme';
import type { CreatureRef } from '@/data/types';

interface WishlistGridProps {
  wishlist: CreatureRef[];
  /** Only passed by the signed-in trainer's own profile screen; a public profile leaves it out. */
  onEdit?: () => void;
}

export function WishlistGrid({ wishlist, onEdit }: WishlistGridProps) {
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
