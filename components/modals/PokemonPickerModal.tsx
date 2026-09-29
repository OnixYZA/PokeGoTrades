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
import { Ban, Check, Plus, Search, Sparkles, X } from 'lucide-react-native';

import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { hueBadgeStyle } from '@/constants/theme';
import { isPokemonUntradable, POKEDEX, searchPokedex, type PokedexEntry } from '@/constants/pokedex';
import { creatureDisplayName } from '@/lib/format';
import { spriteVariantKey, spriteVariantOf, type SpriteSubject } from '@/lib/sprite-url';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

/** Search results are capped, ranked matches — plenty for "find the one you meant". Browsing with an
 *  empty query instead lists the whole dex (FlatList only renders what's on screen either way), so
 *  scrolling from #1 actually reaches #1025 rather than stopping at an arbitrary page size. */
const SEARCH_RESULT_LIMIT = 60;

interface PokemonPickerModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** `shiny` is always `false` when `allowShiny` is off — a caller with its own separate Shiny toggle
   *  (`CreateListingModal`'s "CREATURE" slot) sets `allowShiny={false}` and ignores this argument. */
  onSelect: (pokemonId: number, shiny: boolean) => void;
  /** Whether this picker offers a Shiny toggle at all. Defaults on: most pickers (Arsenal, Wishlist,
   *  "Wanted in Return") have no shiny toggle of their own elsewhere in the flow. */
  allowShiny?: boolean;
  /** Already on the list this picker is adding to — shown disabled with an "ADDED" badge instead of
   *  being left out, so re-opening the picker still reads as the same dex, just partly checked off.
   *  Compared by `spriteVariantKey`, so a shiny and non-shiny entry for the same species are distinct:
   *  a row has no form/costume codes of its own (the dex doesn't carry those), so in practice this only
   *  ever discriminates on shiny. */
  exclude?: readonly SpriteSubject[];
}

/**
 * Full-dex search sheet shared by the Arsenal and Wishlist "+" buttons (app/(tabs)/profile.tsx) and by
 * CreateListingModal's "CREATURE" and "WANTED IN RETURN" slots. Every one of those is a trade list, so
 * untradable species (`isPokemonUntradable`) are never selectable here. They are still listed, dimmed and
 * marked, and tapping one explains why instead of silently doing nothing. Rows are species only (no form
 * codes), so in practice this catches Mythicals and Zygarde; fused forms cannot be picked here at all. Owns
 * its own native `Modal`, unlike the other components in this folder which are mounted inside a `Modal`
 * by their screen — this one has no screen-specific chrome to coordinate with, so keeping the two
 * together avoids every caller re-declaring the same `Modal` props.
 */
export function PokemonPickerModal({
  visible,
  title,
  onClose,
  onSelect,
  allowShiny = true,
  exclude,
}: PokemonPickerModalProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [shiny, setShiny] = useState(false);
  /** The untradable row the trainer last tapped, shown as an explanation above the list. */
  const [refused, setRefused] = useState<PokedexEntry | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); // never reopen showing the previous search
    setShiny(false); // never reopen with the previous open's shiny toggle still on
    setRefused(null);
    // The sheet's TextInput mounts into a fresh native Modal host each time `visible` flips true;
    // focusing on the very same tick can race that mount, so defer one frame. (`autoFocus` only ever
    // fires on first mount, not on a later re-open, which is why this manages focus itself instead.)
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [visible]);

  const excluded = useMemo(
    () => new Set((exclude ?? []).map((s) => spriteVariantKey(spriteVariantOf(s)))),
    [exclude],
  );
  const results = useMemo(
    () => (query.trim().length === 0 ? POKEDEX : searchPokedex(query, SEARCH_RESULT_LIMIT)),
    [query],
  );

  const changeQuery = (next: string) => {
    setQuery(next);
    setRefused(null);
  };

  const renderItem = ({ item }: ListRenderItemInfo<PokedexEntry>) => {
    const untradable = isPokemonUntradable(item.pokemonId);
    return (
      <PokedexRow
        entry={item}
        shiny={shiny}
        untradable={untradable}
        added={excluded.has(spriteVariantKey(spriteVariantOf({ pokemonId: item.pokemonId, shiny })))}
        onPress={() => (untradable ? setRefused(item) : onSelect(item.pokemonId, allowShiny ? shiny : false))}
      />
    );
  };

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
                <SearchField
                  query={query}
                  onChangeQuery={changeQuery}
                  inputRef={inputRef}
                  allowShiny={allowShiny}
                  shiny={shiny}
                  onToggleShiny={() => setShiny((v) => !v)}
                />
                {refused && <UntradableNotice name={refused.name} onDismiss={() => setRefused(null)} />}
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

