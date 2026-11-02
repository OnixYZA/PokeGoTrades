import { Pressable, Text, View } from 'react-native';
import { Ban, X } from 'lucide-react-native';

import { MODAL_COLORS } from './tokens';

const C = MODAL_COLORS;

/** Why the species or form the trainer just tapped was not added. Sits above the list (or the form chips), so it
 *  stays in view however far the content has scrolled. Its own module, shared by `PokemonPickerModal` (a refused
 *  species row) and `FormPicker` (a refused form chip, such as White Kyurem), so there is one copy of the wording
 *  that cannot drift, and neither file has to import the other. */
export function UntradableNotice({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      className="mx-5 mb-3 flex-row items-start gap-2.5 rounded-[14px] border px-3.5 py-3"
      style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }}
    >
      <Ban size={16} color={C.danger} strokeWidth={2.5} style={{ marginTop: 1 }} />
      <Text className="flex-1" style={{ fontSize: 12.5, lineHeight: 18, color: C.textSecondary }}>
        <Text style={{ fontWeight: '700', color: C.textPrimary }}>{name}</Text> can’t be traded in Pokémon GO. Mythical
        Pokémon (except Meltan and Melmetal), Zygarde, Eternatus and special forms like White Kyurem, Ultra Necrozma
        and Crowned Sword Zacian never change hands, so they can’t be listed, wanted or offered.
      </Text>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} className="active:opacity-70">
        <X size={14} color={C.textMuted} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
