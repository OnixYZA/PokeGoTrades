import { useState } from 'react';
import { ListFilter, Plus, Search } from 'lucide-react-native';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';

import { ListingCard } from '@/components/feed/ListingCard';
import { LocationDropdown } from '@/components/feed/LocationDropdown';
import { CreateListingModal } from '@/components/modals/CreateListingModal';
import { IconButton } from '@/components/ui/IconButton';
import { StatTile } from '@/components/ui/StatTile';
import { SURFACE } from '@/constants/theme';
import { useTradeStore } from '@/store/trade-store';

export default function FeedScreen() {
  const { filterLocation, listings, addListing } = useTradeStore();
  const [showCreateListing, setShowCreateListing] = useState(false);

  const filtered = listings.filter((l) => l.loc === filterLocation).sort((a, b) => a.dist - b.dist);

  return (
    <View className="flex-1">
      <View className="px-[22px] pb-3.5 pt-2">
        <View className="mb-3.5 flex-row items-center justify-between">
          <View>
            <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 11, letterSpacing: 1.1 }}>
              Trade Hub
            </Text>
            <Text className="mt-0.5 font-display text-text-primary" style={{ fontSize: 26, letterSpacing: -0.52 }}>
              Near you
            </Text>
          </View>
          <IconButton accessibilityLabel="Search listings">
            <Search size={18} color="#8b93a7" />
          </IconButton>
        </View>

        <View className="flex-row gap-2">
          <LocationDropdown />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter listings"
            className="flex-row items-center gap-1.5 rounded-xl border border-border-strong px-3.5 active:opacity-80"
            style={SURFACE.control}
          >
            <ListFilter size={14} color="#8b93a7" />
            <Text className="font-display-semi text-text-muted" style={{ fontSize: 12 }}>
              Filter
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row gap-2 px-[22px] pb-3.5">
        <StatTile label="Live" value={filtered.length} color="#4fb3ff" padding={{ horizontal: 10, vertical: 8 }} />
        <StatTile
          label="Lucky"
          value={filtered.filter((l) => l.lucky).length}
          color="#f5c518"
          padding={{ horizontal: 10, vertical: 8 }}
        />
        <StatTile
          label="Shiny"
          value={filtered.filter((l) => l.shiny).length}
          color="#ff6bd6"
          padding={{ horizontal: 10, vertical: 8 }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ListingCard listing={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}
        showsVerticalScrollIndicator={false}
      />

      <Pressable
        onPress={() => setShowCreateListing(true)}
        accessibilityRole="button"
        accessibilityLabel="Create new listing"
        className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full active:opacity-90"
        style={SURFACE.ctaBlue}
      >
        <Plus size={26} color="#04121f" strokeWidth={2.5} />
      </Pressable>

      <Modal
        visible={showCreateListing}
        animationType="slide"
        onRequestClose={() => setShowCreateListing(false)}
      >
        <CreateListingModal
          onClose={() => setShowCreateListing(false)}
          onSave={() => setShowCreateListing(false)}
          onPublish={(listing) => {
            addListing(listing);
            setShowCreateListing(false);
          }}
        />
      </Modal>
    </View>
  );
}
