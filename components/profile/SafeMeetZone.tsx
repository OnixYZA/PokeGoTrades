import { Shield } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

interface SafeMeetZoneProps {
  location: string;
  /** When set, the "OBSCURED" tag is replaced by an edit button (only the owner's own profile passes it). */
  onEdit?: () => void;
  editLabel?: string;
}

export function SafeMeetZone({ location, onEdit, editLabel = 'Edit' }: SafeMeetZoneProps) {
  return (
    <View className="mt-3.5 flex-row items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-panel p-2.5">
      <View className="h-8 w-8 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(79,179,255,.12)' }}>
        <Shield size={16} color="#4fb3ff" />
      </View>
      <View className="flex-1">
        <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
          Safe meet zone
        </Text>
        <Text className="font-display-semi text-text-primary" numberOfLines={1} style={{ fontSize: 13, marginTop: 1 }}>
          {location}
        </Text>
      </View>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`${editLabel} safe meet zone`}
          hitSlop={8}
          className="active:opacity-70"
        >
          <Text className="font-display-semi" style={{ fontSize: 11, color: '#4fb3ff' }}>
            {editLabel}
          </Text>
        </Pressable>
      ) : (
        <Text className="font-mono text-text-subtle" style={{ fontSize: 9 }}>
          OBSCURED
        </Text>
      )}
    </View>
  );
}
