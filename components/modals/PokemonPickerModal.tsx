import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ban, Check, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react-native';

import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ShinyGlint } from '@/components/ui/ShinyGlint';
import { hueBadgeStyle } from '@/constants/theme';
import { creatureHue, formatTypes, POKEDEX, searchPokedex, typesOf, type PokedexEntry } from '@/constants/pokedex';
import { creatureDisplayName, creatureFullName, describeTypes } from '@/lib/format';
import {
  addedFormsOf,
  buildPick,
  excludedKeysOf,
  hasFormStep,
  resolveFormChoice,
  resolveTap,
  speciesRowState,
  type PickedCreature,
  type PickerOptions,
  type SpeciesRowState,
} from '@/lib/picker-selection';
import type { SpriteSubject } from '@/lib/sprite-url';

import { FormPicker } from './FormPicker';
import { MODAL_COLORS, MODAL_SURFACE } from './tokens';
import { UntradableNotice } from './UntradableNotice';

export type { PickedCreature };

const C = MODAL_COLORS;

/** Search results are capped, ranked matches — plenty for "find the one you meant". Browsing with an
 *  empty query instead lists the whole dex (FlatList only renders what's on screen either way), so
 *  scrolling from #1 actually reaches #1025 rather than stopping at an arbitrary page size. */
const SEARCH_RESULT_LIMIT = 60;

interface PokemonPickerModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Called with the creature the trainer picked (see `PickedCreature`). `shiny` is always `false` when
   *  `allowShiny` is off, and `formCode` is always `null` when `allowForm` is off or the species has no forms;
   *  `null` is also the species' default form, so a Hero Zacian is `formCode: null`, never `'HERO'`. It is never
   *  called with an untradable creature: that is refused here, with the notice, and does not reach the caller. */
  onSelect: (pick: PickedCreature) => void;
  /** Whether this picker offers a Shiny toggle at all. Defaults on: most pickers (Arsenal, Wishlist,
   *  "Wanted in Return") have no shiny toggle of their own elsewhere in the flow. */
  allowShiny?: boolean;
  /** Whether this picker asks which form, after a species that has forms is tapped. Defaults on. A caller that
   *  already has its own form control sets `allowForm={false}` and ignores `formCode` (always `null`):
   *  `CreateListingModal`'s "CREATURE" slot shows a `FormPicker` under the chosen creature, so asking here as well
   *  would ask twice. With it off, every row picks at once, as the default form. */
  allowForm?: boolean;
  /** Already on the list this picker is adding to — shown disabled with an "ADDED" badge instead of
   *  being left out, so re-opening the picker still reads as the same dex, just partly checked off.
   *  Compared by `spriteVariantKey`, so a shiny and non-shiny entry, and every form of a species, are distinct
   *  variants. A species row is "ADDED" only once EVERY form the trainer could still pick is in here (a row can't
   *  know which form is meant), and the form step marks each added form on its own; see `speciesRowState`.
   *  Entries with a costume code never match, since nothing picked here carries one. */
  exclude?: readonly SpriteSubject[];
}

/**
 * Full-dex search sheet shared by the Arsenal and Wishlist "+" buttons (app/(tabs)/profile.tsx) and by
 * CreateListingModal's "CREATURE" and "WANTED IN RETURN" slots. Every one of those is a trade list, so
 * untradable creatures (`isPokemonUntradable`) are never selectable here. A species that is untradable in every
 * form (Mythicals, Zygarde, Eternatus) is still listed, dimmed and marked, and tapping it explains why instead of
 * silently doing nothing. Owns its own native `Modal`, unlike the other components in this folder which are
 * mounted inside a `Modal` by their screen — this one has no screen-specific chrome to coordinate with, so keeping
 * the two together avoids every caller re-declaring the same `Modal` props.
 *
 * ROWS ARE SPECIES, AND A FORM IS A SECOND STEP. Tapping a species with no forms picks it at once, so the great
 * majority of the dex costs one tap. Tapping one WITH forms (Alolan Vulpix, Origin Palkia, Unown's letters; `formsOf`)
 * swaps the list for a form step: the species' `FormPicker` chips (the default selected), a preview of exactly what
 * would be added, and an "Add" button. A trainer who wants the plain form confirms immediately; one who wants Alolan
 * picks it first. The Shiny setting carries over, and can be flipped in the step. Back (or Android's back button)
 * returns to the list with its search and scroll position intact.
 *
 * TRADABILITY IS PER FORM, and only `isPokemonUntradable` decides it. A species whose default form is tradable but
 * which has untradable forms (Kyurem, Necrozma, Zacian, Zamazenta) stays pickable; its untradable forms are shown in
 * the form step, dimmed, and refuse with the same notice. Everything the caller receives is made by `buildPick`,
 * which can not produce an untradable creature.
 *
 * The rules for what is pickable and what is "ADDED" live in `lib/picker-selection.ts` (pure, unit-tested); this
 * file only draws them.
 */
