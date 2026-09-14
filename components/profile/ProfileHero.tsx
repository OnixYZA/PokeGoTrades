import { Text, View } from 'react-native';

import { SafeMeetZone } from '@/components/profile/SafeMeetZone';
import { SURFACE } from '@/constants/theme';
import type { Trainer } from '@/data/types';

export function ProfileHero({ trainer }: { trainer: Trainer }) {
  return (
    <View className="relative mb-3.5 overflow-hidden rounded-[22px] border border-border p-5" style={SURFACE.profileHero}>
      <View
        className="absolute h-[160px] w-[160px] rounded-full"
        style={{ top: -30, right: -20, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, rgba(245,197,24,.16), transparent 70%)' }}
      />

      <View className="flex-row items-start gap-3.5">
        <View
          className="items-center justify-center rounded-[20px] border-2"
          style={[SURFACE.avatarHero, { width: 72, height: 72, borderColor: 'rgba(79,179,255,.5)' }]}
        >
          <Text className="font-display text-[#04121f]" style={{ fontSize: 28 }}>
            {trainer.handle[0]}
          </Text>
        </View>

        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text className="font-display text-text-primary" style={{ fontSize: 20, letterSpacing: -0.4 }}>
              {trainer.handle}
            </Text>
            <View className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: 'rgba(79,179,255,.14)' }}>
              <Text className="font-display text-accent-blue" style={{ fontSize: 10 }}>
                LVL {trainer.lvl}
              </Text>
            </View>
          </View>
          <Text className="font-mono text-text-subtle" style={{ fontSize: 10, marginTop: 3, letterSpacing: 0.6 }}>
            {trainer.code}
          </Text>
          <View className="mt-1.5 flex-row items-center">
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: 'rgba(79,179,255,.14)' }}>
              <Text className="font-display text-accent-blue" style={{ fontSize: 10, letterSpacing: 0.6 }}>
                TEAM {trainer.team.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <Text className="text-text-body" style={{ fontSize: 13, lineHeight: 19.5, marginTop: 14 }}>
        {trainer.bio}
      </Text>

      <SafeMeetZone location={trainer.safeLoc} />
    </View>
  );
}