/** Beside the search field, not inside it — the picker's own Shiny toggle (Task 2), independent of the
 *  text query. Pink/✦, the same accent as the shiny badge drawn on `Chip`/`Sprite` (`#ff6bd6`), so a
 *  trainer already reads "pink sparkle = shiny" before ever looking at the label. */
function ShinyToggle({ shiny, onToggle }: { shiny: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: shiny }}
      accessibilityLabel="Shiny"
      accessibilityHint="Adds the shiny variant of the Pokémon you pick"
      className="ml-2 flex-row items-center gap-1.5 rounded-[14px] border px-3 active:opacity-80"
      // No fixed height: the row's default `alignItems: 'stretch'` sizes the pill to the search input.
      style={
        shiny
          ? [MODAL_SURFACE.togglePink, { borderColor: C.pink }]
          : { backgroundColor: C.bgCard, borderColor: C.borderDefault }
      }
    >
      <Sparkles size={15} color={shiny ? '#fff' : C.textMuted} strokeWidth={2.2} />
      <Text
        className="font-display-semi"
        style={{ fontSize: 12, color: shiny ? '#fff' : C.textMuted }}
      >
        Shiny
      </Text>
    </Pressable>
  );
}

function SearchField({
  query,
  onChangeQuery,
  inputRef,
  allowShiny,
  shiny,
  onToggleShiny,
}: {
  query: string;
  onChangeQuery: (query: string) => void;
  inputRef: RefObject<TextInput | null>;
  allowShiny: boolean;
  shiny: boolean;
  onToggleShiny: () => void;
}) {
  return (
    <View className="flex-row px-5 pb-3 pt-4">
      <View className="relative flex-1 justify-center">
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
      {allowShiny && <ShinyToggle shiny={shiny} onToggle={onToggleShiny} />}
    </View>
  );
}

/** Why the row the trainer just tapped did nothing. Sits between the search field and the list, so it stays
 *  in view however far the list has scrolled. */
function UntradableNotice({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      className="mx-5 mb-3 flex-row items-start gap-2.5 rounded-[14px] border px-3.5 py-3"
      style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }}
    >
      <Ban size={16} color={C.danger} strokeWidth={2.5} style={{ marginTop: 1 }} />
      <Text className="flex-1" style={{ fontSize: 12.5, lineHeight: 18, color: C.textSecondary }}>
        <Text style={{ fontWeight: '700', color: C.textPrimary }}>{name}</Text> can’t be traded in Pokémon GO. Mythical
        Pokémon (except Meltan and Melmetal), Zygarde and fused forms like White Kyurem never change hands, so they
        can’t be listed, wanted or offered.
      </Text>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} className="active:opacity-70">
        <X size={14} color={C.textMuted} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function PokedexRow({
  entry,
  shiny,
  untradable,
  added,
  onPress,
}: {
  entry: PokedexEntry;
  shiny: boolean;
  /** Dimmed and marked, and the press explains the refusal (`UntradableNotice`) rather than adding. */
  untradable: boolean;
  added: boolean;
  onPress: () => void;
}) {
  const dex = `#${String(entry.pokemonId).padStart(3, '0')}`;
  const displayName = creatureDisplayName({ name: entry.name, shiny });
  const label = untradable
    ? `${displayName}, ${dex}, can’t be traded in Pokémon GO`
    : added
      ? `${displayName}, already added`
      : `Add ${displayName}, ${dex}, ${entry.type} type`;
  // An untradable row stays pressable (the press explains the refusal), so only an added one is disabled.
  const blocked = added && !untradable;
  const dimmed = untradable || added;
  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={untradable ? 'Explains why it can’t be added' : undefined}
      accessibilityState={{ disabled: blocked }}
      className={`flex-row items-center gap-3 rounded-[14px] border px-3 py-2.5 ${dimmed ? 'opacity-50' : 'active:opacity-80'}`}
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Chip creature={{ pokemonId: entry.pokemonId, hue: entry.hue, shiny }} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>
          {displayName}
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
      {untradable ? (
        <View
          className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}
        >
          <Ban size={12} color={C.danger} strokeWidth={3} />
          <Text className="font-mono-bold" style={{ fontSize: 9, color: C.danger, letterSpacing: 0.6 }}>
            UNTRADABLE
          </Text>
        </View>
      ) : added ? (
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
