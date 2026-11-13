import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, Globe, Home, LocateFixed, MapPin, Search, X } from 'lucide-react-native';

import { IconButton } from '@/components/ui/IconButton';
import { ToastHost } from '@/components/ui/ToastHost';
import { MODAL_COLORS } from '@/components/modals/tokens';
import {
  ALL_LOCATIONS,
  LOCATION_MAX_LENGTH,
  VICINITY_RADIUS_LABEL,
  customLocationChoice,
  extractCity,
  isAllLocations,
  locationKey,
  looksLikeCoordinates,
  type LocationName,
} from '@/constants/locations';
import { searchLocations } from '@/lib/location-api';
import { useVicinity } from '@/lib/use-vicinity';
import { useTradeStore } from '@/store/trade-store';

const C = MODAL_COLORS;
const ACCENT = '#4fb3ff';
const ROW_BORDER = '#151b2a';
const SEARCH_DEBOUNCE_MS = 350;

interface LocationPickerSheetProps {
  visible: boolean;
  title: string;
  current: LocationName | null;
  homeLocation: LocationName | null;
  onSelect: (label: LocationName) => void;
  onClose: () => void;
  /** Home-location editing: offers a "Clear home location" row that calls `onClear`. */
  allowClear?: boolean;
  onClear?: () => void;
  /** False when editing the home location itself (a "Home" shortcut would be circular). */
  showHomeRow?: boolean;
  /** True only for the feed filter: enables "All locations" and "All of <City>" shortcuts. */
  allowAllLocations?: boolean;
}

/**
 * The one location picker (feed filter, Create Listing, home-location editing). A place label is chosen from
 * API suggestions, recent picks, typed custom labels, or a coarse browser fix (web only), and only ever leaves
 * this component through `constants/locations.ts` rules, so a coordinate cannot come out of it. `onSelect` /
 * `onClear` do not close the sheet: the caller decides (it may want to keep it open on a failed save).
 */
