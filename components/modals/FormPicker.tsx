import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ban, Check } from 'lucide-react-native';

import { defaultFormOf, formsOf, isPokemonUntradable } from '@/constants/pokedex';
import { creatureFormLabel, speciesName } from '@/lib/format';

import { UntradableNotice } from './PokemonPickerModal';
import { MODAL_COLORS } from './tokens';

const C = MODAL_COLORS;

/** What the default choice reads when the species' default form has no name of its own (`defaultFormOf` is
 *  undefined: the game master's plain `*_NORMAL` form). */
const PLAIN_DEFAULT_LABEL = 'Standard';

/** The form chips' fills: `TextBadge`'s own off / on values for this modal (a translucent white, and the gold
 *  accent at 20%), so the row sits with the LISTING TAGS chips instead of looking like a new control. */
const CHIP_OFF = 'rgba(255,255,255,0.06)';
const CHIP_ON = 'rgba(251,191,36,0.2)';

interface FormPickerProps {
  pokemonId: number;
  /** The chosen form, as `CreatureRef.formCode`. `null` is the species' default form. */
  formCode: string | null;
  /** Called with the form's code, or `null` for the default. Never called with an untradable form: the chip
   *  explains the refusal instead (see `FormChip`). */
  onChange: (formCode: string | null) => void;
}

/**
 * "Which form is it?" for the Create Listing flow: the species' default form, then every other form it comes
 * in (`formsOf`), as one single-choice row of chips. Renders nothing for a species with only one form, so the
 * flow is unchanged for the great majority of the dex.
 *
 * WHY A ROW OF CHIPS and not a dropdown: the choice is usually two or three options (Alolan or not, Origin or
 * not), and a trainer should see all of them at once, the way `TimelinePicker` shows its three. The long
 * lists (Unown's 27 letters, a Vivillon's 19 patterns) wrap onto a few lines instead of scrolling sideways, so
 * no option is ever hidden off-screen.
 *
 * THE DEFAULT IS A CHOICE LIKE ANY OTHER, and it is `null`, not its own code. A species whose default has a
 * name (Zacian is Hero, Vivillon is Meadow, Unown is A) labels it with that name, so "Standard" never stands
 * in for a form the trainer can not find in the list; the creature still carries `formCode: null`, so one
 * creature is never stored two ways (`defaultFormOf`).
 *
 * UNTRADABLE FORMS (e.g. White Kyurem, Ultra Necrozma, Crowned Sword Zacian; `constants/untradable.ts`) are shown, dimmed and marked
 * with a Ban icon, and tapping one explains why it can't be listed — the same treatment `PokemonPickerModal`
 * gives an untradable species (and the same `UntradableNotice`). They are not hidden: a trainer who owns a
 * White Kyurem would otherwise find no White Kyurem and list it as a plain Kyurem. The rule is
 * `isPokemonUntradable`, the one the species picker and the database use; nothing here decides tradability.
 *
 * The parent should `key` this by `pokemonId`, which resets the refusal notice when the species changes.
 */
export function FormPicker({ pokemonId, formCode, onChange }: FormPickerProps) {
  const forms = formsOf(pokemonId);
  const [refused, setRefused] = useState<string | null>(null);

  const options = useMemo(() => {
    const defaultCode = defaultFormOf(pokemonId);
    const defaultLabel = (defaultCode && creatureFormLabel({ pokemonId, formCode: defaultCode })) || PLAIN_DEFAULT_LABEL;
    return [
      { code: null as string | null, label: defaultLabel, isDefault: true },
      ...forms.map((code) => ({ code: code as string | null, label: creatureFormLabel({ pokemonId, formCode: code }) ?? code, isDefault: false })),
    ];
  }, [pokemonId, forms]);

  if (forms.length === 0) return null;

  const refusedOption = options.find((option) => option.code !== null && option.code === refused);

  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          FORM
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {options.length} FORMS
        </Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Form" className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const untradable = option.code !== null && isPokemonUntradable(pokemonId, option.code);
          return (
            <FormChip
              key={option.code ?? 'default'}
              label={option.label}
              isDefault={option.isDefault}
              selected={option.code === formCode}
              untradable={untradable}
              onPress={() => {
                if (untradable) {
                  setRefused(option.code);
                  return;
                }
                setRefused(null);
                onChange(option.code);
              }}
            />
          );
        })}
      </View>
      {refusedOption && (
        <View className="mt-3">
          {/* `UntradableNotice` carries its own horizontal margin for the picker sheet's padding; cancel it. */}
          <View style={{ marginHorizontal: -20 }}>
            <UntradableNotice name={`${refusedOption.label} ${speciesName({ pokemonId })}`} onDismiss={() => setRefused(null)} />
          </View>
        </View>
      )}
    </View>
  );
}

function FormChip({
  label,
  isDefault,
  selected,
  untradable,
  onPress,
}: {
  label: string;
  isDefault: boolean;
  selected: boolean;
  /** Dimmed and marked; a press explains the refusal rather than selecting. */
  untradable: boolean;
  onPress: () => void;
}) {
  const accessibilityLabel = untradable
    ? `${label}, can’t be traded in Pokémon GO`
    : isDefault
      ? `${label}, the default form`
      : label;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={untradable ? 'Explains why it can’t be listed' : undefined}
      accessibilityState={{ selected }}
      hitSlop={4}
      className={`flex-row items-center gap-1 rounded-full px-3.5 py-2.5 ${untradable ? 'opacity-50' : 'active:opacity-80'}`}
      // `maxWidth` so one long name ("Galarian Standard Mode") shrinks and ellipsizes instead of overflowing a ~335pt row.
      style={{ backgroundColor: selected ? CHIP_ON : CHIP_OFF, maxWidth: '100%' }}
    >
      {selected && <Check size={12} color={C.gold} strokeWidth={2.5} />}
      {untradable && <Ban size={12} color={C.danger} strokeWidth={2.5} />}
      <Text
        numberOfLines={1}
        className="font-mono-semi shrink uppercase"
        style={{ fontSize: 11, letterSpacing: 0.6, color: selected ? C.gold : C.textMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
