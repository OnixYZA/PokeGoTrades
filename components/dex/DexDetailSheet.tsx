import { router } from 'expo-router';
import { Ban, Check, Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TierPill } from '@/components/dex/TierPill';
import { MODAL_COLORS } from '@/components/modals/tokens';
import { DemandBadge } from '@/components/ui/DemandBadge';
import { GigantamaxBadge } from '@/components/ui/GigantamaxBadge';
import { IconButton } from '@/components/ui/IconButton';
import { Sprite } from '@/components/ui/Sprite';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { marketSignalKey, type MarketSignal } from '@/constants/market';
import {
  canGigantamax,
  creatureHue,
  defaultFormOf,
  findPokemon,
  formsOf,
  isPokemonUntradable,
  META_TIER_DISCLAIMER,
  metaRanksOf,
  statsOf,
  typesOf,
} from '@/constants/pokedex';
import { MOCK_MARKET_SIGNALS } from '@/data/market';
import { fetchMarketDemand } from '@/lib/api/market';
import { USE_SUPABASE } from '@/lib/data-source';
import { barFraction, META_TRACKS, statCeilings } from '@/lib/dex-explorer';
import { creatureFormLabel, creatureFullName, dexLabel, formatCp } from '@/lib/format';
import { useTradeStore } from '@/store/trade-store';

const C = MODAL_COLORS;

const PLAIN_DEFAULT_LABEL = 'Standard';

type DemandState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; signals: ReadonlyMap<string, MarketSignal> | Readonly<Record<string, MarketSignal>> };

function signalFor(state: DemandState, pokemonId: number, shiny: boolean): MarketSignal | undefined {
  if (state.status !== 'ready') return undefined;
  const key = marketSignalKey(pokemonId, shiny);
  return state.signals instanceof Map ? state.signals.get(key) : (state.signals as Record<string, MarketSignal>)[key];
}

interface DexDetailSheetProps {
  /** The species being viewed, or `null` when the sheet is closed. */
  pokemonId: number | null;
  onClose: () => void;
}

/**
 * The Pokédex Explorer's detail sheet: one species, one chosen form, an optional shiny preview.
 *
 * FORMS ARE VIEWABLE EVEN WHEN UNTRADABLE. `FormPicker` refuses an untradable form (it feeds Create Listing,
 * where one can never be listed), but this sheet is a reference: a trainer looking up White Kyurem's stats must
 * be able to see them. So the chips here select every form and only MARK the untradable ones with the Ban icon
 * (`isPokemonUntradable`, the same rule as everywhere), and "Find in Trade Hub" is the one thing that respects it.
 *
 * Everything shown comes from `statsOf` / `metaRanksOf` / `typesOf` for the selected form; a form the generated
 * data has no entry for shows "not available" rather than the species' numbers, which would be a guess.
 *
 * DEMAND IS PER SPECIES AND SHINY, not per form: `pokemon_market_demand` is keyed by `marketSignalKey(id, shiny)`,
 * so it is fetched once per opened species and the card shows the Standard and Shiny rows side by side.
 *
 * The parent should render it with the species it wants; the sheet resets its form and shiny state on every new
 * species (keyed on `pokemonId`).
 */
