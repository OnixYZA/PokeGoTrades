import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';

interface ProfileNoticeProps {
  icon?: ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Stand-in for the whole Arsenal/Wishlist body on the profile tab whenever there is nothing real
 * to show yet: signed in anonymously, mid-setup, or the live fetch failed. One shared shape so
 * those cases read as variations on the same state instead of three different screens.
 */
export function ProfileNotice({ icon, title, body, actionLabel, onAction }: ProfileNoticeProps) {
  return (
    <View className="items-center px-2 pt-14">
      {icon && (
        <View className="mb-5 h-14 w-14 items-center justify-center rounded-full" style={SURFACE.avatarHero}>
          {icon}
        </View>
      )}
      <Text className="text-center font-display text-text-primary" style={{ fontSize: 18, letterSpacing: -0.3 }}>
        {title}
      </Text>
      <Text className="mt-2 text-center font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
        {body}
      </Text>
      {actionLabel && onAction && (
        <View className="mt-7 w-full">
          <PrimaryButton label={actionLabel} style={SURFACE.ctaBlue} textColor="#04121f" onPress={onAction} />
        </View>
      )}
    </View>
  );
}
