import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center gap-4 bg-bg-canvas p-5">
        <Text className="font-display text-text-primary" style={{ fontSize: 20 }}>
          This screen doesn&apos;t exist.
        </Text>
        <Link href="/" className="py-3.5">
          <Text className="font-display-semi text-accent-blue" style={{ fontSize: 14 }}>
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}
