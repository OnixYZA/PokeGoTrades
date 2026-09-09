import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import type { Listing } from '@/data/types';

interface ChatGroupHeaderProps {
  listing: Listing;
  offerCount: number;
  locked: boolean;
}

export function ChatGroupHeader({ listing, offerCount, locked }: ChatGroupHeaderProps) {
  return (
    <View className="flex-row items-center gap-2.5 px-1.5 pb-2.5 pt-1.5">
      <Chip pokemonId={listing.pokemonId} hue={listing.hue} shiny={listing.shiny} size={34} />
      <View className="min-w-0 flex-1">
        <Text className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
          {listing.name}
        </Text>
        <Text className="font-mono text-text-subtle" style={{ fontSize: 10, letterSpacing: 0.6 }}>
          {offerCount} parallel {offerCount === 1 ? 'offer' : 'offers'}
          {locked ? ' · locked' : ''}
        </Text>
      </View>
      {locked && (
        <View className="rounded-full px-2 py-[3px]" style={{ backgroundColor: 'rgba(245,197,24,.14)' }}>
          <Text className="font-display" style={{ fontSize: 9, letterSpacing: 1, color: '#f5c518' }}>
            LOCKED
          </Text>
        </View>
      )}
    </View>
  );
}
