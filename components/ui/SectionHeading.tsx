import { Text, View } from 'react-native';

import { SURFACE } from '@/constants/theme';

interface SectionHeadingProps {
  title: string;
  meta?: string;
}

/** "Looking For · 3 · any 1 accepted" style heading row: title + gradient divider + trailing meta. */
export function SectionHeading({ title, meta }: SectionHeadingProps) {
  return (
    <View className="mb-3 flex-row items-center gap-2">
      <Text className="font-display text-text-primary" style={{ fontSize: 15, letterSpacing: -0.15 }}>
        {title}
      </Text>
      <View className="h-px flex-1" style={SURFACE.divider} />
      {meta ? (
        <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}
