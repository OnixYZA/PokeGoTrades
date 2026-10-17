import { ChevronRight } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { typesOf } from '@/constants/pokedex';
import { formalOffer } from '@/data/chats';
import type { FormalOffer } from '@/data/types';
import { USE_SUPABASE } from '@/lib/data-source';
import { creatureDisplayName, creatureFormLabel, describeTypes } from '@/lib/format';
import type { OfferAvailability, OfferBlock } from '@/store/offer-state';

/** The server says whether an offer is lucky/shiny. The mock offers predate those fields and were
 *  always drawn lucky (the gold "L"), so the mock keeps doing that. Shared with the Trade Summary. */
export function isOfferLucky(offer: FormalOffer): boolean {
  return USE_SUPABASE ? offer.lucky === true : true;
}

/** What an ended offer's card says instead of inviting a tap. The blocks that are not here leave the card open. */
const ENDED_TAG: Partial<Record<OfferBlock, string>> = {
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

interface FormalOfferCardProps {
  offer?: FormalOffer;
  /** What may be done with this offer (`offerAvailability`). Left out, the card is plain, non-interactive display. */
  availability?: OfferAvailability;
  /** Opens the Trade Summary for this offer. Only reachable while `availability.selectable`. */
  onPress?: () => void;
}

export function FormalOfferCard({ offer = formalOffer, availability, onPress }: FormalOfferCardProps) {
  const lucky = isOfferLucky(offer);
  const interactive = availability?.selectable === true && onPress !== undefined;
  const ended = availability !== undefined && !availability.selectable;
  const block = availability?.block ?? null;
  const tag = ended && block ? ENDED_TAG[block] : undefined;
  const name = creatureDisplayName(offer);
  const formLabel = creatureFormLabel(offer);
  const types = typesOf(offer);
  // The label replaces the card's content for a screen reader, so the form and types have to be in it.
  const identity = formLabel ? `${name}, ${formLabel}` : name;
  const described = types ? `${identity}, ${describeTypes(types)}` : identity;
  const label = interactive ? `Review formal offer: ${described}` : `Formal offer: ${described}${tag ? `, ${tag.toLowerCase()}` : ''}`;

  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={availability ? 'button' : undefined}
      accessibilityLabel={availability ? label : undefined}
      accessibilityState={availability ? { disabled: !interactive } : undefined}
      className={`mt-1 gap-2.5 rounded-2xl border p-3 ${interactive ? 'active:opacity-80' : ''}`}
      style={{
        maxWidth: '82%',
        borderColor: ended ? 'rgba(125,135,160,.25)' : 'rgba(79,179,255,.3)',
        backgroundColor: '#0f1524',
        opacity: ended ? 0.55 : 1,
      }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-mono uppercase text-accent-blue" style={{ fontSize: 9, letterSpacing: 1, color: ended ? '#7d87a0' : undefined }}>
          Formal Offer
        </Text>
        {tag ? (
          <Text className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: 1, color: '#ff5c8a' }}>
            {tag}
          </Text>
        ) : interactive ? (
          <View className="flex-row items-center gap-0.5">
            <Text className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: 1, color: '#4fb3ff' }}>
              Review
            </Text>
            <ChevronRight size={10} color="#4fb3ff" />
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2.5">
        <Chip creature={{ ...offer, lucky }} size={40} />
        <View>
          <Text
            className="font-display-semi text-text-primary"
            style={{ fontSize: 13, textDecorationLine: block === 'withdrawn' || block === 'rejected' ? 'line-through' : 'none' }}
          >
            {name}
          </Text>
          {/* Inside the card, so a dead offer's dimming (`opacity`) covers the pills along with the rest. */}
          <TypeBadge types={types} size="sm" style={{ marginVertical: 3 }} />
          <Text className="font-mono" style={{ fontSize: 10, color: '#94a3b8' }}>
            {[formLabel, offer.move, offer.iv].filter(Boolean).join(' · ') || 'Awaiting details'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
