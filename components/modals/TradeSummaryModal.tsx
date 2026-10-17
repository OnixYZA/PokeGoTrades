import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownUp, ClipboardCheck, Clock, Info, Lock, MapPin, MessageSquareText, Navigation } from 'lucide-react-native';
import { useShallow } from 'zustand/react/shallow';

import { isOfferLucky } from '@/components/chats/FormalOfferCard';
import { Chip } from '@/components/ui/Chip';
import { ToastHost } from '@/components/ui/ToastHost';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { TRADE_TIMELINE_LABELS } from '@/constants/listing-attributes';
import { FRIENDSHIP_LEVELS } from '@/constants/theme';
import { TRADE_COST_MATRIX, type ChatMessage, type ChatRole, type CreatureRef, type FormalOffer, type Listing } from '@/data/types';
import { creatureDisplayName, fmtDust, formCodeLabel } from '@/lib/format';
import { offerAvailability, type OfferBlock } from '@/store/offer-state';
import { selectTradeView, useTradeStore } from '@/store/trade-store';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

interface TradeSummaryModalProps {
  chatId: string;
  /** The offer to review. `null`: there is no formal offer, the trade was agreed in the chat itself. */
  message: ChatMessage | null;
  /** The lock went through. The caller moves on to the Handshake. */
  onConfirmed: () => void;
  /** Back to the chat; nothing was changed. */
  onDismiss: () => void;
}

/** A short fact about a creature. `tone` only decides the colour. */
interface Pill {
  label: string;
  tone?: 'shiny' | 'lucky';
}

/** CP and level are not part of an offer or a listing (`FormalOffer`, `Listing`), so only what exists is listed. */
function offerPills(offer: FormalOffer): Pill[] {
  const pills: Pill[] = [offer.shiny ? { label: 'Shiny', tone: 'shiny' } : { label: 'Not shiny' }];
  if (isOfferLucky(offer)) pills.push({ label: 'Lucky', tone: 'lucky' });
  if (offer.formCode) pills.push({ label: formCodeLabel(offer.formCode) });
  if (offer.costumeCode) pills.push({ label: 'Costume' });
  if (offer.iv) pills.push({ label: offer.iv });
  if (offer.move) pills.push({ label: offer.move });
  return pills;
}

function listingPills(listing: Listing): Pill[] {
  const pills: Pill[] = [listing.shiny ? { label: 'Shiny', tone: 'shiny' } : { label: 'Not shiny' }];
  if (listing.lucky) pills.push({ label: 'Lucky', tone: 'lucky' });
  if (listing.form) pills.push({ label: listing.form });
  if (listing.purified) pills.push({ label: 'Purified' });
  if (listing.costume) pills.push({ label: 'Costume' });
  if (listing.iv) pills.push({ label: `IV ${listing.iv}` });
  if (listing.pvp) pills.push({ label: `PvP ${listing.pvp}` });
  if (listing.year) pills.push({ label: `Caught ${listing.year}` });
  return pills;
}

/** Why the Confirm button is off, in the trainer's words. Exhaustive on purpose: a new block must be worded here. */
function blockMessage(block: OfferBlock, role: ChatRole, partner: string): string {
  switch (block) {
    case 'withdrawn':
      return 'This offer was withdrawn, so it can no longer be accepted.';
    case 'rejected':
      return 'This offer was rejected, so it can no longer be accepted.';
    case 'cancelled':
      return 'This chat was closed. Nothing in it can be accepted any more.';
    case 'completed':
      return 'This trade is already completed.';
    case 'locked':
      return 'This trade is already locked. Finish it from the Handshake.';
    case 'frozen':
      return role === 'seller'
        ? 'You locked another offer on this listing. Unlock it to accept anything here.'
        : 'The seller locked a different offer on this listing, so this chat is frozen.';
    case 'not_seller':
      return `Only the seller can accept an offer. Once ${partner} does, you both confirm in the Handshake.`;
    case 'own_offer':
      return 'This is your own offer. You accept the buyer’s offers, not the ones you send.';
  }
}

