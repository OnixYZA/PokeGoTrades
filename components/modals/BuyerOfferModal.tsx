import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Send, Sparkles } from 'lucide-react-native';

import { Chip } from '@/components/ui/Chip';
import type { CreatureRef, Listing } from '@/data/types';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

export type BuyerOfferSelection = { kind: 'creature'; creature: CreatureRef } | { kind: 'custom' };

interface BuyerOfferModalProps {
  listing: Listing;
  onConfirm?: (selection: BuyerOfferSelection) => void;
  onCancel?: () => void;
}

/** Pre-chat "Make Offer" picker — bottom sheet where the buyer picks one of the seller's Looking
 *  For creatures (or Custom Offer) before a chat is opened and a formal offer is auto-sent. */
export function BuyerOfferModal({ listing, onConfirm, onCancel }: BuyerOfferModalProps) {
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<BuyerOfferSelection | null>(null);

  return (
    <View
      className="flex-1 justify-end"
      style={{ backgroundImage: 'linear-gradient(180deg, rgba(8,8,12,0.4), rgba(8,8,12,0.9) 30%, rgba(8,8,12,0.98))' }}
    >
      <View
        className="border-t px-5 pt-3"
        style={{
          backgroundColor: C.bgSurface,
          borderTopColor: C.borderDefault,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingBottom: insets.bottom + 24,
          boxShadow: '0 -20px 60px rgba(56,189,248,0.1)',
        }}
      >
        <Grabber />
        <Heading sellerName={listing.seller} listingName={listing.name} />

        <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          WHAT ARE YOU OFFERING?
        </Text>

        <View className="mb-5 gap-2.5">
          {listing.looking.map((creature) => (
            <CreatureOptionRow
              key={creature.name}
              creature={creature}
              selected={selection?.kind === 'creature' && selection.creature.name === creature.name}
              onPress={() => setSelection({ kind: 'creature', creature })}
            />
          ))}
          <CustomOfferRow selected={selection?.kind === 'custom'} onPress={() => setSelection({ kind: 'custom' })} />
        </View>

        <Pressable
          onPress={() => (selection ? onConfirm?.(selection) : undefined)}
          disabled={!selection}
          accessibilityRole="button"
          accessibilityLabel="Send offer"
          accessibilityState={{ disabled: !selection }}
          className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] ${selection ? 'active:opacity-90' : 'opacity-40'}`}
          style={MODAL_SURFACE.ctaGreen}
        >
          <Send size={18} color={C.successText} strokeWidth={2.5} />
          <Text className="font-display" style={{ fontSize: 16, color: C.successText, letterSpacing: -0.16 }}>
            Send Offer
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="items-center py-3 active:opacity-70"
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.textSecondary }}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Grabber() {
  return (
    <View className="mb-4 items-center">
      <View className="h-1 w-10 rounded-full" style={{ backgroundColor: C.borderDefault }} />
    </View>
  );
}

function Heading({ sellerName, listingName }: { sellerName: string; listingName: string }) {
  return (
    <View className="mb-5">
      <Text className="font-display mb-2 text-center" style={{ fontSize: 22, color: C.textPrimary, letterSpacing: -0.44 }}>
        Make an Offer
      </Text>
      <Text className="text-center" style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19.5 }}>
        Pick what you&rsquo;ll trade {sellerName} for their{' '}
        <Text style={{ color: C.textPrimary, fontWeight: '600' }}>{listingName}</Text>.
      </Text>
    </View>
  );
}

function CreatureOptionRow({
  creature,
  selected,
  onPress,
}: {
  creature: CreatureRef;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={creature.name}
      accessibilityState={{ selected: !!selected }}
      className="flex-row items-center gap-3.5 rounded-2xl border px-4 py-3 active:opacity-90"
      style={{
        backgroundColor: selected ? 'rgba(56,189,248,0.08)' : C.bgCard,
        borderColor: selected ? 'rgba(56,189,248,0.4)' : C.borderDefault,
      }}
    >
      <Chip pokemonId={creature.pokemonId} hue={creature.hue} shiny={creature.shiny} lucky={creature.lucky} size={44} />
      <View className="flex-1">
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>{creature.name}</Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 }}>
          OFFER THIS
        </Text>
      </View>
      <View
        className="h-6 w-6 items-center justify-center rounded-full"
        style={selected ? { backgroundColor: C.blue } : { borderWidth: 1.5, borderColor: C.borderDefault }}
      >
        {selected ? <Check size={14} color="#04121f" strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

function CustomOfferRow({ selected, onPress }: { selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel="Custom Offer"
      accessibilityState={{ selected: !!selected }}
      className="flex-row items-center gap-3.5 rounded-2xl border border-dashed px-4 py-3 active:opacity-90"
      style={{
        backgroundColor: selected ? 'rgba(251,191,36,0.08)' : 'transparent',
        borderColor: selected ? 'rgba(251,191,36,0.4)' : C.borderDefault,
      }}
    >
      <View className="h-11 w-11 items-center justify-center rounded-xl border border-dashed" style={{ borderColor: C.borderDefault }}>
        <Sparkles size={18} color={C.gold} strokeWidth={2.2} />
      </View>
      <View className="flex-1">
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>Custom Offer</Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 }}>
          NEGOTIATE IN CHAT
        </Text>
      </View>
      <View
        className="h-6 w-6 items-center justify-center rounded-full"
        style={selected ? { backgroundColor: C.gold } : { borderWidth: 1.5, borderColor: C.borderDefault }}
      >
        {selected ? <Check size={14} color="#0a0a0f" strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}
