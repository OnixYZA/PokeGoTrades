import { Text, View } from 'react-native';

import { SURFACE } from '@/constants/theme';
import type { MyProfile } from '@/lib/api/profile';

/**
 * Real-data counterpart to `ProfileHero` for a signed-in trainer with Supabase live: only the
 * fields the backend actually tracks today (handle, team). Bio, level, streak and the safe-meet
 * zone are mock-only concepts with no live source yet, so this card leaves them out instead of
 * inventing values for a real account (same call as leaving `Listing.dist` undefined for
 * Supabase-backed listings — hide what isn't tracked rather than fake it).
 */
export function LiveIdentityCard({ profile }: { profile: MyProfile }) {
  return (
    <View className="relative mb-3.5 overflow-hidden rounded-[22px] border border-border p-5" style={SURFACE.profileHero}>
      <View className="flex-row items-center gap-3.5">
        <View
          className="items-center justify-center rounded-[20px] border-2"
          style={[SURFACE.avatarHero, { width: 72, height: 72, borderColor: 'rgba(79,179,255,.5)' }]}
        >
          <Text className="font-display text-[#04121f]" style={{ fontSize: 28 }}>
            {profile.handle[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>

        <View className="min-w-0 flex-1">
          <Text className="font-display text-text-primary" style={{ fontSize: 20, letterSpacing: -0.4 }}>
            {profile.handle}
          </Text>
          {profile.team && (
            <View className="mt-1.5 flex-row items-center">
              <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: 'rgba(79,179,255,.14)' }}>
                <Text className="font-display text-accent-blue" style={{ fontSize: 10, letterSpacing: 0.6 }}>
                  TEAM {profile.team.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
