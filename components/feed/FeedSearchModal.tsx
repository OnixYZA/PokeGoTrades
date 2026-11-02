import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Flame, Search, X } from 'lucide-react-native';

import { MODAL_COLORS } from '@/components/modals/tokens';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { matchPokemonType, POKEDEX, searchPokedex, type PokedexEntry } from '@/constants/pokedex';
import { MOCK_MARKET_SIGNALS } from '@/data/market';
import { fetchTopWanted } from '@/lib/api/market';
import { USE_SUPABASE } from '@/lib/data-source';
import { trendingSpecies } from '@/lib/feed-search';
import { creatureDisplayName, dexLabel } from '@/lib/format';
import { useTradeStore } from '@/store/trade-store';

const C = MODAL_COLORS;

/** Same cap as PokemonPickerModal: plenty for "find the one you meant"; an empty query lists the whole dex. */
const SEARCH_RESULT_LIMIT = 60;

interface FeedSearchModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The feed's search sheet, opened from the header's magnifier. It narrows the feed by SPECIES (tap a row or a
 * trending chip: `setSearchPokemonId`) or by TYPE (the banner shown when the query names a type: it switches on that
 * type's include chip, the very `type:<Type>` filter the filter sheet has). It is the picker's idiom — a full
 * native `Modal`, auto-focused field, ranked `searchPokedex` results, the whole dex while nothing is typed — but
 * it SELECTS a search rather than building a trade list, so there is no shiny toggle, no form step, and
 * untradable species stay listed (searching "Mew" must find the dex entry; it just matches no listings).
 *
 * WHAT IS SELECTED LIVES IN THE STORE, not here: the sheet closes on every choice, and the feed header's pill
 * (`SearchSpeciesPill`) and the filter sheet read `searchPokemonId` from there. The type banner replaces any
 * species search (choosing "all Dragon listings" while "Mewtwo" is pinned would otherwise silently AND to
 * nothing); picking a species leaves the type chips alone, so the two narrow the feed together.
 *
 * TRENDING comes from market demand, not a hand-kept list: `MOCK_MARKET_SIGNALS` in mock mode, a top-wanted read
 * of `pokemon_market_demand` (`fetchTopWanted`) with Supabase, reduced by `trendingSpecies` (lib/feed-search.ts),
 * which falls back to a curated constant when there is no data. A failed read just shows that fallback.
 */
export function FeedSearchModal({ visible, onClose }: FeedSearchModalProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<number[]>(() => trendingSpecies(MOCK_MARKET_SIGNALS));
  const inputRef = useRef<TextInput>(null);
  const setSearchPokemonId = useTradeStore((s) => s.setSearchPokemonId);
  const setListingFilter = useTradeStore((s) => s.setListingFilter);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); // never reopen showing the previous search
    // The field mounts into a fresh native Modal host on every open and `autoFocus` only fires on first mount,
    // so focus it ourselves one frame later (same as PokemonPickerModal).
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [visible]);

  // Refresh the live trending list each open; the mock list is static, so there is nothing to fetch.
  useEffect(() => {
    if (!visible || !USE_SUPABASE) return;
    let cancelled = false;
    fetchTopWanted()
      .then((signals) => !cancelled && setTrending(trendingSpecies(signals)))
      .catch(() => !cancelled && setTrending(trendingSpecies(new Map()))); // curated fallback
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const trimmed = query.trim();
  const results = useMemo(() => (trimmed.length === 0 ? POKEDEX : searchPokedex(query, SEARCH_RESULT_LIMIT)), [query, trimmed]);
  const matchedType = useMemo(() => matchPokemonType(query), [query]);

  const selectSpecies = (pokemonId: number) => {
    setSearchPokemonId(pokemonId);
    onClose();
  };

  const selectType = () => {
    if (!matchedType) return;
    const key = `type:${matchedType}` as const;
    setListingFilter(key, 'include');
    setSearchPokemonId(null);
    onClose();
  };

  const renderItem = ({ item }: ListRenderItemInfo<PokedexEntry>) => (
    <SearchRow entry={item} onPress={() => selectSpecies(item.pokemonId)} />
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Full-bleed backdrop + inner no-op Pressable: the picker's outer/inner idiom. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close search"
        style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.92)' }}
        onPress={onClose}
      >
        <View className="flex-1 items-center" pointerEvents="box-none">
          <Pressable onPress={() => {}} className="w-full max-w-md flex-1 mx-auto">
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
                <SearchHeader query={query} onChangeQuery={setQuery} inputRef={inputRef} onClose={onClose} />
                <FlatList
                  data={results}
                  keyExtractor={(item) => String(item.pokemonId)}
                  renderItem={renderItem}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingTop: 4,
                    paddingBottom: insets.bottom + 16,
                    gap: 8,
                    flexGrow: 1,
                  }}
                  ListHeaderComponent={
                    <View className="gap-3 pb-1">
                      {matchedType && <TypeBanner type={matchedType} onPress={selectType} />}
                      {trimmed.length === 0 && <TrendingRow ids={trending} onSelect={selectSpecies} />}
                    </View>
                  }
                  ListEmptyComponent={
                    // A type query that names no species by name still has the banner above, so say less then.
                    <View className="items-center px-6 py-16">
                      <Text className="text-center" style={{ fontSize: 13, lineHeight: 19, color: C.textMuted }}>
                        {matchedType ? `No Pokémon are named "${trimmed}".` : `No Pokémon match "${trimmed}".`}
                      </Text>
                    </View>
                  }
                  showsVerticalScrollIndicator={false}
                />
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function SearchHeader({
  query,
  onChangeQuery,
  inputRef,
  onClose,
}: {
  query: string;
  onChangeQuery: (query: string) => void;
  inputRef: React.RefObject<TextInput | null>;
  onClose: () => void;
}) {
  return (
    <View
      className="flex-row items-center gap-2 border-b px-4 py-3"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <View className="relative min-w-0 flex-1 justify-center">
        <View className="absolute left-4 z-10">
          <Search size={18} color={C.textMuted} />
        </View>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search by name, #dex, or type (e.g. Dragon)…"
          placeholderTextColor={C.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search listings by Pokémon name, dex number or type"
          className="rounded-[14px] border py-3.5 pl-[46px] pr-11"
          style={{
            backgroundColor: C.bgCard,
            borderColor: C.borderDefault,
            fontSize: 15,
            fontWeight: '500',
            color: C.textPrimary,
          }}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => onChangeQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search text"
            hitSlop={8}
            className="absolute right-4 active:opacity-70"
          >
            <X size={16} color={C.textMuted} strokeWidth={2.5} />
          </Pressable>
        )}
      </View>
      <IconButton
        accessibilityLabel="Close search"
        onPress={onClose}
        size={44}
        radius={14}
        className="border"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <X size={16} color={C.textPrimary} strokeWidth={2.5} />
      </IconButton>
    </View>
  );
}

