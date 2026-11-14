import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { formatTypes, typesOf, type CrownedFormToggle as CrownedFormToggleData } from '@/constants/pokedex';

import { MODAL_COLORS } from './tokens';

const C = MODAL_COLORS;

/** The options' fills: the same off / on values as `FormPicker`'s chips (a translucent white, and the gold accent
 *  at 20%), so the toggle reads as that row's two-option sibling and not as a new control. */
const CHIP_OFF = 'rgba(255,255,255,0.06)';
const CHIP_ON = 'rgba(251,191,36,0.2)';

interface CrownedFormToggleProps {
  /** The species' toggle entry (`crownedToggleOf`). The data decides which species gets this control; nothing
   *  here knows a dex number. */
  toggle: CrownedFormToggleData;
  /** The chosen form, as `CreatureRef.formCode`: `null` is the default form (Hero of Many Battles). */
  formCode: string | null;
  /** Called with `null` for the default form, or the toggle's `crownedCode`. */
  onChange: (formCode: string | null) => void;
}

/**
 * "Which form is it?" for Zacian and Zamazenta, whose two forms (Hero of Many Battles and the Crowned form) are
 * the two states of one creature: a two-option segmented control with each option's typing under its name,
 * where `FormPicker` would show two bare chips. Only the Create Listing flow mounts it, in place of `FormPicker`,
 * for a species `crownedToggleOf` returns an entry for. Both options are listable (`isPokemonUntradable` is
 * false for each), so unlike `FormPicker` it has no refusal state.
 *
 * Hero is `formCode: null`, never its own code, so one creature is never stored two ways (`normalizeFormCode`).
 * The parent should `key` it by `pokemonId`.
 */
export function CrownedFormToggle({ toggle, formCode, onChange }: CrownedFormToggleProps) {
  const options = [
    { code: null as string | null, label: toggle.heroLabel },
    { code: toggle.crownedCode as string | null, label: toggle.crownedLabel },
  ];

  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          FORM
        </Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Form" className="flex-row gap-2">
        {options.map((option) => {
          const selected = option.code === formCode;
          const optionTypes = typesOf({ pokemonId: toggle.pokemonId, formCode: option.code });
          const types = optionTypes ? formatTypes(optionTypes) : '';
          return (
            <Pressable
              key={option.code ?? 'default'}
              onPress={() => onChange(option.code)}
              accessibilityRole="radio"
              accessibilityLabel={types ? `${option.label}, ${types}` : option.label}
              accessibilityState={{ selected }}
              hitSlop={4}
              className="min-w-0 flex-1 rounded-2xl px-3.5 py-3 active:opacity-80"
              style={{ backgroundColor: selected ? CHIP_ON : CHIP_OFF }}
            >
              <View className="flex-row items-center gap-1">
                {selected && <Check size={12} color={C.gold} strokeWidth={2.5} />}
                <Text
                  numberOfLines={1}
                  className="font-mono-semi shrink uppercase"
                  style={{ fontSize: 11, letterSpacing: 0.6, color: selected ? C.gold : C.textMuted }}
                >
                  {option.label}
                </Text>
              </View>
              <Text numberOfLines={1} className="font-mono mt-1" style={{ fontSize: 10, letterSpacing: 0.6, color: C.textMuted }}>
                {types}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
