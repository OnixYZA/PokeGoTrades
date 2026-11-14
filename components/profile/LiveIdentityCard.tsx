import { useState } from 'react';
import { Text, View } from 'react-native';

import { LocationPickerSheet } from '@/components/location/LocationPickerSheet';
import { SafeMeetZone } from '@/components/profile/SafeMeetZone';
import { formatVicinityLabel } from '@/constants/locations';
import { SURFACE } from '@/constants/theme';
import type { MyProfile } from '@/lib/api/profile';
import { useTradeStore } from '@/store/trade-store';

/**
 * Real-data counterpart to `ProfileHero` for a signed-in trainer with Supabase live: only the
 * fields the backend actually tracks today (handle, team, home location). Bio, level and streak are
 * mock-only concepts with no live source yet, so this card leaves them out instead of inventing values
 * for a real account (same call as leaving `Listing.dist` undefined for Supabase-backed listings — hide
 * what isn't tracked rather than fake it). The safe-meet zone is the trainer's home location
 * (`profile_private.safe_loc`), read from the store (the profile screen seeds it from `fetchMyProfile`)
 * and editable here.
 */
export function LiveIdentityCard({ profile }: { profile: MyProfile }) {
  const homeLocation = useTradeStore((s) => s.homeLocation);
  const saveHomeLocation = useTradeStore((s) => s.saveHomeLocation);
  const [editing, setEditing] = useState(false);

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

      <SafeMeetZone
        location={homeLocation ? formatVicinityLabel(homeLocation) : 'Not set'}
        onEdit={() => setEditing(true)}
        editLabel={homeLocation ? 'Edit' : 'Set'}
      />
      <LocationPickerSheet
        visible={editing}
        title="Home location"
        showHomeRow={false}
        current={homeLocation}
        homeLocation={homeLocation}
        allowClear={homeLocation !== null}
        onSelect={async (label) => {
          const result = await saveHomeLocation(label);
          if (result.ok) setEditing(false);
        }}
        onClear={async () => {
          const result = await saveHomeLocation(null);
          if (result.ok) setEditing(false);
        }}
        onClose={() => setEditing(false)}
      />
    </View>
  );
}
