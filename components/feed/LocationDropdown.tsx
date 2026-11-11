import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, LocateFixed, MapPin } from 'lucide-react-native';
import { useShallow } from 'zustand/react/shallow';

import { Dropdown } from '@/components/ui/Dropdown';
import { SURFACE } from '@/constants/theme';
import { AREAS, VICINITY_RADIUS_LABEL } from '@/constants/locations';
import { USE_SUPABASE } from '@/lib/data-source';
import { useVicinity } from '@/lib/use-vicinity';
import { useTradeStore } from '@/store/trade-store';

export function LocationDropdown() {
  const filterLocation = useTradeStore((s) => s.filterLocation);
  const setFilterLocation = useTradeStore((s) => s.setFilterLocation);
  const listings = useTradeStore(useShallow((s) => Object.values(s.listings)));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const vicinity = useVicinity();

  // Coordinates are bucketed inside `locate` and dropped; only the neighbourhood name comes back.
  const pickMyVicinity = async () => {
    const area = await vicinity.locate();
    if (area) {
      setFilterLocation(area);
      setOpen(false);
    }
  };

  return (
    <View className="flex-1">
      <Pressable
        ref={anchorRef}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Neighbourhood: ${filterLocation}. ${VICINITY_RADIUS_LABEL}`}
        accessibilityHint="Change the neighbourhood filter"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2 rounded-xl border border-border-strong px-3 py-2.5 active:opacity-80"
        style={SURFACE.control}
      >
        <MapPin size={14} color="#4fb3ff" />
        <View className="flex-1">
          <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
            {USE_SUPABASE ? 'Newest first' : 'Neighbourhood'}
          </Text>
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
            {filterLocation}
          </Text>
        </View>
        <ChevronDown size={16} color="#6d7690" />
      </Pressable>

      <Dropdown visible={open} onRequestClose={() => setOpen(false)} anchorRef={anchorRef} align="stretch">
        {/* Web only (see `useVicinity`): the browser's coarse fix is bucketed to a neighbourhood at once. */}
        {vicinity.supported ? (
          <Pressable
            onPress={() => void pickMyVicinity()}
            disabled={vicinity.locating}
            accessibilityRole="menuitem"
            accessibilityLabel="Use current vicinity, fuzzed to a neighbourhood"
            accessibilityHint="Asks your browser for your location and keeps only the neighbourhood"
            accessibilityState={{ busy: vicinity.locating, disabled: vicinity.locating }}
            className="flex-row items-center gap-2 px-3.5 py-2.5 active:opacity-80"
            style={{ borderBottomWidth: 1, borderBottomColor: '#151b2a', opacity: vicinity.locating ? 0.6 : 1 }}
          >
            <LocateFixed size={14} color="#4fb3ff" />
            <View className="flex-1">
              <Text className="font-display-semi" style={{ fontSize: 13, color: '#4fb3ff' }}>
                {vicinity.locating ? 'Locating…' : 'Use current vicinity (fuzzed)'}
              </Text>
              <Text className="font-mono text-text-subtle" style={{ fontSize: 9 }}>
                Only the neighbourhood is kept, never GPS
              </Text>
            </View>
          </Pressable>
        ) : null}
        {AREAS.map((loc, i) => {
          const selected = loc === filterLocation;
          const count = listings.filter((l) => l.loc === loc).length;
          return (
            <Pressable
              key={loc}
              onPress={() => {
                setFilterLocation(loc);
                setOpen(false);
              }}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              className="flex-row items-center justify-between px-3.5 py-2.5 active:opacity-80"
              style={{
                backgroundColor: selected ? 'rgba(79,179,255,.08)' : 'transparent',
                borderBottomWidth: i === AREAS.length - 1 ? 0 : 1,
                borderBottomColor: '#151b2a',
              }}
            >
              <Text
                className="font-display-semi"
                style={{ fontSize: 13, color: selected ? '#4fb3ff' : '#e8ecf5' }}
              >
                {loc}
              </Text>
              {/* Per-area counts come from the local mock store; the feed only loads the selected area. */}
              {USE_SUPABASE ? null : (
                <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                  {count} live
                </Text>
              )}
            </Pressable>
          );
        })}
      </Dropdown>
    </View>
  );
}
