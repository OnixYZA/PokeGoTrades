import { Pressable, Text, View } from 'react-native';

import { TEAMS, type Team } from '@/lib/api/profile';

export const TEAM_COLORS: Record<Team, string> = {
  Mystic: '#4fb3ff',
  Valor: '#ff5c8a',
  Instinct: '#f5c518',
};

interface TeamPickerProps {
  value: Team | null;
  onChange: (team: Team) => void;
  disabled?: boolean;
}

/** The three-way team toggle shared by `ProfileForm` and `ProfileProofStep` (team isn't on the trainer-code screenshot, so it's always picked by hand). */
export function TeamPicker({ value, onChange, disabled }: TeamPickerProps) {
  return (
    <View accessibilityRole="radiogroup" className="flex-row gap-2">
      {TEAMS.map((name) => {
        const selected = value === name;
        const color = TEAM_COLORS[name];
        return (
          <Pressable
            key={name}
            onPress={() => onChange(name)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`Team ${name}`}
            accessibilityState={{ selected }}
            className="flex-1 items-center rounded-[14px] border py-3 active:opacity-80"
            style={
              selected
                ? { borderColor: color, backgroundColor: `${color}1f` }
                : { borderColor: '#1a2032', backgroundColor: '#0f1524' }
            }
          >
            <Text className="font-display-semi" style={{ fontSize: 13, color: selected ? color : '#8b93a7' }}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