/**
 * The preview every acceptance goes through (the "Trade Summary"): the exact terms of one offer, then a
 * confirm that takes the trade-lock handshake (`lockChat` -> `lock_trade`). Whether the confirm is live comes
 * from `offerAvailability`, re-derived from the store on every render, so a competing lock or a closed chat
 * that arrives while this is open switches it off at once.
 *
 * Confirming here is the seller's half of the agreement (D1: only the seller locks). The buyer confirms the
 * other half in the Handshake that opens next on both devices (D2).
 */
export function TradeSummaryModal({ chatId, message, onConfirmed, onDismiss }: TradeSummaryModalProps) {
  const insets = useSafeAreaInsets();
  const trade = useTradeStore(useShallow((s) => selectTradeView(s, chatId)));
  const partner = useTradeStore((s) => s.chats[chatId]?.partner) ?? 'your partner';
  const listing = useTradeStore((s) => {
    const chat = s.chats[chatId];
    return chat ? s.listings[chat.listingId] : undefined;
  });
  const friendship = useTradeStore((s) => s.friendship);
  const setFriendship = useTradeStore((s) => s.setFriendship);
  const lockChat = useTradeStore((s) => s.lockChat);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availability = offerAvailability(trade, message ?? {});
  const level = FRIENDSHIP_LEVELS.find((f) => f.label === friendship) ?? FRIENDSHIP_LEVELS[0];

  const confirm = async () => {
    if (busy || !availability.confirmable) return;
    setBusy(true);
    setError(null);
    const result = await lockChat(chatId, message?.id);
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    // Stays busy on success: the lock has just made `availability` read "locked", and this is about to be
    // replaced by the Handshake, so there is nothing to re-enable and no reason to flash that in between.
    onConfirmed();
  };

  return (
    <View className="flex-1 px-5" style={{ backgroundColor: C.bgBase, paddingTop: insets.top + 20 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <Ribbon />
        <View className="mb-6 items-center">
          <Text className="font-display text-center" style={{ fontSize: 26, lineHeight: 30, color: C.textPrimary, letterSpacing: -0.52 }}>
            Review{'\n'}Trade Agreement
          </Text>
          <Text className="mt-2.5 text-center" style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19.5 }}>
            {availability.confirmable
              ? 'Nothing is locked until you confirm. Check the exact terms first.'
              : 'These are the exact terms of this offer.'}
          </Text>
        </View>

        {message?.offer ? (
          <CreatureSummary
            kicker="OFFERED"
            owner={message.role === 'me' ? 'You' : partner}
            creature={{ ...message.offer, lucky: isOfferLucky(message.offer) }}
            pills={offerPills(message.offer)}
            accent={C.blue}
          />
        ) : (
          <View className="rounded-2xl border border-dashed p-4" style={{ borderColor: C.borderDefault }}>
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl border border-dashed" style={{ borderColor: C.borderDefault }}>
                <MessageSquareText size={18} color={C.gold} strokeWidth={2.2} />
              </View>
              <View className="flex-1">
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>No formal offer</Text>
                <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 2 }}>
                  The terms were agreed in the chat. Check it before you confirm.
                </Text>
              </View>
            </View>
          </View>
        )}

        <View className="my-3 items-center">
          <ArrowDownUp size={18} color={C.textDim} strokeWidth={2.2} />
        </View>

        {listing ? (
          <CreatureSummary
            kicker="REQUESTED"
            owner={trade.role === 'seller' ? 'You' : listing.seller}
            creature={listing}
            pills={listingPills(listing)}
            accent={C.pink}
          />
        ) : (
          <View className="rounded-2xl border p-4" style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}>
            <Text style={{ fontSize: 13, color: C.textMuted }}>The listing’s details are not available right now.</Text>
          </View>
        )}

        {listing ? (
          <>
            <Section kicker="STARDUST COST">
              <View className="flex-row items-baseline gap-2">
                <Text className="font-display" style={{ fontSize: 34, lineHeight: 34, color: C.textPrimary, letterSpacing: -0.68 }}>
                  {fmtDust(TRADE_COST_MATRIX[listing.tradeType][level.label])}
                </Text>
                <Text className="font-mono" style={{ fontSize: 11, letterSpacing: 0.88, color: level.color }}>
                  STARDUST
                </Text>
              </View>
              <Text className="mt-1" style={{ fontSize: 12, color: C.textMuted }}>
                {listing.tradeType}
              </Text>
              <View className="mt-3 flex-row gap-1.5" accessibilityRole="radiogroup">
                {FRIENDSHIP_LEVELS.map((f) => {
                  const selected = f.label === friendship;
                  return (
                    <Pressable
                      key={f.label}
                      onPress={() => setFriendship(f.label)}
                      accessibilityRole="radio"
                      accessibilityLabel={`${f.label} Friend`}
                      accessibilityState={{ selected }}
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2 active:opacity-80"
                      style={{ backgroundColor: selected ? 'rgba(56,189,248,0.08)' : C.bgBase, borderColor: selected ? f.color : C.borderDefault }}
                    >
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.color }} />
                      <Text className="font-display-semi" style={{ fontSize: 11, color: selected ? C.textPrimary : C.textSecondary }}>
                        {f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section kicker="MEET-UP">
              <FactRow icon={<MapPin size={14} color={C.blue} />} text={listing.dist !== undefined ? `${listing.loc} · ${listing.dist} km away` : listing.loc} />
              <FactRow
                icon={<Navigation size={14} color={C.blue} />}
                text={listing.willTravel ? 'Seller will travel to meet' : 'Meet in the seller’s area'}
              />
              <FactRow icon={<Clock size={14} color={C.blue} />} text={`Timeline: ${TRADE_TIMELINE_LABELS[listing.tradeTimeline]}`} />
              {listing.tags.length > 0 ? (
                <View className="mt-1 flex-row flex-wrap gap-1.5">
                  {listing.tags.map((tag) => (
                    <PillView key={tag} pill={{ label: tag }} />
                  ))}
                </View>
              ) : null}
              {listing.notes ? (
                <Text className="mt-2" style={{ fontSize: 12, lineHeight: 18, color: C.textSecondary }}>
                  “{listing.notes}”
                </Text>
              ) : null}
              <Text className="mt-2" style={{ fontSize: 11, lineHeight: 16, color: C.textMuted }}>
                The exact spot is agreed in the chat. Friend codes are shown only once the trade is locked.
              </Text>
            </Section>
          </>
        ) : null}

        {availability.confirmable ? (
          <View className="mb-2 flex-row gap-3 rounded-xl border p-4" style={{ backgroundColor: 'rgba(56,189,248,0.06)', borderColor: 'rgba(56,189,248,0.25)' }}>
            <Info size={18} color={C.blue} style={{ marginTop: 1 }} />
            <Text className="flex-1" style={{ fontSize: 12, lineHeight: 18, color: C.textSecondary }}>
              Confirming locks this trade and freezes every competing offer on the listing. It completes once you both
              confirm in the Handshake.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned below the scroll view, so the answer and the way back are reachable however long the terms run. */}
      <View style={{ paddingBottom: insets.bottom + 24 }}>
        {availability.block && !busy ? (
          <Text className="mb-3 text-center" style={{ fontSize: 12, lineHeight: 18, color: C.textSecondary }}>
            {blockMessage(availability.block, trade.role, partner)}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="mb-3 text-center" style={{ fontSize: 13, lineHeight: 19, color: C.danger }}>
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void confirm()}
          disabled={!availability.confirmable || busy}
          accessibilityRole="button"
          accessibilityLabel="Confirm Trade Agreement"
          accessibilityState={{ disabled: !availability.confirmable || busy, busy }}
          className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] ${!availability.confirmable ? 'opacity-60' : busy ? 'opacity-70' : 'active:opacity-90'}`}
          style={availability.confirmable ? MODAL_SURFACE.ctaGreen : { backgroundColor: C.bgCard, borderWidth: 1, borderColor: C.borderDefault }}
        >
          {busy ? (
            <ActivityIndicator color={C.successText} />
          ) : (
            <Lock size={20} color={availability.confirmable ? C.successText : C.textMuted} strokeWidth={2.8} />
          )}
          <Text
            className="font-display"
            style={{ fontSize: availability.confirmable ? 16 : 14, color: availability.confirmable ? C.successText : C.textSecondary, letterSpacing: -0.16 }}
          >
            {busy ? 'Locking…' : 'Confirm Trade Agreement'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Dismiss and review chat"
          className={`items-center py-3 ${busy ? 'opacity-50' : 'active:opacity-70'}`}
        >
          <Text style={{ fontSize: 13, fontWeight: '500', color: C.textMuted }}>Dismiss / Review Chat</Text>
        </Pressable>
      </View>
      <ToastHost />
    </View>
  );
}

function Ribbon() {
  return (
    <View className="mb-5 flex-row items-center justify-center gap-2">
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, transparent, #38bdf8)' }} />
      <View
        className="flex-row items-center gap-2 rounded-full px-3.5 py-1.5"
        style={{ backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)' }}
      >
        <ClipboardCheck size={12} color={C.blue} strokeWidth={2.5} />
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.blue, letterSpacing: 1.1 }}>
          TRADE SUMMARY
        </Text>
      </View>
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, #38bdf8, transparent)' }} />
    </View>
  );
}

function Section({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <View className="mt-4 rounded-2xl border p-4" style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        {kicker}
      </Text>
      {children}
    </View>
  );
}

function FactRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View className="mb-1.5 flex-row items-center gap-2.5">
      {icon}
      <Text className="flex-1" style={{ fontSize: 13, color: C.textPrimary }}>
        {text}
      </Text>
    </View>
  );
}

function PillView({ pill }: { pill: Pill }) {
  const tone =
    pill.tone === 'shiny'
      ? { bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.4)', text: C.pink }
      : pill.tone === 'lucky'
        ? { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.4)', text: C.gold }
        : { bg: C.bgBase, border: C.borderDefault, text: C.textSecondary };
  return (
    <View className="rounded-md border px-2 py-1" style={{ backgroundColor: tone.bg, borderColor: tone.border }}>
      <Text className="font-mono" style={{ fontSize: 10, letterSpacing: 0.5, color: tone.text }}>
        {pill.label}
      </Text>
    </View>
  );
}

function CreatureSummary({
  kicker,
  owner,
  creature,
  pills,
  accent,
}: {
  kicker: string;
  /** Whose creature this is: "You" or a handle. */
  owner: string;
  creature: CreatureRef;
  pills: Pill[];
  accent: string;
}) {
  return (
    <View className="relative overflow-hidden rounded-2xl border p-4" style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}>
      <View className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: accent }} />
      <Text className="font-mono mb-3" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
        {kicker} · {owner.toUpperCase()}
      </Text>
      <View className="flex-row items-center gap-3.5">
        <Chip creature={creature} size={56} />
        <View className="flex-1 gap-1.5">
          <Text className="font-display" numberOfLines={2} style={{ fontSize: 17, color: C.textPrimary, letterSpacing: -0.17 }}>
            {creatureDisplayName(creature)}
          </Text>
          <TypeBadge creature={creature} />
        </View>
      </View>
      <View className="mt-3 flex-row flex-wrap gap-1.5">
        {pills.map((pill) => (
          <PillView key={pill.label} pill={pill} />
        ))}
      </View>
    </View>
  );
}
