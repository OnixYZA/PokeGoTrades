import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { FilterChip } from '@/components/ui/FilterChip';
import { FILTER_ATTRIBUTES } from '@/constants/listing-attributes';
import type { FilterKey, FilterState } from '@/store/listing-filters';
import { useTradeStore } from '@/store/trade-store';

import { MODAL_COLORS } from './tokens';

const C = MODAL_COLORS;

// `(typeof FILTER_ATTRIBUTES)[number]`, not the exported `FilterAttribute` type: the registry's own
// `as const satisfies` keeps every entry's `key` as its own specific literal (e.g. "sizeClass:XXL"),
// while `FilterAttribute` widens an enum entry's `key` to the generic `` `${column}:${string}` ``
// pattern — too broad to assign into `FilterKey` or to index a `FilterState`.
type Attr = (typeof FILTER_ATTRIBUTES)[number];

/** `FILTER_ATTRIBUTES` grouped by its own `section`, in the registry's display order — computed once
 *  at module load since the registry is static, so opening the sheet never re-derives it. This is the
 *  one place outside `store/listing-filters.ts` that reads the registry's `section` field, so a future
 *  section added there needs no matching edit here. */
const SECTIONS: { section: string; attrs: Attr[] }[] = (() => {
  const bySection = new Map<string, Attr[]>();
  for (const attr of FILTER_ATTRIBUTES) {
    let list = bySection.get(attr.section);
    if (!list) {
      list = [];
      bySection.set(attr.section, list);
    }
    list.push(attr);
  }
  return [...bySection.entries()].map(([section, attrs]) => ({ section, attrs }));
})();

interface ListingFilterSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Feed-filter bottom sheet: one tristate `FilterChip` per `FILTER_ATTRIBUTES` entry, grouped into the
 * registry's own sections. No local copy of the filter state — every chip reads and writes
 * `useTradeStore`'s `listingFilters` directly through `cycleListingFilter`, so this sheet can never
 * drift from what `store/listing-filters.ts#compileFilter` is actually matching the feed against.
 */
export function ListingFilterSheet({ visible, onClose }: ListingFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const filters = useTradeStore((s) => s.listingFilters);
  const cycleListingFilter = useTradeStore((s) => s.cycleListingFilter);
  const clearListingFilters = useTradeStore((s) => s.clearListingFilters);

  const activeCount = Object.keys(filters).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Full-bleed backdrop: a tap anywhere outside the sheet closes it — same outer/inner Pressable
       *  idiom as components/ui/Dropdown.tsx and PokemonPickerModal. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close filters"
        style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.72)' }}
        onPress={onClose}
      >
        {/* No `pointerEvents` here: a tap on this View's empty area has no responder and bubbles to
         *  the backdrop `Pressable` above, closing the sheet — the inner no-op `Pressable` below
         *  absorbs taps meant for the sheet itself. Same outer/inner idiom as components/ui/Dropdown.tsx,
         *  with no `pointerEvents` at all. Setting it explicitly is both unneeded and actively harmful on
         *  web: RN Web's deprecated `pointerEvents` prop is fine, but moving it into `style` (as the
         *  deprecation suggests) would have NativeWind emit `style.pointerEvents: 'box-none'` as inline
         *  CSS, which the browser drops as an invalid value, leaving this View at the CSS default
         *  `auto` — capturing taps instead of letting them fall through (see the pointerEvents comment
         *  on ListingCard's text column, components/feed/ListingCard.tsx, and e2e/chat-flow.spec.ts). */}
        <View className="flex-1 items-center justify-end">
          <Pressable onPress={() => {}} className="w-full max-w-md mx-auto" style={{ maxHeight: '85%' }}>
            <View
              style={{
                backgroundColor: C.bgSurface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderWidth: 1,
                borderColor: C.borderDefault,
                borderBottomWidth: 0,
                overflow: 'hidden',
              }}
            >
              <Grabber />
              <Header activeCount={activeCount} onClear={clearListingFilters} onClose={onClose} />
              <ScrollView
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 20, gap: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {SECTIONS.map(({ section, attrs }) => (
                  <FilterSectionGroup
                    key={section}
                    title={section}
                    attrs={attrs}
                    filters={filters}
                    onCycle={cycleListingFilter}
                  />
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function Grabber() {
  return (
    <View className="items-center pb-1.5 pt-2.5">
      <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: C.borderDefault }} />
    </View>
  );
}

function Header({ activeCount, onClear, onClose }: { activeCount: number; onClear: () => void; onClose: () => void }) {
  return (
    <View className="flex-row items-center justify-between border-b px-5 pb-4" style={{ borderBottomColor: C.borderSubtle }}>
      <View>
        <Text className="font-display" style={{ fontSize: 17, color: C.textPrimary }}>
          Filters
        </Text>
        {/* `accessibilityLiveRegion` announces the count as chips are toggled, without moving focus. */}
        <Text
          accessibilityLiveRegion="polite"
          className="font-mono mt-0.5"
          style={{ fontSize: 11, color: activeCount > 0 ? C.gold : C.textMuted, letterSpacing: 0.6 }}
        >
          {activeCount} active
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={activeCount > 0 ? onClear : undefined}
          disabled={activeCount === 0}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          accessibilityState={{ disabled: activeCount === 0 }}
          className={`rounded-lg border px-3 py-2 ${activeCount === 0 ? 'opacity-40' : 'active:opacity-70'}`}
          style={{ borderColor: C.borderDefault, backgroundColor: C.bgCard }}
        >
          <Text className="font-display-semi" style={{ fontSize: 12, color: C.textSecondary }}>
            Clear all
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={4}
          className="h-9 w-9 items-center justify-center rounded-xl border active:opacity-70"
          style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
        >
          <X size={16} color={C.textPrimary} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}

function FilterSectionGroup({
  title,
  attrs,
  filters,
  onCycle,
}: {
  title: string;
  attrs: Attr[];
  filters: FilterState;
  onCycle: (key: FilterKey) => void;
}) {
  return (
    <View>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        {title.toUpperCase()}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {attrs.map((attr) => (
          <FilterChip key={attr.key} label={attr.label} state={filters[attr.key] ?? 'neutral'} onPress={() => onCycle(attr.key)} />
        ))}
      </View>
    </View>
  );
}
