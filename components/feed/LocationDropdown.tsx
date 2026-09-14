import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, MapPin } from 'lucide-react-native';

import { Dropdown } from '@/components/ui/Dropdown';
import { SURFACE } from '@/constants/theme';
import { locations } from '@/data/listings';
import { useTradeStore } from '@/store/trade-store';

export function LocationDropdown() {
  const { filterLocation, setFilterLocation, listings } = useTradeStore();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);

  return (
    <View className="flex-1">
      <Pressable
        ref={anchorRef}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityHint="Change the location filter"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2 rounded-xl border border-border-strong px-3 py-2.5 active:opacity-80"
        style={SURFACE.control}
      >
        <MapPin size={14} color="#4fb3ff" />
        <View className="flex-1">
          <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 9, letterSpacing: 0.9 }}>
            Sorted by proximity
          </Text>
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
            {filterLocation}
          </Text>
        </View>
        <ChevronDown size={16} color="#6d7690" />
      </Pressable>

      <Dropdown visible={open} onRequestClose={() => setOpen(false)} anchorRef={anchorRef} align="stretch">
        {locations.map((loc, i) => {
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
                borderBottomWidth: i === locations.length - 1 ? 0 : 1,
                borderBottomColor: '#151b2a',
              }}
            >
              <Text
                className="font-display-semi"
                style={{ fontSize: 13, color: selected ? '#4fb3ff' : '#e8ecf5' }}
              >
                {loc}
              </Text>
              <Text className="font-mono text-text-subtle" style={{ fontSize: 10 }}>
                {count} live
              </Text>
            </Pressable>
          );
        })}
      </Dropdown>
    </View>
  );
}
