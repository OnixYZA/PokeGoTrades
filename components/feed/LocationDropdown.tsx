import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, MapPin } from 'lucide-react-native';

import { LocationPickerSheet } from '@/components/location/LocationPickerSheet';
import { SURFACE } from '@/constants/theme';
import { isAllLocations, VICINITY_RADIUS_LABEL } from '@/constants/locations';
import { USE_SUPABASE } from '@/lib/data-source';
import { useTradeStore } from '@/store/trade-store';

/**
 * The feed's location trigger. The picker is the shared `LocationPickerSheet`. The old per-area "N live"
 * counts are gone: they counted withdrawn listings too, and cannot scale to free-text locations (the feed
 * only loads the selected place anyway).
 */
export function LocationDropdown() {
  const filterLocation = useTradeStore((s) => s.filterLocation);
  const setFilterLocation = useTradeStore((s) => s.setFilterLocation);
  const homeLocation = useTradeStore((s) => s.homeLocation);
  const [open, setOpen] = useState(false);

  return (
    <View className="flex-1">
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          isAllLocations(filterLocation)
            ? 'Location: All locations'
            : `Location: ${filterLocation}. ${VICINITY_RADIUS_LABEL}`
        }
        accessibilityHint="Change the feed location"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2 rounded-xl border border-border-strong px-3 py-2.5 active:opacity-80"
        style={SURFACE.control}
      >
        <MapPin size={14} color="#4fb3ff" />
        <View className="flex-1">
          <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
            {USE_SUPABASE ? 'Newest first' : 'Location'}
          </Text>
          <Text className="font-display-semi text-text-primary" numberOfLines={1} style={{ fontSize: 14 }}>
            {filterLocation}
          </Text>
        </View>
        <ChevronDown size={16} color="#6d7690" />
      </Pressable>

      <LocationPickerSheet
        visible={open}
        title="Feed location"
        current={filterLocation}
        homeLocation={homeLocation}
        allowAllLocations
        onSelect={(loc) => {
          setFilterLocation(loc);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}