export function PokemonPickerModal({
  visible,
  title,
  onClose,
  onSelect,
  allowShiny = true,
  allowForm = true,
  exclude,
}: PokemonPickerModalProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [shinyToggle, setShinyToggle] = useState(false);
  /** The untradable row the trainer last tapped, shown as an explanation above the list. */
  const [refused, setRefused] = useState<PokedexEntry | null>(null);
  /** The species whose form step is open, or `null` while the list is showing. */
  const [step, setStep] = useState<PokedexEntry | null>(null);
  /** The form the trainer last tapped in the step (`null`: the default form). What is actually selected is
   *  `resolveFormChoice` of this, because it can stop being pickable under the trainer (Shiny flipped). */
  const [requestedForm, setRequestedForm] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  /** The toggle's state only counts where the toggle is shown: a picker without one is never shiny. */
  const shiny = allowShiny && shinyToggle;
  const options = useMemo<PickerOptions>(() => ({ allowShiny, allowForm }), [allowShiny, allowForm]);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); // never reopen showing the previous search
    setShinyToggle(false); // never reopen with the previous open's shiny toggle still on
    setRefused(null);
    setStep(null); // never reopen inside the previous open's form step
    setRequestedForm(null);
    // The sheet's TextInput mounts into a fresh native Modal host each time `visible` flips true;
    // focusing on the very same tick can race that mount, so defer one frame. (`autoFocus` only ever
    // fires on first mount, not on a later re-open, which is why this manages focus itself instead.)
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [visible]);

  const excluded = useMemo(() => excludedKeysOf(exclude), [exclude]);
  const results = useMemo(
    () => (query.trim().length === 0 ? POKEDEX : searchPokedex(query, SEARCH_RESULT_LIMIT)),
    [query],
  );

  const changeQuery = (next: string) => {
    setQuery(next);
    setRefused(null);
  };

  const handleTap = (entry: PokedexEntry) => {
    const tap = resolveTap(entry.pokemonId, shiny, options);
    if (tap.kind === 'refuse') {
      setRefused(entry);
    } else if (tap.kind === 'pick') {
      onSelect(tap.pick);
    } else {
      Keyboard.dismiss(); // the search field is hidden behind the step, so don't leave its keyboard up
      setRefused(null);
      setRequestedForm(null); // every step starts on the default form
      setStep(entry);
    }
  };

  const confirmForm = (pick: PickedCreature) => {
    onSelect(pick);
    // Back to the list whether or not the caller closes the sheet: a caller that keeps it open for more adds
    // should show the trainer the row they just added, not the form step they are done with.
    setStep(null);
  };

  const renderItem = ({ item }: ListRenderItemInfo<PokedexEntry>) => (
    <PokedexRow
      entry={item}
      shiny={shiny}
      state={speciesRowState(item.pokemonId, shiny, excluded, allowForm)}
      hasForms={hasFormStep(item.pokemonId, allowForm)}
      onPress={() => handleTap(item)}
    />
  );

  return (
    // Android's back button steps back out of the form step before it closes the sheet, like the step's own back button.
    <Modal visible={visible} transparent animationType="slide" onRequestClose={step ? () => setStep(null) : onClose} statusBarTranslucent>
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
                <Header title={title} onClose={onClose} onBack={step ? () => setStep(null) : undefined} />
                {/* The list stays mounted (hidden, not unmounted) while the form step shows, so going back
                 *  returns to the same search and scroll position instead of the top of a 1025-row dex. */}
                <View style={{ flex: 1, display: step ? 'none' : 'flex' }}>
                  <SearchField
                    query={query}
                    onChangeQuery={changeQuery}
                    inputRef={inputRef}
                    allowShiny={allowShiny}
                    shiny={shiny}
                    onToggleShiny={() => setShinyToggle((v) => !v)}
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
                {step && (
                  <FormStep
                    entry={step}
                    shiny={shiny}
                    allowShiny={allowShiny}
                    onToggleShiny={() => setShinyToggle((v) => !v)}
                    excluded={excluded}
                    requestedForm={requestedForm}
                    onChangeForm={setRequestedForm}
                    onConfirm={confirmForm}
                    options={options}
                    bottomInset={insets.bottom}
                  />
                )}
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/** `onBack` is given only inside the form step: a back arrow before the title, to the species list. The close
 *  button on the right always closes the whole sheet. */
function Header({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between gap-3 border-b px-5 py-4"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        {onBack && (
          <IconButton
            accessibilityLabel="Back to Pokémon list"
            onPress={onBack}
            size={36}
            radius={12}
            className="border"
            style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
          >
            <ChevronLeft size={18} color={C.textPrimary} strokeWidth={2.5} />
          </IconButton>
        )}
        <Text numberOfLines={1} className="shrink font-display" style={{ fontSize: 17, color: C.textPrimary }}>
          {title}
        </Text>
      </View>
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
 *  text query — and again beside the form step's "Add" button. Its icon is the very `ShinyGlint` drawn on
 *  `Chip`/`Sprite`, so a trainer already reads "pink sparkle = shiny" before ever looking at the label.
 *  `className` is the parent's layout (the gap to its neighbour); the pill's own look is not configurable. */
function ShinyToggle({ shiny, onToggle, className = '' }: { shiny: boolean; onToggle: () => void; className?: string }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: shiny }}
      accessibilityLabel="Shiny"
      accessibilityHint="Adds the shiny variant of the Pokémon you pick"
      className={`${className} flex-row items-center gap-1.5 rounded-[14px] border px-3 active:opacity-80`}
      // No fixed height: the row's default `alignItems: 'stretch'` sizes the pill to its neighbour (the search input, or the Add button).
      style={
        shiny
          ? [MODAL_SURFACE.togglePink, { borderColor: C.pink }]
          : { backgroundColor: C.bgCard, borderColor: C.borderDefault }
      }
    >
      <ShinyGlint size={15} color={shiny ? '#fff' : C.textMuted} />
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
      {allowShiny && <ShinyToggle shiny={shiny} onToggle={onToggleShiny} className="ml-2" />}
    </View>
  );
}

