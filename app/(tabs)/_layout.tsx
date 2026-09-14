import { BlurView } from 'expo-blur';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { House, MessageCircle, User } from 'lucide-react-native';
import { View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhoneFrame } from '@/components/layout/PhoneFrame';
import { TabBarButton } from '@/components/layout/TabBarButton';
import { totalUnread } from '@/data/chats';

// `StyleSheet.absoluteFillObject` was removed from RN's public types in 0.86 (only the
// registered-style `StyleSheet.absoluteFill` remains) — spell the fill out explicitly so it
// works as a plain style object inside a `style={[...]}` array.
const fill: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <PhoneFrame>
      <Tabs style={{ flex: 1 }}>
        <TabSlot style={{ flex: 1 }} />
        {/*
          `expo-router/ui`'s Tabs only walks Fragment/TabList wrappers when collecting triggers
          (see expo-router/build/ui/Tabs.js `parseTriggersFromChildren`) — wrapping TabList in a
          plain View or BlurView hides its triggers entirely and the navigator throws "Couldn't
          find any screens". So the blur/background layers live *inside* TabList as absolutely
          positioned, non-trigger children instead of wrapping it.
        */}
        <TabList
          role="tablist"
          className="flex-row justify-around border-t border-border-subtle"
          style={{
            position: 'relative',
            overflow: 'hidden',
            paddingTop: 10,
            paddingHorizontal: 26,
            paddingBottom: Math.max(insets.bottom, 26),
          }}
        >
          <BlurView intensity={20} tint="dark" style={fill} />
          <View style={[fill, { backgroundColor: 'rgba(10,14,24,.92)' }]} />

          <TabTrigger name="home" href="/" asChild>
            <TabBarButton label="Feed" icon={(color) => <House size={22} color={color} />} />
          </TabTrigger>
          <TabTrigger name="chats" href="/chats" asChild>
            <TabBarButton
              label="Chats"
              icon={(color) => <MessageCircle size={22} color={color} />}
              badge={totalUnread}
            />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabBarButton label="Profile" icon={(color) => <User size={22} color={color} />} />
          </TabTrigger>
        </TabList>
      </Tabs>
    </PhoneFrame>
  );
}
