import type { TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface TabBarButtonProps extends TabTriggerSlotProps {
  icon: (color: string) => ReactNode;
  label: string;
  badge?: number;
}

/** Custom trigger for the bottom tab bar: icon + uppercase label, glowing top-cap when active,
 *  optional unread-count badge (Chats). `isFocused` is forwarded by TabTrigger via `asChild`. */
export const TabBarButton = forwardRef<View, TabBarButtonProps>(
  ({ icon, label, badge, isFocused, ...props }, ref) => {
    const color = isFocused ? '#4fb3ff' : '#4a5169';

    return (
      <Pressable
        ref={ref}
        {...props}
        accessibilityRole="tab"
        accessibilityState={{ selected: !!isFocused }}
        accessibilityLabel={label}
        className="items-center gap-1 px-[18px] py-1.5"
        style={{ position: 'relative' }}
      >
        {isFocused && (
          <View
            style={{
              position: 'absolute',
              top: -10,
              left: '50%',
              transform: [{ translateX: -13 }],
              width: 26,
              height: 3,
              borderRadius: 3,
              backgroundColor: '#4fb3ff',
              boxShadow: '0 0 12px #4fb3ff',
            }}
          />
        )}
        {icon(color)}
        <Text
          className="font-display-semi uppercase"
          style={{ fontSize: 10, letterSpacing: 0.6, color }}
        >
          {label}
        </Text>
        {!!badge && (
          <View
            className="absolute items-center justify-center rounded-lg bg-accent-danger"
            style={{ top: 2, right: 10, minWidth: 16, height: 16, paddingHorizontal: 4 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Text className="font-display text-white" style={{ fontSize: 10 }}>
              {badge}
            </Text>
          </View>
        )}
      </Pressable>
    );
  },
);
TabBarButton.displayName = 'TabBarButton';
