import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';

import { Chip } from '@/components/ui/Chip';
import { trainer } from '@/data/trainer';
import type { CreatureRef } from '@/data/types';
import { fetchMyArsenal } from '@/lib/api/profile';
import { USE_SUPABASE } from '@/lib/data-source';

interface ArsenalOfferSheetProps {
  onSelect: (creature: CreatureRef) => void;
  onCancel?: () => void;
}

/** Bottom sheet for the Composer's "+" button — pick a Pokémon from the trainer's Arsenal to
 *  send into the chat as a FormalOfferCard. */
export function ArsenalOfferSheet({ onSelect, onCancel }: ArsenalOfferSheetProps) {
  const insets = useSafeAreaInsets();
  // Supabase: the trainer's own `trainer_creatures` (arsenal). Mock: the seeded DriftCoral profile.
  const [arsenal, setArsenal] = useState<CreatureRef[] | null>(USE_SUPABASE ? null : trainer.arsenal);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let active = true;
    fetchMyArsenal().then(
      (creatures) => active && setArsenal(creatures),
      () => {
        if (!active) return;
        setLoadFailed(true);
        setArsenal([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <View
      className="flex-1 justify-end"
      style={{ backgroundImage: 'linear-gradient(180deg, rgba(5,8,16,0.4), rgba(5,8,16,0.92) 30%, rgba(5,8,16,0.98))' }}
    >
      <View
        className="border-t border-border-strong px-5 pt-3"
        style={{
          backgroundColor: '#0a0f1c',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingBottom: insets.bottom + 24,
          maxHeight: '75%',
        }}
      >
        <View className="mb-4 items-center">
          <View className="h-1 w-10 rounded-full bg-border-strong" />
        </View>
        <Text className="font-display mb-1 text-center text-text-primary" style={{ fontSize: 20, letterSpacing: -0.4 }}>
          Send a Formal Offer
        </Text>
        <Text className="mb-4 text-center text-text-subtle" style={{ fontSize: 13, lineHeight: 19 }}>
          Pick a Pokémon from your Arsenal to offer in this chat.
        </Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          {arsenal === null ? <ActivityIndicator color="#4fb3ff" style={{ paddingVertical: 24 }} /> : null}
          {arsenal !== null && arsenal.length === 0 ? (
            <Text className="py-6 text-center text-text-subtle" style={{ fontSize: 13, lineHeight: 19 }}>
              {loadFailed ? 'Could not load your Arsenal. Close this and try again.' : 'Your Arsenal is empty, so there is nothing to offer yet. You can still describe your offer in the chat.'}
            </Text>
          ) : null}
          {(arsenal ?? []).map((creature) => (
            <Pressable
              key={creature.name}
              onPress={() => onSelect(creature)}
              accessibilityRole="button"
              accessibilityLabel={`Offer ${creature.name}`}
              className="flex-row items-center gap-3 rounded-2xl border border-border bg-bg-card p-3 active:opacity-80"
            >
              <Chip pokemonId={creature.pokemonId} hue={creature.hue} shiny={creature.shiny} lucky={creature.lucky} size={44} />
              <View className="min-w-0 flex-1">
                <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
                  {creature.name}
                </Text>
                <Text className="font-mono text-text-subtle" style={{ fontSize: 10, letterSpacing: 0.5 }}>
                  TAP TO OFFER
                </Text>
              </View>
              <Send size={16} color="#4fb3ff" />
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="items-center py-3 active:opacity-70"
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#8b93a7' }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
