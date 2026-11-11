import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, LocateFixed, MapPin, Search, X } from 'lucide-react-native';

import { IconButton } from '@/components/ui/IconButton';
import { ToastHost } from '@/components/ui/ToastHost';
import { MODAL_COLORS } from '@/components/modals/tokens';
import {
  LOCATION_MAX_LENGTH,
  VICINITY_RADIUS_LABEL,
  customLocationChoice,
  suggestLocalities,
  type LocationName,
} from '@/constants/locations';
import { useVicinity } from '@/lib/use-vicinity';

const C = MODAL_COLORS;
const ACCENT = '#4fb3ff';
const ROW_BORDER = '#151b2a';

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
}

/**
 * The one location picker (feed filter, Create Listing, home-location editing). A place label is chosen from
 * suggestions, typed, or taken from the browser's coarse fix (web only), and only ever leaves this component
 * through `constants/locations.ts` rules, so a coordinate cannot come out of it. `onSelect` / `onClear` do not
 * close the sheet: the caller decides (it may want to keep it open on a failed save).
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
}: LocationPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const vicinity = useVicinity();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const suggestions = useMemo(() => suggestLocalities(query), [query]);
  const trimmed = query.trim();
  const choice = useMemo(() => customLocationChoice(query), [query]);
  const showCustom =
    trimmed !== '' && !(choice.ok && suggestions.some((s) => s.toLowerCase() === choice.label.toLowerCase()));

  // Coordinates are snapped inside `locate` and dropped; only the place name comes back.
  const pickMyVicinity = async () => {
    const area = await vicinity.locate();
    if (area) onSelect(area);
  };

  const submitQuery = () => {
    if (choice.ok) onSelect(choice.label);
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
                  {/* Web only (see `useVicinity`): the browser's coarse fix is snapped to a known town at once. */}
                  {vicinity.supported ? (
                    <Pressable
                      onPress={() => void pickMyVicinity()}
                      disabled={vicinity.locating}
                      accessibilityRole="button"
                      accessibilityLabel="Use current vicinity, fuzzed to a nearby town"
                      accessibilityHint="Asks your browser for your location and keeps only the nearest town"
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
                          Only the nearest town is kept, never GPS
                        </Text>
                      </View>
                    </Pressable>
                  ) : null}

                  {showHomeRow ? (
                    homeLocation ? (
                      <Pressable
                        onPress={() => onSelect(homeLocation)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use home location ${homeLocation}`}
                        className="flex-row items-center gap-2 px-5 py-3 active:opacity-80"
                        style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}
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

                  {suggestions.map((loc) => {
                    const selected = current !== null && loc.toLowerCase() === current.toLowerCase();
                    return (
                      <Pressable
                        key={loc}
                        onPress={() => onSelect(loc)}
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
                        onPress={() => onSelect(choice.label)}
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
                    ) : choice.reason === 'empty' ? null : (
                      <View className="px-5 py-3" style={{ borderTopWidth: 1, borderTopColor: ROW_BORDER }}>
                        <Text accessibilityLiveRegion="polite" className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                          {choice.reason === 'coordinates'
                            ? 'That looks like coordinates. Type a neighbourhood or city name instead.'
                            : `Keep it under ${LOCATION_MAX_LENGTH} characters.`}
                        </Text>
                      </View>
                    )
                  ) : null}

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
