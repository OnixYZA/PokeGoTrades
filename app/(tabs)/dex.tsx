import { BookOpen, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View, type ListRenderItemInfo } from 'react-native';

import { DexDetailSheet } from '@/components/dex/DexDetailSheet';
import { TierPill } from '@/components/dex/TierPill';
import { MODAL_COLORS } from '@/components/modals/tokens';
import { Chip } from '@/components/ui/Chip';
import { GigantamaxBadge } from '@/components/ui/GigantamaxBadge';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { canGigantamax, isPokemonUntradable, metaRanksOf, statsOf, type PokedexEntry } from '@/constants/pokedex';
import { COLORS } from '@/constants/theme';
import { bestTier, DEFAULT_DEX_QUERY, DEX_SORTS, DEX_TYPE_FILTERS, exploreDex, type DexQuery } from '@/lib/dex-explorer';
import { creatureDisplayName, dexLabel, formatCp } from '@/lib/format';

const C = MODAL_COLORS;

/**
 * Pokédex Explorer: the whole dex as a searchable, filterable, sortable reference, with a detail sheet per
 * species (stats, meta tiers, trade demand, a jump into the Trade Hub). It is a tab of its own because it
 * answers "what is this Pokémon worth to a trader?" without the feed's listing context. All list logic is
 * `exploreDex` (lib/dex-explorer.ts); this file only renders it.
 */
export default function DexScreen() {
  const [query, setQuery] = useState<DexQuery>(DEFAULT_DEX_QUERY);
  const [selected, setSelected] = useState<number | null>(null);
  const patch = (over: Partial<DexQuery>) => setQuery((q) => ({ ...q, ...over }));

  const results = useMemo(() => exploreDex(query), [query]);

  const renderItem = ({ item }: ListRenderItemInfo<PokedexEntry>) => <DexRow entry={item} onPress={() => setSelected(item.pokemonId)} />;

  return (
    <View className="flex-1 mx-auto w-full max-w-md">
      <View className="gap-3 pb-2 pt-2">
        <View className="flex-row items-center gap-3 px-[22px]">
          <BookOpen size={22} color={COLORS.accentBlue} />
          <View>
            <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 11, letterSpacing: 1.1 }}>
              Pokédex
            </Text>
            <Text className="font-display text-text-primary" style={{ fontSize: 26, letterSpacing: -0.52 }}>
              Explorer
            </Text>
          </View>
        </View>

        <View className="relative mx-[22px] justify-center">
          <View className="absolute left-4 z-10">
            <Search size={18} color={C.textMuted} />
          </View>
          <TextInput
            value={query.query}
            onChangeText={(text) => patch({ query: text })}
            placeholder="Search by name, #dex, or type…"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search the Pokédex by name, dex number or type"
            className="rounded-[14px] border py-3.5 pl-[46px] pr-11"
            style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault, fontSize: 15, fontWeight: '500', color: C.textPrimary }}
          />
          {query.query.length > 0 && (
            <Pressable
              onPress={() => patch({ query: '' })}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
              hitSlop={8}
              className="absolute right-4 active:opacity-70"
            >
              <X size={16} color={C.textMuted} strokeWidth={2.5} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, gap: 8 }}>
          {DEX_TYPE_FILTERS.map((type) => (
            <ToggleChip
              key={type ?? 'all'}
              label={type ?? 'All'}
              selected={query.type === type}
              onPress={() => patch({ type })}
              spoken={type ? `${type} type` : 'All types'}
            />
          ))}
        </ScrollView>

        <View className="flex-row flex-wrap items-center gap-2 px-[22px]">
          <ToggleChip label="Tradable only" selected={query.tradableOnly} onPress={() => patch({ tradableOnly: !query.tradableOnly })} />
          <ToggleChip label="G-Max" selected={query.gmaxOnly} onPress={() => patch({ gmaxOnly: !query.gmaxOnly })} spoken="Gigantamax only" />
          <View className="w-2" />
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
            SORT
          </Text>
          {DEX_SORTS.map(({ key, label }) => (
            <ToggleChip key={key} label={label} selected={query.sort === key} onPress={() => patch({ sort: key })} spoken={`Sort by ${label}`} radio />
          ))}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.pokemonId)}
        renderItem={renderItem}
        initialNumToRender={14}
        windowSize={9}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 8, flexGrow: 1 }}
        ListHeaderComponent={
          <Text accessibilityLiveRegion="polite" className="font-mono pb-1" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
            {`${results.length} POKÉMON`}
          </Text>
        }
        ListEmptyComponent={
          <View className="items-center px-6 py-16">
            <Text className="text-center" style={{ fontSize: 13, lineHeight: 19, color: C.textMuted }}>
              No Pokémon match these filters.
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <DexDetailSheet pokemonId={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function ToggleChip({ label, selected, onPress, spoken, radio = false }: { label: string; selected: boolean; onPress: () => void; spoken?: string; radio?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected }}
      hitSlop={6}
      className="rounded-full border px-3.5 py-2 active:opacity-80"
      style={{
        backgroundColor: selected ? 'rgba(79,179,255,0.16)' : 'rgba(255,255,255,0.06)',
        borderColor: selected ? 'rgba(79,179,255,0.5)' : COLORS.borderStrong,
      }}
    >
      <Text className="font-mono-semi uppercase" style={{ fontSize: 11, letterSpacing: 0.6, color: selected ? COLORS.accentBlue : COLORS.textMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

function DexRow({ entry, onPress }: { entry: PokedexEntry; onPress: () => void }) {
  const { pokemonId } = entry;
  const name = creatureDisplayName({ pokemonId });
  const stats = statsOf({ pokemonId });
  const best = bestTier(metaRanksOf({ pokemonId }));
  const untradable = isPokemonUntradable(pokemonId);
  const gmax = canGigantamax(pokemonId);

  const spoken = [
    `${name}, ${dexLabel(pokemonId)}`,
    stats ? `max CP ${stats.maxCp}` : undefined,
    best ? `best tier ${best.tier} in ${best.short}` : undefined,
    untradable ? 'untradable' : undefined,
    gmax ? 'can Gigantamax' : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens Pokédex details"
      className="flex-row items-center gap-3 rounded-[14px] border px-3 py-2.5 active:opacity-80"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Chip creature={{ pokemonId, hue: entry.hue, shiny: false }} size={44} />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.5 }}>
            {dexLabel(pokemonId)}
          </Text>
          {stats && (
            <Text className="font-mono" style={{ fontSize: 10, color: C.gold, letterSpacing: 0.5 }}>
              {formatCp(stats.maxCp)}
            </Text>
          )}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>
          {name}
        </Text>
        <View className="flex-row flex-wrap items-center gap-1">
          <TypeBadge creature={{ pokemonId }} size="sm" />
          {gmax && <GigantamaxBadge size="sm" />}
          {untradable && (
            <View className="rounded-full border px-1.5 py-[2px]" style={{ borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.1)' }}>
              <Text className="font-display uppercase" style={{ fontSize: 9, letterSpacing: 0.5, color: C.danger }}>
                Untradable
              </Text>
            </View>
          )}
        </View>
      </View>
      {best && <TierPill tier={best.tier} prefix={best.short} />}
    </Pressable>
  );
}
