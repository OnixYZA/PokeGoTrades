import { Text, View } from 'react-native';

import { partnerAvatarGradient } from '@/constants/theme';

interface AvatarProps {
  name: string;
  size?: number;
  radius?: number;
  fontSize?: number;
}

/** Deterministic HSL-gradient monogram avatar, derived from the trading partner's name. */
export function Avatar({ name, size = 42, radius = 12, fontSize = 15 }: AvatarProps) {
  return (
    <View
      className="items-center justify-center"
      style={[{ width: size, height: size, borderRadius: radius }, partnerAvatarGradient(name)]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text className="font-display text-white" style={{ fontSize }}>
        {name[0]}
      </Text>
    </View>
  );
}
