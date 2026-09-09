import { Shield } from 'lucide-react-native';
import { Text, View } from 'react-native';

export function SafeMeetZone({ location }: { location: string }) {
  return (
    <View className="mt-3.5 flex-row items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-panel p-2.5">
      <View className="h-8 w-8 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(79,179,255,.12)' }}>
        <Shield size={16} color="#4fb3ff" />
      </View>
      <View className="flex-1">
        <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
          Safe meet zone
        </Text>
        <Text className="font-display-semi text-text-primary" style={{ fontSize: 13, marginTop: 1 }}>
          {location}
        </Text>
      </View>
      <Text className="font-mono text-text-subtle" style={{ fontSize: 9 }}>
        OBSCURED
      </Text>
    </View>
  );
}