function TypeBanner({ type, onPress }: { type: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter all ${type}-type listings`}
      accessibilityHint="Closes search and shows only listings of this type"
      className="flex-row items-center gap-2 rounded-[14px] border px-4 py-3 active:opacity-80"
      style={{ backgroundColor: 'rgba(56,189,248,0.1)', borderColor: C.blue }}
    >
      <Search size={16} color={C.blue} />
      <Text className="min-w-0 flex-1 font-display-semi" numberOfLines={2} style={{ fontSize: 13, color: C.blue }}>
        {`Filter all ${type}-type listings`}
      </Text>
    </Pressable>
  );
}

function TrendingRow({ ids, onSelect }: { ids: number[]; onSelect: (pokemonId: number) => void }) {
  return (
    <View className="gap-2 pt-3">
      <View className="flex-row items-center gap-1.5">
        <Flame size={12} color={C.gold} />
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          TRENDING SEARCHES
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {ids.map((id) => {
          const name = creatureDisplayName({ pokemonId: id });
          return (
            <Pressable
              key={id}
              onPress={() => onSelect(id)}
              accessibilityRole="button"
              accessibilityLabel={`Search ${name}, trending`}
              className="rounded-full border px-3 py-2 active:opacity-70"
              style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
            >
              <Text className="font-display-semi" style={{ fontSize: 12, color: C.textPrimary }}>
                {`${dexLabel(id)} ${name}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="font-mono pt-2" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
        ALL POKÉMON
      </Text>
    </View>
  );
}

function SearchRow({ entry, onPress }: { entry: PokedexEntry; onPress: () => void }) {
  const displayName = creatureDisplayName({ pokemonId: entry.pokemonId });
  const dex = dexLabel(entry.pokemonId);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Search listings for ${displayName}, ${dex}`}
      className="flex-row items-center gap-3 rounded-[14px] border px-3 py-2.5 active:opacity-80"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Chip creature={{ pokemonId: entry.pokemonId, hue: entry.hue, shiny: false }} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>
          {displayName}
        </Text>
        <Text className="font-mono mt-0.5" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.5 }}>
          {dex}
        </Text>
      </View>
      <TypeBadge creature={{ pokemonId: entry.pokemonId }} size="sm" />
    </Pressable>
  );
}
