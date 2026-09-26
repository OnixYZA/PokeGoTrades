import { useState } from 'react';
import { router } from 'expo-router';
import { ListFilter, Plus, Search } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native';

import { ListingCard } from '@/components/feed/ListingCard';
import { LocationDropdown } from '@/components/feed/LocationDropdown';
import { CreateListingModal } from '@/components/modals/CreateListingModal';
import { IconButton } from '@/components/ui/IconButton';
import { StatTile } from '@/components/ui/StatTile';
import { SURFACE } from '@/constants/theme';
import { getPostingReadiness } from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';
import { useFeed } from '@/lib/use-feed';
import { useTradeStore } from '@/store/trade-store';

export default function FeedScreen() {
  const filterLocation = useTradeStore((s) => s.filterLocation);
  const addListing = useTradeStore((s) => s.addListing);
  const feed = useFeed(filterLocation);
  const [showCreateListing, setShowCreateListing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const filtered = feed.listings;

  // Only a user-initiated pull shows the refresh spinner; a refetch on tab focus stays silent.
  const pullToRefresh = async () => {
    setPulling(true);
    try {
      await feed.refresh();
    } finally {
      setPulling(false);
    }
  };

  // Writes need a permanent account with a finished profile (RLS, SUPABASE_PLAN.md D9), so anyone
  // who is not there yet is sent to onboarding instead of into a form the server would refuse.
  const openCreateListing = async () => {
    setNotice(null);
    if (USE_SUPABASE) {
      try {
        if ((await getPostingReadiness()) !== 'ready') {
          router.push('/onboarding');
          return;
        }
      } catch {
        setNotice('Could not check your account. Check your connection and try again.');
        return;
      }
    }
    setShowCreateListing(true);
  };

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

      {notice ? (
        <Text
          accessibilityRole="alert"
          className="px-[22px] pb-3 font-display-med text-accent-danger"
          style={{ fontSize: 13 }}
        >
          {notice}
        </Text>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ListingCard listing={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}
        showsVerticalScrollIndicator={false}
        refreshing={pulling}
        onRefresh={USE_SUPABASE ? () => void pullToRefresh() : undefined}
        ListEmptyComponent={
          feed.isLoading ? (
            <ActivityIndicator color="#4fb3ff" style={{ marginTop: 32 }} />
          ) : feed.error ? (
            <FeedMessage
              title="Couldn't load listings"
              body={feed.error}
              actionLabel="Retry"
              onAction={() => void feed.refresh()}
            />
          ) : (
            <FeedMessage title={`Nothing in ${filterLocation} yet`} body="Post a trade to be the first listing here." />
          )
        }
      />

      <Pressable
        onPress={() => void openCreateListing()}
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
            // Supabase: the row already exists, so reload the feed. Mock: append to the local store.
            if (USE_SUPABASE) void feed.refresh();
            else addListing(listing);
            setShowCreateListing(false);
          }}
        />
      </Modal>
    </View>
  );
}

function FeedMessage({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="items-center gap-1.5 px-6 pt-10">
      <Text className="font-display text-text-primary" style={{ fontSize: 15 }}>
        {title}
      </Text>
      <Text className="text-center font-display-med text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
        {body}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          className="mt-2 rounded-xl border border-border-strong px-4 py-2 active:opacity-80"
          style={SURFACE.control}
        >
          <Text className="font-display-semi text-accent-blue" style={{ fontSize: 13 }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