export function DexDetailSheet({ pokemonId, onClose }: DexDetailSheetProps) {
  return (
    <Modal visible={pokemonId !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {pokemonId !== null && <SheetBody key={pokemonId} pokemonId={pokemonId} onClose={onClose} />}
    </Modal>
  );
}

function SheetBody({ pokemonId, onClose }: { pokemonId: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const setSearchPokemonId = useTradeStore((s) => s.setSearchPokemonId);
  const [formCode, setFormCode] = useState<string | null>(null);
  const [shiny, setShiny] = useState(false);
  const [demand, setDemand] = useState<DemandState>(USE_SUPABASE ? { status: 'loading' } : { status: 'ready', signals: MOCK_MARKET_SIGNALS });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    setDemand({ status: 'loading' });
    fetchMarketDemand([pokemonId])
      .then((signals) => !cancelled && setDemand({ status: 'ready', signals }))
      .catch(() => !cancelled && setDemand({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [pokemonId, attempt]);

  const entry = findPokemon(pokemonId);
  const creature = { pokemonId, formCode, shiny };
  const stats = statsOf({ pokemonId, formCode });
  const ranks = metaRanksOf({ pokemonId, formCode });
  const speciesUntradable = isPokemonUntradable(pokemonId);
  const formUntradable = formCode !== null && isPokemonUntradable(pokemonId, formCode);
  const name = creatureFullName({ pokemonId, formCode });

  const options = useMemo(() => {
    const defaultCode = defaultFormOf(pokemonId);
    const defaultLabel = (defaultCode && creatureFormLabel({ pokemonId, formCode: defaultCode })) || PLAIN_DEFAULT_LABEL;
    return [
      { code: null as string | null, label: defaultLabel },
      ...formsOf(pokemonId).map((code) => ({ code: code as string | null, label: creatureFormLabel({ pokemonId, formCode: code }) ?? code })),
    ];
  }, [pokemonId]);

  const findInTradeHub = () => {
    setSearchPokemonId(pokemonId);
    onClose();
    router.navigate('/');
  };

  return (
    <View className="flex-1" style={{ backgroundColor: 'rgba(8,8,12,0.92)' }}>
      <View className="w-full max-w-md flex-1 mx-auto" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between border-b px-4 py-3" style={{ borderBottomColor: C.borderSubtle }}>
          <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
            {`${dexLabel(pokemonId)} · POKÉDEX`}
          </Text>
          <IconButton
            accessibilityLabel="Close Pokédex details"
            onPress={onClose}
            size={40}
            radius={14}
            className="border"
            style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
          >
            <X size={16} color={C.textPrimary} strokeWidth={2.5} />
          </IconButton>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="flex-row items-center gap-4">
            <Sprite creature={{ ...creature, hue: creatureHue({ pokemonId, formCode, hue: entry?.hue ?? 0 }) || (entry?.hue ?? 0) }} size={96} />
            <View className="min-w-0 flex-1 gap-2">
              <Text className="font-display" numberOfLines={2} style={{ fontSize: 22, color: C.textPrimary }}>
                {name}
              </Text>
              <TypeBadge creature={{ pokemonId, formCode }} />
              <View className="flex-row flex-wrap items-center gap-1.5">
                {stats && (
                  <Text className="font-mono-semi" style={{ fontSize: 12, color: C.gold }}>
                    {`MAX ${formatCp(stats.maxCp)}`}
                  </Text>
                )}
                {canGigantamax(pokemonId) && <GigantamaxBadge size="sm" />}
              </View>
            </View>
          </View>

          {/* Form + shiny */}
          {options.length > 1 && (
            <View className="gap-2.5">
              <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
                FORM
              </Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Form" className="flex-row flex-wrap gap-2">
                {options.map((option) => {
                  const selected = option.code === formCode;
                  const untradable = option.code !== null && isPokemonUntradable(pokemonId, option.code);
                  return (
                    <Pressable
                      key={option.code ?? 'default'}
                      onPress={() => setFormCode(option.code)}
                      accessibilityRole="radio"
                      accessibilityLabel={untradable ? `${option.label}, can’t be traded in Pokémon GO` : option.label}
                      accessibilityState={{ selected }}
                      hitSlop={4}
                      className="flex-row items-center gap-1 rounded-full px-3.5 py-2.5 active:opacity-80"
                      style={{ backgroundColor: selected ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.06)', maxWidth: '100%', opacity: untradable && !selected ? 0.6 : 1 }}
                    >
                      {selected && <Check size={12} color={C.gold} strokeWidth={2.5} />}
                      {untradable && <Ban size={12} color={C.danger} strokeWidth={2.5} />}
                      <Text numberOfLines={1} className="font-mono-semi shrink uppercase" style={{ fontSize: 11, letterSpacing: 0.6, color: selected ? C.gold : C.textMuted }}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <Pressable
            onPress={() => setShiny((v) => !v)}
            accessibilityRole="switch"
            accessibilityLabel="Shiny preview"
            accessibilityState={{ checked: shiny }}
            className="flex-row items-center justify-between rounded-[14px] border px-4 py-3 active:opacity-80"
            style={{ backgroundColor: C.bgCard, borderColor: shiny ? C.pink : C.borderDefault }}
          >
            <Text className="font-display-semi" style={{ fontSize: 13, color: C.textPrimary }}>
              Shiny preview
            </Text>
            <View className="h-6 w-11 justify-center rounded-full px-0.5" style={{ backgroundColor: shiny ? C.pink : C.borderDefault }}>
              <View className="h-5 w-5 rounded-full bg-white" style={{ alignSelf: shiny ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>

          {formUntradable && (
            <View
              accessibilityRole="alert"
              className="flex-row items-start gap-2.5 rounded-[14px] border px-3.5 py-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }}
            >
              <Ban size={16} color={C.danger} strokeWidth={2.5} style={{ marginTop: 1 }} />
              <Text className="flex-1" style={{ fontSize: 12.5, lineHeight: 18, color: C.textSecondary }}>
                {`${name} can’t be traded in Pokémon GO.`}
              </Text>
            </View>
          )}

          {/* Base stats */}
          <Card title="BASE STATS">
            {stats ? (
              <View className="gap-3">
                <StatBar label="ATK" spoken="Attack" value={stats.atk} ceiling={statCeilings().atk} color="#ff5c8a" />
                <StatBar label="DEF" spoken="Defense" value={stats.def} ceiling={statCeilings().def} color="#4fb3ff" />
                <StatBar label="STA" spoken="Stamina" value={stats.sta} ceiling={statCeilings().sta} color="#7dffb3" />
                <View className="flex-row items-center justify-between border-t pt-3" style={{ borderTopColor: C.borderSubtle }}>
                  <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 0.8 }}>
                    MAX CP (LV. 50)
                  </Text>
                  <Text accessibilityLabel={`Max CP at level 50: ${stats.maxCp}`} className="font-display" style={{ fontSize: 20, color: C.gold }}>
                    {formatCp(stats.maxCp)}
                  </Text>
                </View>
                <Text style={{ fontSize: 10.5, color: C.textDim }}>Bars are scaled to the highest base stat in the Pokédex.</Text>
              </View>
            ) : (
              <Muted>Base stats are not available for this form.</Muted>
            )}
          </Card>

          {/* Tiers */}
          <Card title="META TIERS">
            {ranks ? (
              <>
                <View className="flex-row flex-wrap gap-2">
                  {META_TRACKS.map(({ key, label }) => {
                    const tier = ranks[key];
                    return (
                      <View
                        key={key}
                        accessible
                        accessibilityLabel={tier ? `${label}: tier ${tier}` : `${label}: unranked`}
                        className="items-start justify-between gap-2 rounded-[12px] border p-3"
                        style={{ width: '48.5%', minHeight: 84, backgroundColor: C.bgCardAlt, borderColor: C.borderDefault }}
                      >
                        <Text style={{ fontSize: 11, lineHeight: 15, color: C.textSecondary }}>{label}</Text>
                        {tier ? <TierPill tier={tier} size="lg" /> : <Text style={{ fontSize: 12, color: C.textDim }}>Unranked</Text>}
                      </View>
                    );
                  })}
                </View>
                <Text className="mt-3" style={{ fontSize: 11, lineHeight: 16, color: C.textMuted }}>
                  {META_TIER_DISCLAIMER}
                </Text>
              </>
            ) : (
              <Muted>No tier ranking for this form.</Muted>
            )}
          </Card>

          {/* Demand */}
          <Card title="TRADE DEMAND">
            {demand.status === 'loading' && (
              <View accessibilityLabel="Loading trade demand" className="flex-row items-center gap-2 py-2">
                <ActivityIndicator size="small" color={C.blue} />
                <Muted>Loading demand…</Muted>
              </View>
            )}
            {demand.status === 'error' && (
              <View className="items-start gap-2">
                <Muted>Couldn’t load trade demand.</Muted>
                <Pressable
                  onPress={() => setAttempt((n) => n + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading trade demand"
                  className="rounded-full border px-3.5 py-2 active:opacity-80"
                  style={{ borderColor: C.borderDefault, backgroundColor: C.bgCardAlt }}
                >
                  <Text className="font-mono-semi uppercase" style={{ fontSize: 11, color: C.textPrimary }}>
                    Retry
                  </Text>
                </Pressable>
              </View>
            )}
            {demand.status === 'ready' && (
              <View className="gap-2.5">
                <DemandRow label="Standard" signal={signalFor(demand, pokemonId, false)} />
                <DemandRow label="Shiny" signal={signalFor(demand, pokemonId, true)} />
                <Text style={{ fontSize: 10.5, color: C.textDim }}>Counts are per species, across all forms.</Text>
              </View>
            )}
          </Card>

          {speciesUntradable ? (
            <Muted>This Pokémon can’t be traded, so it has no listings to find.</Muted>
          ) : (
            <Pressable
              onPress={findInTradeHub}
              accessibilityRole="button"
              accessibilityLabel={`Find ${entry?.name ?? 'this Pokémon'} in Trade Hub`}
              accessibilityHint="Closes this sheet and shows its listings in the feed"
              className="flex-row items-center justify-center gap-2 rounded-[14px] py-3.5 active:opacity-90"
              style={{ backgroundColor: C.blue }}
            >
              <Search size={16} color="#04121c" strokeWidth={2.5} />
              <Text className="font-display" style={{ fontSize: 14, color: '#04121c' }}>
                Find in Trade Hub
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-[16px] border p-4" style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}>
      <Text accessibilityRole="header" className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 12.5, lineHeight: 18, color: C.textMuted }}>{children}</Text>;
}

function StatBar({ label, spoken, value, ceiling, color }: { label: string; spoken: string; value: number; ceiling: number; color: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${spoken} ${value}, highest in the Pokédex is ${ceiling}`}
      className="flex-row items-center gap-3"
    >
      <Text className="font-mono-semi" style={{ width: 32, fontSize: 11, color: C.textMuted }}>
        {label}
      </Text>
      <Text className="font-display" style={{ width: 36, fontSize: 14, color: C.textPrimary, textAlign: 'right' }}>
        {value}
      </Text>
      <View className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: C.borderSubtle }}>
        <View className="h-2 rounded-full" style={{ width: `${Math.round(barFraction(value, ceiling) * 100)}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}

function DemandRow({ label, signal }: { label: string; signal: MarketSignal | undefined }) {
  return (
    <View
      accessible
      accessibilityLabel={
        signal ? `${label}: ${signal.wanted} wanted, ${signal.offered} offered` : `${label}: no trade activity yet`
      }
      className="flex-row items-center justify-between gap-2"
    >
      <Text className="font-display-semi" style={{ width: 70, fontSize: 13, color: C.textPrimary }}>
        {label}
      </Text>
      {signal ? (
        <>
          <Text className="font-mono" style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>
            {`${signal.wanted} wanted · ${signal.offered} offered`}
          </Text>
          <DemandBadge market={signal} />
        </>
      ) : (
        <Text className="font-mono" style={{ flex: 1, fontSize: 12, color: C.textDim }}>
          No trade activity yet
        </Text>
      )}
    </View>
  );
}