export function LocationPickerSheet({
  visible,
  title,
  current,
  homeLocation,
  onSelect,
  onClose,
  allowClear = false,
  onClear,
  showHomeRow = true,
  allowAllLocations = false,
}: LocationPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const vicinity = useVicinity();
  const recentLocations = useTradeStore((s) => s.recentLocations);
  const addRecentLocation = useTradeStore((s) => s.addRecentLocation);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationName[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSearching(false);
      setSearchError(null);
    }
  }, [visible]);

  const trimmed = query.trim();

  useEffect(() => {
    if (!visible || trimmed.length < 2 || looksLikeCoordinates(trimmed) || isAllLocations(trimmed)) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    setSearching(true);
    setSearchError(null);

    const timer = setTimeout(() => {
      controller = new AbortController();
      searchLocations(trimmed, { signal: controller.signal })
        .then((locs) => {
          if (cancelled) return;
          setResults(locs);
          setSearching(false);
          setSearchError(null);
        })
        .catch(() => {
          if (cancelled || controller?.signal.aborted) return;
          setResults([]);
          setSearching(false);
          setSearchError("Couldn't reach location search — you can still use your typed place below.");
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [visible, trimmed]);

  const cityShortcut = useMemo(() => {
    if (!allowAllLocations) return null;
    const source = (current && !isAllLocations(current) ? current : null) ?? homeLocation ?? '';
    const city = extractCity(source);
    if (!city) return null;
    if (current && locationKey(city) === locationKey(current)) return null;
    return city;
  }, [allowAllLocations, current, homeLocation]);

  const visibleRecents = useMemo(() => {
    const shownKeys = new Set<string>();
    if (showHomeRow && homeLocation) shownKeys.add(locationKey(homeLocation));
    if (cityShortcut) shownKeys.add(locationKey(cityShortcut));
    return recentLocations.filter((loc) => !shownKeys.has(locationKey(loc))).slice(0, 5);
  }, [recentLocations, showHomeRow, homeLocation, cityShortcut]);

  const choice = useMemo(() => customLocationChoice(query), [query]);
  const showCustom =
    trimmed !== '' && !(choice.ok && results.some((s) => locationKey(s) === locationKey(choice.label)));

  const selectPick = (label: LocationName) => {
    if (!isAllLocations(label)) addRecentLocation(label);
    onSelect(label);
  };

  // Coordinates are coarsened on-device inside `requestVicinity` and dropped; only the place name comes back.
  const pickMyVicinity = async () => {
    const area = await vicinity.locate();
    if (area) selectPick(area);
  };

  const submitQuery = () => {
    if (allowAllLocations && isAllLocations(trimmed)) {
      selectPick(ALL_LOCATIONS);
      return;
    }
    if (choice.ok) selectPick(choice.label);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.72)' }}
          onPress={onClose}
        >
          <View className="flex-1 items-center justify-end">
            <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, maxHeight: '85%' }}>
              <View
                style={{
                  backgroundColor: C.bgSurface,
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  borderWidth: 1,
                  borderColor: C.borderDefault,
                  borderBottomWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
                  <Text className="font-display" style={{ fontSize: 17, color: C.textPrimary }}>
                    {title}
                  </Text>
                  <IconButton size={34} radius={17} accessibilityLabel="Close" onPress={onClose}>
                    <X size={16} color="#a1a1aa" />
                  </IconButton>
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                  showsVerticalScrollIndicator={false}
                >
                  <View
                    className="flex-row items-center gap-2 px-5 py-2.5"
                    style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
                  >
                    <Search size={14} color="#6d7690" />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search or type a neighbourhood, city or meetup zone"
                      placeholderTextColor={C.textDim}
                      maxLength={LOCATION_MAX_LENGTH + 20}
                      autoCorrect={false}
                      autoCapitalize="words"
                      returnKeyType="done"
                      onSubmitEditing={submitQuery}
                      accessibilityLabel="Search or type a location"
                      style={{ flex: 1, fontSize: 14, color: C.textPrimary, paddingVertical: 6 }}
                    />
                  </View>

                  {trimmed === '' ? (
                    <>
                      {/* Web only (see `useVicinity`): coordinates are coarsened on-device before any lookup. */}
                      {vicinity.supported ? (
                        <Pressable
                          onPress={() => void pickMyVicinity()}
                          disabled={vicinity.locating}
                          accessibilityRole="button"
                          accessibilityLabel="Use current vicinity, fuzzed to a nearby neighbourhood or city"
                          accessibilityHint="Asks your browser for your location and keeps only the area name"
                          accessibilityState={{ busy: vicinity.locating, disabled: vicinity.locating }}
                          className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                          style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER, opacity: vicinity.locating ? 0.6 : 1 }}
                        >
                          <LocateFixed size={14} color={ACCENT} />
                          <View className="flex-1">
                            <Text className="font-display-semi" style={{ fontSize: 13, color: ACCENT }}>
                              {vicinity.locating ? 'Locating…' : 'Current vicinity (fuzzed)'}
                            </Text>
                            <Text className="font-mono text-text-subtle" style={{ fontSize: 9 }}>
                              Coarsened on-device before lookup, never exact GPS
                            </Text>
                          </View>
                        </Pressable>
                      ) : null}

                      {allowAllLocations ? (
                        <Pressable
                          onPress={() => selectPick(ALL_LOCATIONS)}
                          accessibilityRole="button"
                          accessibilityLabel="All locations · Everywhere"
                          accessibilityState={{ selected: isAllLocations(current) }}
                          className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                          style={{
                            backgroundColor: isAllLocations(current) ? 'rgba(79,179,255,.08)' : 'transparent',
                            borderTopWidth: 1,
                            borderTopColor: ROW_BORDER,
                          }}
                        >
                          <Globe size={14} color={isAllLocations(current) ? ACCENT : '#6d7690'} />
                          <Text
                            className="font-display-semi flex-1"
                            style={{ fontSize: 13, color: isAllLocations(current) ? ACCENT : '#e8ecf5' }}
                          >
                            All locations · Everywhere
                          </Text>
                        </Pressable>
                      ) : null}

                      {showHomeRow ? (
                        homeLocation ? (
                          <Pressable
                            onPress={() => selectPick(homeLocation)}
                            accessibilityRole="button"
                            accessibilityLabel={`Use home location ${homeLocation}`}
                            accessibilityState={{
                              selected: current !== null && locationKey(homeLocation) === locationKey(current),
                            }}
                            className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                            style={{
                              backgroundColor:
                                current !== null && locationKey(homeLocation) === locationKey(current)
                                  ? 'rgba(79,179,255,.08)'
                                  : 'transparent',
                              borderTopWidth: 1,
                              borderTopColor: ROW_BORDER,
                            }}
                          >
                            <Home size={14} color={ACCENT} />
                            <Text className="font-display-semi flex-1" numberOfLines={1} style={{ fontSize: 13, color: '#e8ecf5' }}>
                              Home · {homeLocation}
                            </Text>
                          </Pressable>
                        ) : (
                          <View className="px-5 py-3" style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}>
                            <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                              No home location yet. Set one on your Profile.
                            </Text>
                          </View>
                        )
                      ) : null}

                      {cityShortcut ? (
                        <Pressable
                          onPress={() => selectPick(cityShortcut)}
                          accessibilityRole="button"
                          accessibilityLabel={`All of ${cityShortcut}`}
                          className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                          style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
                        >
                          <MapPin size={13} color={ACCENT} />
                          <Text className="font-display-semi flex-1" numberOfLines={1} style={{ fontSize: 13, color: ACCENT }}>
                            All of {cityShortcut}
                          </Text>
                        </Pressable>
                      ) : null}

                      {visibleRecents.map((loc) => {
                        const selected = current !== null && locationKey(loc) === locationKey(current);
                        return (
                          <Pressable
                            key={loc}
                            onPress={() => selectPick(loc)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                            style={{
                              backgroundColor: selected ? 'rgba(79,179,255,.08)' : 'transparent',
                              borderTopWidth: 1,
                              borderTopColor: ROW_BORDER,
                            }}
                          >
                            <Clock size={13} color={selected ? ACCENT : '#6d7690'} />
                            <Text
                              className="font-display-semi flex-1"
                              numberOfLines={1}
                              style={{ fontSize: 13, color: selected ? ACCENT : '#e8ecf5' }}
                            >
                              {loc}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {searching ? (
                        <View className="flex-row items-center gap-2 px-5 py-3" style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}>
                          <ActivityIndicator size="small" color={ACCENT} />
                          <Text className="font-mono text-text-subtle" style={{ fontSize: 11 }}>
                            Searching places…
                          </Text>
                        </View>
                      ) : null}

                      {searchError ? (
                        <View className="px-5 py-2.5" style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}>
                          <Text accessibilityLiveRegion="polite" className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                            {searchError}
                          </Text>
                        </View>
                      ) : null}

                      {results.map((loc) => {
                        const selected = current !== null && locationKey(loc) === locationKey(current);
                        return (
                          <Pressable
                            key={loc}
                            onPress={() => selectPick(loc)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                            style={{
                              backgroundColor: selected ? 'rgba(79,179,255,.08)' : 'transparent',
                              borderTopWidth: 1,
                              borderTopColor: ROW_BORDER,
                            }}
                          >
                            <MapPin size={13} color={selected ? ACCENT : '#6d7690'} />
                            <Text className="font-display-semi flex-1" style={{ fontSize: 13, color: selected ? ACCENT : '#e8ecf5' }}>
                              {loc}
                            </Text>
                          </Pressable>
                        );
                      })}

                      {showCustom ? (
                        choice.ok ? (
                          <Pressable
                            onPress={() => selectPick(choice.label)}
                            accessibilityRole="button"
                            accessibilityLabel={`Use ${choice.label}`}
                            className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                            style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
                          >
                            <MapPin size={13} color={ACCENT} />
                            <Text className="font-display-semi flex-1" numberOfLines={1} style={{ fontSize: 13, color: ACCENT }}>
                              Use “{choice.label}”
                            </Text>
                          </Pressable>
                        ) : choice.reason === 'empty' ? null : choice.reason === 'reserved' && allowAllLocations ? (
                          <Pressable
                            onPress={() => selectPick(ALL_LOCATIONS)}
                            accessibilityRole="button"
                            accessibilityLabel="All locations · Everywhere"
                            className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                            style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
                          >
                            <Globe size={14} color={ACCENT} />
                            <Text className="font-display-semi flex-1" style={{ fontSize: 13, color: ACCENT }}>
                              All locations · Everywhere
                            </Text>
                          </Pressable>
                        ) : (
                          <View className="px-5 py-3" style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}>
                            <Text accessibilityLiveRegion="polite" className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                              {choice.reason === 'coordinates'
                                ? 'That looks like coordinates. Type a neighbourhood or city name instead.'
                                : choice.reason === 'reserved'
                                  ? '“All locations” cannot be used here. Type a neighbourhood or city name instead.'
                                  : `Keep it under ${LOCATION_MAX_LENGTH} characters.`}
                            </Text>
                          </View>
                        )
                      ) : null}
                    </>
                  )}

                  {allowClear ? (
                    <Pressable
                      onPress={onClear}
                      accessibilityRole="button"
                      accessibilityLabel="Clear home location"
                      className="px-5 py-3 active:opacity-80"
                      style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
                    >
                      <Text className="font-display-semi" style={{ fontSize: 13, color: '#ff5c8a' }}>
                        Clear home location
                      </Text>
                    </Pressable>
                  ) : null}

                  <Text
                    className="font-mono text-text-subtle px-5 pt-3"
                    style={{ fontSize: 9, borderTopWidth: 1, borderTopColor: ROW_BORDER, marginTop: 4 }}
                  >
                    Only this name is shared, shown as a {VICINITY_RADIUS_LABEL}. Exact GPS is never stored or sent.
                  </Text>
                </ScrollView>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
      <ToastHost />
    </Modal>
  );
}