function PokedexRow({
  entry,
  shiny,
  state,
  hasForms,
  onPress,
}: {
  entry: PokedexEntry;
  shiny: boolean;
  /** `'untradable'`: dimmed and marked, and the press explains the refusal (`UntradableNotice`) rather than
   *  adding. `'added'`: dimmed, marked, and not pressable. */
  state: SpeciesRowState;
  /** The press opens the form step rather than picking, so the row ends in a chevron instead of a plus. */
  hasForms: boolean;
  onPress: () => void;
}) {
  const dex = `#${String(entry.pokemonId).padStart(3, '0')}`;
  const displayName = creatureDisplayName({ pokemonId: entry.pokemonId, shiny });
  const untradable = state === 'untradable';
  const added = state === 'added';
  const label = untradable
    ? `${displayName}, ${dex}, can’t be traded in Pokémon GO`
    : added
      ? `${displayName}, ${hasForms ? 'every form ' : ''}already added`
      : hasForms
        ? `Choose a form of ${displayName}, ${dex}, ${describeTypes(entry.types)}`
        : `Add ${displayName}, ${dex}, ${describeTypes(entry.types)}`;
  // An untradable row stays pressable (the press explains the refusal), so only an added one is disabled.
  const blocked = added;
  const dimmed = untradable || added;
  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={untradable ? 'Explains why it can’t be added' : hasForms && !added ? 'Opens the forms to choose from' : undefined}
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
              {formatTypes(entry.types).toUpperCase()}
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
      ) : hasForms ? (
        <ChevronRight size={18} color={C.blue} strokeWidth={2.5} />
      ) : (
        <Plus size={18} color={C.blue} strokeWidth={2.5} />
      )}
    </Pressable>
  );
}

