import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';

import { findPokemon } from '@/constants/pokedex';
import { COLORS } from '@/constants/theme';
import { dexLabel } from '@/lib/format';
import { useTradeStore } from '@/store/trade-store';

/**
 * The removable "#150 Mewtwo ✕" pill for the feed's species search (`searchPokemonId`). Reads and clears the
 * store itself and renders nothing when no species is searched, so the feed header and the filter sheet show
 * the same pill from one definition (and neither can forget to clear it). The label's dex format comes from
 * `dexLabel`, the app's one dex-number formatter.
 */
export function SearchSpeciesPill() {
  const searchPokemonId = useTradeStore((s) => s.searchPokemonId);
  const setSearchPokemonId = useTradeStore((s) => s.setSearchPokemonId);
  if (searchPokemonId === null) return null;

  const name = findPokemon(searchPokemonId)?.name ?? dexLabel(searchPokemonId);
  return (
    <View className="flex-row">
      <Pressable
        onPress={() => setSearchPokemonId(null)}
        accessibilityRole="button"
        accessibilityLabel={`Clear ${name} search`}
        hitSlop={6}
        className="flex-row items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-2.5 active:opacity-70"
        style={{ borderColor: COLORS.accentBlue, backgroundColor: 'rgba(79,179,255,0.12)' }}
      >
        <Text className="font-display-semi" style={{ fontSize: 12, color: COLORS.accentBlue }}>
          {`${dexLabel(searchPokemonId)} ${name}`}
        </Text>
        <X size={13} color={COLORS.accentBlue} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
