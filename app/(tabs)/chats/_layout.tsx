import { Stack } from 'expo-router';

// Nested Stack (not a tab) so the inbox → active-chat transition happens without leaving the
// tab bar, matching the handoff where Chats stays a single tab with an internal list/detail state.
export default function ChatsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: '#080b14' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[chatId]" />
    </Stack>
  );
}