/**
 * The second step for a species with forms: which form, then add. Replaces the list under the same header (whose
 * back arrow returns to it), so the sheet is still one screen with one thing to do.
 *
 *   - PREVIEW of exactly what "Add" will add: the form's own sprite, its full name ("Shiny Alolan Vulpix") and its
 *     typing (Alolan Vulpix is Ice), all of it from the same functions the rest of the app names a creature with.
 *   - FORM CHIPS: `FormPicker`, so the radiogroup, the labels and the untradable refusal are the Create Listing flow's
 *     own. The default form is selected to begin with, so confirming at once adds the plain form. Forms already in
 *     the list for the current shiny setting are dimmed, marked "ADDED" and not selectable.
 *   - FOOTER: the Shiny toggle (when the picker has one) beside the "Add" button, where the thumb already is. Flipping
 *     it re-evaluates which forms are added, and the selection moves off one that has just become added.
 *
 * "Add" emits only what `buildPick` allows, so an untradable form can not reach the caller from here. It is disabled
 * with "All added" when every form is already in the list for this shiny setting.
 */
function FormStep({
  entry,
  shiny,
  allowShiny,
  onToggleShiny,
  excluded,
  requestedForm,
  onChangeForm,
  onConfirm,
  options,
  bottomInset,
}: {
  entry: PokedexEntry;
  shiny: boolean;
  allowShiny: boolean;
  onToggleShiny: () => void;
  excluded: ReadonlySet<string>;
  requestedForm: string | null;
  onChangeForm: (formCode: string | null) => void;
  onConfirm: (pick: PickedCreature) => void;
  options: PickerOptions;
  bottomInset: number;
}) {
  const { pokemonId } = entry;
  const choice = resolveFormChoice(requestedForm, pokemonId, shiny, excluded);
  // With nothing left to pick, the preview shows the default form; no chip is selected and "Add" is off.
  const formCode = choice ? choice.formCode : null;
  const pick = choice ? buildPick(pokemonId, shiny, choice.formCode, options) : null;
  const fullName = creatureFullName({ pokemonId, shiny, formCode });
  const types = typesOf({ pokemonId, formCode }) ?? entry.types;
  const hue = creatureHue({ pokemonId, formCode, hue: entry.hue });
  const dex = `#${String(pokemonId).padStart(3, '0')}`;
  return (
    <View className="flex-1">
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          accessible
          accessibilityLabel={`${fullName}, ${dex}, ${describeTypes(types)}`}
          className="flex-row items-center gap-3.5 rounded-[14px] border p-3.5"
          style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
        >
          <Chip creature={{ pokemonId, hue, shiny, formCode }} size={64} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: '700', color: C.textPrimary }}>
              {fullName}
            </Text>
            <View className="mt-1.5 flex-row items-center gap-1.5">
              <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.5 }}>
                {dex}
              </Text>
              <View className="rounded-full border px-2 py-0.5" style={hueBadgeStyle(hue)}>
                <Text className="font-mono" style={{ fontSize: 9, color: C.textSecondary, letterSpacing: 0.6 }}>
                  {formatTypes(types).toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </View>
        {/* Keyed by species so a refusal notice never outlives the species it was about. */}
        <FormPicker
          key={pokemonId}
          pokemonId={pokemonId}
          formCode={choice ? choice.formCode : undefined}
          onChange={onChangeForm}
          addedForms={addedFormsOf(pokemonId, shiny, excluded)}
        />
      </ScrollView>
      <View
        className="flex-row gap-2 border-t px-5 pt-3"
        style={{ borderTopColor: C.borderSubtle, paddingBottom: bottomInset + 16 }}
      >
        {allowShiny && <ShinyToggle shiny={shiny} onToggle={onToggleShiny} />}
        <PrimaryButton
          flex={1}
          label={pick ? 'Add' : 'All added'}
          accessibilityLabel={pick ? `Add ${fullName}` : `Every form of ${creatureDisplayName({ pokemonId, shiny })} is already added`}
          icon={pick ? <Plus size={18} color="#0a0a0f" strokeWidth={2.5} /> : undefined}
          style={MODAL_SURFACE.ctaGold}
          textColor="#0a0a0f"
          disabled={!pick}
          onPress={() => pick && onConfirm(pick)}
        />
      </View>
    </View>
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
