import { Trash2 } from 'lucide-react-native';
import type { ViewStyle } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import type { CreatureRef } from '@/data/types';
import { creatureFullName } from '@/lib/format';

interface RemoveCreatureButtonProps {
  creature: CreatureRef;
  /** 'Arsenal' | 'Wishlist' — spoken in the accessibility label so the action is unambiguous. */
  listLabel: string;
  onPress: () => void;
  /** Where in the tile it sits; the grids differ in which corner is free (see each grid). */
  placement: Pick<ViewStyle, 'top' | 'bottom' | 'right'>;
}

/**
 * The per-tile "remove from my list" control on Arsenal / Wishlist. Always visible rather than behind a
 * long-press: a gesture nothing on screen hints at is the same "can't remove" problem to anyone who
 * never finds it, and the tiles have no tap action of their own for a button to compete with. Kept small
 * and muted (the red lives in the confirmation, not on every tile) with `IconButton`'s built-in 44pt
 * hit slop, so it is easy to hit without reading as a loud second action on each Pokémon.
 *
 * Its label names the creature in full (`creatureFullName`, "Remove Alolan Vulpix from Wishlist"): a list can hold
 * Vulpix and Alolan Vulpix side by side, and a screen reader hears only this label, not the tile around it.
 */
export function RemoveCreatureButton({ creature, listLabel, onPress, placement }: RemoveCreatureButtonProps) {
  return (
    <IconButton
      size={22}
      radius={8}
      accessibilityLabel={`Remove ${creatureFullName(creature)} from ${listLabel}`}
      onPress={onPress}
      style={{ position: 'absolute', ...placement }}
    >
      <Trash2 size={12} color="#8b93a7" />
    </IconButton>
  );
}
