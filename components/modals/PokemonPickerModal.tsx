import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
import { Check, Plus, Search, X } from 'lucide-react-native';

import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { hueBadgeStyle } from '@/constants/theme';
import { POKEDEX, searchPokedex, type PokedexEntry } from '@/constants/pokedex';

import { MODAL_COLORS } from './tokens';

const C = MODAL_COLORS;

/** Search results are capped, ranked matches — plenty for "find the one you meant". Browsing with an
 *  empty query instead lists the whole dex (FlatList only renders what's on screen either way), so
 *  scrolling from #1 actually reaches #1025 rather than stopping at an arbitrary page size. */
const SEARCH_RESULT_LIMIT = 60;

interface PokemonPickerModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSelect: (pokemonId: number) => void;
  /** Already on the list this picker is adding to — shown disabled with an "ADDED" badge instead of
   *  being left out, so re-opening the picker still reads as the same dex, just partly checked off. */
  excludeIds?: readonly number[];
}

/**
 * Full-dex search sheet shared by the Arsenal and Wishlist "+" buttons (app/(tabs)/profile.tsx). Owns
 * its own native `Modal`, unlike the other components in this folder which are mounted inside a `Modal`
 * by their screen — this one has no screen-specific chrome to coordinate with, so keeping the two
 * together avoids every caller re-declaring the same `Modal` props.
 */
export function PokemonPickerModal({ visible, title, onClose, onSelect, excludeIds }: PokemonPickerModalProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); // never reopen showing the previous search
    // The sheet's TextInput mounts into a fresh native Modal host each time `visible` flips true;
    // focusing on the very same tick can race that mount, so defer one frame. (`autoFocus` only ever
    // fires on first mount, not on a later re-open, which is why this manages focus itself instead.)
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [visible]);

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const results = useMemo(
    () => (query.trim().length === 0 ? POKEDEX : searchPokedex(query, SEARCH_RESULT_LIMIT)),
    [query],
  );

  const renderItem = ({ item }: ListRenderItemInfo<PokedexEntry>) => (
    <PokedexRow entry={item} added={excluded.has(item.pokemonId)} onPress={() => onSelect(item.pokemonId)} />
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Full-bleed backdrop: a tap anywhere outside the max-w-md column closes the sheet, same idiom
       *  as components/ui/Dropdown.tsx's outer/inner Pressable pair. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.92)' }}
        onPress={onClose}
      >
        <View className="flex-1 items-center" pointerEvents="box-none">
          <Pressable onPress={() => {}} className="w-full max-w-[420px] flex-1">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1 }}
            >
              <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
                <Header title={title} onClose={onClose} />
                <SearchField query={query} onChangeQuery={setQuery} inputRef={inputRef} />
                <FlatList
                  data={results}
                  keyExtractor={(item) => String(item.pokemonId)}
                  renderItem={renderItem}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingTop: 4,
                    paddingBottom: insets.bottom + 16,
                    gap: 8,
                    flexGrow: 1,
                  }}
                  ListEmptyComponent={<EmptyState query={query} />}
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

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between border-b px-5 py-4"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <Text className="font-display" style={{ fontSize: 17, color: C.textPrimary }}>
        {title}
      </Text>
      <IconButton
        accessibilityLabel="Close"
        onPress={onClose}
        size={36}
        radius={12}
        className="border"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <X size={16} color={C.textPrimary} strokeWidth={2.5} />
      </IconButton>
    </View>
  );
}

function SearchField({
  query,
  onChangeQuery,
  inputRef,
}: {
  query: string;
  onChangeQuery: (query: string) => void;
  inputRef: RefObject<TextInput | null>;
}) {
  return (
    <View className="px-5 pb-3 pt-4">
      <View className="relative justify-center">
        <View className="absolute left-4 z-10">
          <Search size={18} color={C.textMuted} />
        </View>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search by name or #dex number…"
          placeholderTextColor={C.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search Pokémon by name or dex number"
          className="rounded-[14px] border py-4 pl-[46px] pr-11"
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
            accessibilityLabel="Clear search"
            hitSlop={8}
            className="absolute right-4 active:opacity-70"
          >
            <X size={16} color={C.textMuted} strokeWidth={2.5} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PokedexRow({ entry, added, onPress }: { entry: PokedexEntry; added: boolean; onPress: () => void }) {
  const dex = `#${String(entry.pokemonId).padStart(3, '0')}`;
  return (
    <Pressable
      onPress={added ? undefined : onPress}
      disabled={added}
      accessibilityRole="button"
      accessibilityLabel={added ? `${entry.name}, already added` : `Add ${entry.name}, ${dex}, ${entry.type} type`}
      accessibilityState={{ disabled: added }}
      className={`flex-row items-center gap-3 rounded-[14px] border px-3 py-2.5 ${added ? 'opacity-50' : 'active:opacity-80'}`}
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Chip pokemonId={entry.pokemonId} hue={entry.hue} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>
          {entry.name}
        </Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.5 }}>
            {dex}
          </Text>
          <View className="rounded-full border px-2 py-0.5" style={hueBadgeStyle(entry.hue)}>
            <Text className="font-mono" style={{ fontSize: 9, color: C.textSecondary, letterSpacing: 0.6 }}>
              {entry.type.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
      {added ? (
        <View
          className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}
        >
          <Check size={12} color={C.success} strokeWidth={3} />
          <Text className="font-mono-bold" style={{ fontSize: 9, color: C.success, letterSpacing: 0.6 }}>
            ADDED
          </Text>
        </View>
      ) : (
        <Plus size={18} color={C.blue} strokeWidth={2.5} />
      )}
    </Pressable>
  );
}

function EmptyState({ query }: { query: string }) {
  // Reachable only for a real, non-empty query: an empty query always renders the full dex above.
  return (
    <View className="items-center px-6 py-16">
      <Text className="text-center" style={{ fontSize: 13, lineHeight: 19, color: C.textMuted }}>
        {`No Pokémon match "${query.trim()}".`}
      </Text>
    </View>
  );
}
