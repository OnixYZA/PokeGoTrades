import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Car,
  Check,
  CheckSquare,
  ChevronDown,
  Image as ImageIcon,
  Plus,
  Search,
  Shirt,
  Sparkles,
  Star,
  X,
} from 'lucide-react-native';

import { ListingCard } from '@/components/feed/ListingCard';
import { PokemonPickerModal } from '@/components/modals/PokemonPickerModal';
import { Chip } from '@/components/ui/Chip';
import { Dropdown } from '@/components/ui/Dropdown';
import { TextBadge } from '@/components/ui/TextBadge';
import { useTradeStore } from '@/store/trade-store';
import { findPokemon, type PokedexEntry } from '@/constants/pokedex';
import type { CreatureRef, Listing, TradeType } from '@/data/types';
import { creatureDisplayName } from '@/lib/format';
import {
  LISTING_TAGS,
  POKEBALLS,
  POKEBALL_LABELS,
  TRADE_TIMELINES,
  TRADE_TIMELINE_LABELS,
  type ListingTag,
  type Pokeball,
  type TradeTimeline,
} from '@/constants/listing-attributes';
import {
  fetchListingVerification,
  listingErrorMessage,
  publishListing,
  type ListingProofStatus,
  type ListingVerification,
  type NewListingInput,
  type ProofKind,
} from '@/lib/api/listings';
import { USE_SUPABASE } from '@/lib/data-source';
import { formatBytes, pickProofImage, readProofBytes, type PickedProof } from '@/lib/proof-image';
import { spriteVariantKey, spriteVariantOf } from '@/lib/sprite-url';

import { MODAL_COLORS, MODAL_SURFACE } from './tokens';

const C = MODAL_COLORS;

/** Which control opened the shared `PokemonPickerModal`: the "CREATURE" slot picks a single Pokémon,
 *  "wanted" appends to the "WANTED IN RETURN" list. Mirrors the `pickerFor` pattern
 *  app/(tabs)/profile.tsx uses for its Arsenal/Wishlist "+" buttons. */
type PickerTarget = 'creature' | 'wanted';

/** The three proof slots, one image each — the same kinds as the `proof_kind` enum, so a listing can
 *  structurally hold at most three (`listing_proofs_one_per_kind`). */
const PROOF_KINDS: { proofKind: ProofKind; label: 'Appraisal' | 'Movesets' | 'Event Badge' }[] = [
  { proofKind: 'appraisal', label: 'Appraisal' },
  { proofKind: 'movesets', label: 'Movesets' },
  { proofKind: 'event_badge', label: 'Event Badge' },
];

interface ProofUpload {
  proofKind: ProofKind;
  kind: (typeof PROOF_KINDS)[number]['label'];
  /** A real image from the photo library. Nothing is uploaded until the listing is posted. */
  image: PickedProof;
}

const nextProofSlot = (uploads: ProofUpload[]) =>
  PROOF_KINDS.find((slot) => !uploads.some((u) => u.proofKind === slot.proofKind));

/** The registry, not a hand-kept copy — a migration that adds a `listing_tag` value (like "Level 1",
 *  migration …000100_listing_attributes) shows up here with no edit needed in this file. */
const TAG_OPTIONS: readonly ListingTag[] = LISTING_TAGS;

/** The `listings` table's own tags check (migration 20260916000200_tables.sql:
 *  `cardinality(tags) <= 5`) — enforced here too so a seller sees the cap instead of an insert the
 *  server would reject. */
const MAX_TAGS = 5;

const NOTES_MAX_LENGTH = 280;

/** How long one round of polling waits for the OCR worker's once-a-minute sweep (see the cron
 *  schedule in `workers/azure-ocr/src/functions/ocrSweep.ts`) plus OCR time before offering to keep
 *  waiting. Same values as `ProfileProofStep`'s reference pattern — a shorter timeout would routinely
 *  fire before the sweep has even run once. */
const VERIFY_POLL_TIMEOUT_MS = 90_000;
const VERIFY_POLL_INTERVAL_MS = 3_000;

type Step = 'form' | 'preview' | 'verifying';

interface CreateListingModalProps {
  onClose?: () => void;
  onSave?: () => void;
  /** Fired once the listing is posted. With Supabase the row (and its proofs) already exists, so the
   *  caller just refreshes the feed; with the mock data source the caller appends it to the store. */
  onPublish?: (listing: Listing) => void;
}

/** Full-screen "Create Listing" seller flow, wired for local interactivity — a working creature
 *  search, editable "wanted in return" slots, and a preview step that renders the real
 *  `ListingCard` before the listing is appended to the store. */
export function CreateListingModal({ onClose, onSave, onPublish }: CreateListingModalProps) {
  const insets = useSafeAreaInsets();
  const filterLocation = useTradeStore((s) => s.filterLocation);

  const [step, setStep] = useState<Step>('form');
  const [selectedCreature, setSelectedCreature] = useState<PokedexEntry | null>(null);
  const [shiny, setShiny] = useState(true);
  const [purified, setPurified] = useState(false);
  const [specialBackground, setSpecialBackground] = useState(true);
  const [costume, setCostume] = useState(false);
  const [willTravel, setWillTravel] = useState(false);
  const [pokeball, setPokeball] = useState<Pokeball | null>(null);
  const [tradeTimeline, setTradeTimeline] = useState<TradeTimeline>('flexible');
  // `iv_atk`/`iv_def`/`iv_sta` are seller-declared (migration …000200_tables.sql:
  // `listings_iv_all_or_none`), read straight off the trainer's in-game Appraise screen — not
  // something OCR extracts. `knowsIv` off keeps `draft.iv` at 'Unrated', matching the DB's
  // all-null default; on, all three steppers are sent together.
  const [knowsIv, setKnowsIv] = useState(false);
  const [ivAtk, setIvAtk] = useState(0);
  const [ivDef, setIvDef] = useState(0);
  const [ivSta, setIvSta] = useState(0);
  // Empty until the seller actually picks something — see PokemonPickerModal below; the DB's
  // `creature_ref_array_is_valid(looking, 3)` accepts an empty array, so there's no default to fill.
  const [wanted, setWanted] = useState<CreatureRef[]>([]);
  // Which control opened the shared picker, if any — also doubles as its `visible` flag (same idiom as
  // `pickerFor` in app/(tabs)/profile.tsx).
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  const [uploads, setUploads] = useState<ProofUpload[]>([]);
  const [picking, setPicking] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<ListingTag[]>([]);
  const [notes, setNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Generated once per modal, so retrying a publish that half-succeeded reuses the same listing row.
  const [draftId] = useState(() => randomUUID());

  // ——— 'verifying' step: the listing already exists once we get here, so every field below is about
  // watching the OCR worker settle its proofs, never about the listing itself. ———
  // Set once `publish()` posts a listing that has at least one proof — see that function. Kept
  // separate from `previewListing` because the server-owned fields (`lucky`, `sizeClass`) the worker
  // fills in are exactly what this step is waiting to read back.
  const [postedListing, setPostedListing] = useState<Listing | null>(null);
  // Null until the first successful poll; per-proof statuses come from here, keyed by `kind` (a listing
  // can have at most one proof per kind, so `kind` is a safe join key back to `uploads`).
  const [verification, setVerification] = useState<ListingVerification | null>(null);
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);
  // Refs, not state, for the same reason `ProfileProofStep` (components/onboarding/ProfileProofStep.tsx)
  // uses them: a timer id never needs to trigger a re-render, and reading `.current` inside a callback
  // always sees the latest value instead of one captured at the render that scheduled it.
  const verifyPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifyPollDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards two different races: a poll tick or the deadline firing after the component has unmounted
  // (no state updates after unmount), and `onPublish` firing more than once when several exits race
  // (Done button, header close) — see `exitVerifying`.
  const verifyMounted = useRef(true);
  const verifyExited = useRef(false);

  /** Exactly what gets inserted: only the fields a trainer supplies (see `NewListingInput`). */
  const draft = useMemo<NewListingInput | null>(() => {
    if (!selectedCreature) return null;
    const bg: NewListingInput['bg'] = shiny ? 'shiny' : specialBackground ? 'legacy' : 'meta';
    const tradeType: TradeType = shiny ? 'Unregistered (Shiny/Legendary)' : 'Unregistered (Standard)';
    // `wanted` is already shaped as `CreatureRef[]` (see `handlePickPokemon` below), so no re-mapping.
    const looking: CreatureRef[] = wanted;

    return {
      id: draftId,
      name: selectedCreature.name,
      pokemonId: selectedCreature.pokemonId,
      hue: selectedCreature.hue,
      // `purified` is now its own column (migration …000100_listing_attributes) — `form` no longer
      // encodes it, so every draft writes the plain form name here.
      form: 'Standard',
      // Placeholder until OCR reads the real catch date from the proof (SUPABASE_PLAN.md §5.2 Q9).
      year: new Date().getFullYear(),
      shiny,
      accent: '#fbbf24',
      bg,
      loc: filterLocation,
      tradeType,
      iv: knowsIv ? `${ivAtk}/${ivDef}/${ivSta}` : 'Unrated',
      looking,
      tags: selectedTags,
      notes: notes.trim() || undefined,
      purified,
      // "Special Background" drives `bg` only; costume is its own guarded fact about the creature
      // itself (like `purified`) rather than inferred from the background, so it gets its own toggle.
      costume,
      pokeball,
      willTravel,
      tradeTimeline,
    };
  }, [
    draftId,
    selectedCreature,
    shiny,
    purified,
    specialBackground,
    costume,
    pokeball,
    willTravel,
    tradeTimeline,
    knowsIv,
    ivAtk,
    ivDef,
    ivSta,
    wanted,
    filterLocation,
    selectedTags,
    notes,
  ]);

  /** The draft as the feed card renders it. Seller, ranks, distance and lucky are server-owned, so they are display-only here. */
  const previewListing = useMemo<Listing | null>(
    () =>
      draft && {
        ...draft,
        // A new listing is never Lucky: only the OCR worker sets that, after an appraisal proof backs it.
        lucky: false,
        seller: 'You',
        dist: USE_SUPABASE ? undefined : 0,
        pvp: 'NEW',
        // Service-role only (migration …000100) — a freshly drafted listing has no size yet.
        sizeClass: null,
        screenshots: uploads.map((u) => u.image.filename),
      },
    [draft, uploads]
  );

  const openWantedPicker = () => {
    if (wanted.length >= 3) return; // the DB caps `looking` at 3 (creature_ref_array_is_valid(looking, 3))
    setPickerFor('wanted');
  };

  /** Keyed by `spriteVariantKey`, not `pokemonId` — see `WantedInReturn`'s `onRemoveWanted` comment. */
  const removeWanted = (variantKey: string) => {
    setWanted((prev) => prev.filter((w) => spriteVariantKey(spriteVariantOf(w)) !== variantKey));
  };

  /** The one `PokemonPickerModal` instance below is shared by the "CREATURE" slot and "WANTED IN
   *  RETURN" list, disambiguated by `pickerFor`. Closes the picker before touching state — same order
   *  as app/(tabs)/profile.tsx's `handleSelectPokemon` (see lib/toast.ts on modals and their own
   *  ToastHost; this flow has no toast, but the close-first order still avoids the picker's own Modal
   *  re-rendering mid-close). `shiny` is only ever true here for a 'wanted' pick — the picker's own
   *  Shiny pill is gated off for the 'creature' slot (`allowShiny={pickerFor === 'wanted'}` below),
   *  since that slot already has its own Shiny toggle in the form. */
  const handlePickPokemon = (pokemonId: number, shiny: boolean) => {
    const target = pickerFor;
    setPickerFor(null);
    const entry = findPokemon(pokemonId);
    if (!entry) return;
    if (target === 'creature') {
      setSelectedCreature(entry);
    } else if (target === 'wanted') {
      const candidate: CreatureRef = { name: entry.name, pokemonId: entry.pokemonId, hue: entry.hue, ...(shiny ? { shiny } : {}) };
      const candidateKey = spriteVariantKey(spriteVariantOf(candidate));
      setWanted((prev) =>
        prev.length >= 3 || prev.some((w) => spriteVariantKey(spriteVariantOf(w)) === candidateKey) ? prev : [...prev, candidate]
      );
    }
  };

  const addProof = async () => {
    const slot = nextProofSlot(uploads);
    if (!slot || picking) return;
    setProofError(null);
    setPicking(true);
    try {
      const image = await pickProofImage();
      if (image) setUploads((prev) => [...prev, { proofKind: slot.proofKind, kind: slot.label, image }]);
    } catch (error) {
      setProofError(error instanceof Error ? error.message : 'Could not open your photos.');
    } finally {
      setPicking(false);
    }
  };

  const removeProof = (proofKind: ProofKind) => {
    setUploads((prev) => prev.filter((u) => u.proofKind !== proofKind));
  };

  const toggleTag = (tag: ListingTag) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= MAX_TAGS) return prev; // the server would reject a 6th tag; see MAX_TAGS
      return [...prev, tag];
    });
  };

  const goToPreview = () => {
    if (!selectedCreature) return;
    setStep('preview');
  };

  const stopVerifyPolling = () => {
    if (verifyPollTimer.current) {
      clearInterval(verifyPollTimer.current);
      verifyPollTimer.current = null;
    }
    if (verifyPollDeadline.current) {
      clearTimeout(verifyPollDeadline.current);
      verifyPollDeadline.current = null;
    }
  };

  // Unmount only: `publish()` starts polling imperatively (there is no "resume on mount" case here —
  // unlike ProfileProofStep, this modal is only ever entered right after a fresh post), so the mount
  // effect's one job is making sure a timer never outlives the component.
  useEffect(() => {
    return () => {
      verifyMounted.current = false;
      stopVerifyPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One poll tick: read every proof's current settle state. A transient network error just waits for
   *  the next tick (mirrors `ProfileProofStep.checkLatestProof`) rather than ending the round early —
   *  the listing is already posted, so there is nothing to roll back and no reason to alarm the seller
   *  over one dropped request. `proofCount` is `uploads.length` at the moment polling began: it can't
   *  change mid-poll since the form is left behind once this step is entered. */
  const checkVerification = async (listingId: string, proofCount: number) => {
    let result: ListingVerification;
    try {
      result = await fetchListingVerification(listingId);
    } catch {
      return;
    }
    if (!verifyMounted.current) return;
    setVerification(result);
    const settled =
      result.proofs.length >= proofCount &&
      result.proofs.every((p: ListingProofStatus) => p.status !== 'pending' && p.status !== 'processing');
    if (settled) stopVerifyPolling();
  };

  const beginVerifyPolling = (listingId: string, proofCount: number) => {
    stopVerifyPolling();
    setVerifyTimedOut(false);
    void checkVerification(listingId, proofCount);
    verifyPollTimer.current = setInterval(() => void checkVerification(listingId, proofCount), VERIFY_POLL_INTERVAL_MS);
    verifyPollDeadline.current = setTimeout(() => {
      stopVerifyPolling();
      if (verifyMounted.current) setVerifyTimedOut(true);
    }, VERIFY_POLL_TIMEOUT_MS);
  };

  /** Every way out of the verifying step funnels through here, so `onPublish` — which the caller
   *  (app/(tabs)/index.tsx) uses to refresh the feed and close the modal — fires exactly once no matter
   *  which exit fired (Done, header close, or a future one). The guard is never reset: hiding the parent
   *  `Modal` unmounts this component (on iOS only after the dismiss animation, which is the window a
   *  second tap can land in), so the next "+" starts from a fresh mount anyway. Polling is always stopped
   *  here too: the worker's own once-a-minute sweep keeps verifying regardless. */
  const exitVerifying = () => {
    stopVerifyPolling();
    if (verifyExited.current || !postedListing) return;
    verifyExited.current = true;
    onPublish?.(postedListing);
  };

  const publish = async () => {
    if (!draft || !previewListing || publishing) return;
    if (!USE_SUPABASE) {
      onPublish?.(previewListing);
      return;
    }

    setPublishing(true);
    setPublishError(null);
    try {
      // The listing row goes first: the storage policy only accepts proofs for a listing that already
      // exists and is the caller's. Every step is idempotent for `draftId`, so a retry is safe.
      const proofs = await Promise.all(
        uploads.map(async (u) => ({
          kind: u.proofKind,
          contentType: u.image.contentType,
          data: await readProofBytes(u.image),
        }))
      );
      const listing = await publishListing(draft, proofs);
      if (uploads.length > 0) {
        // The listing (and its proofs) already exist server-side — `onPublish` fires later, once the
        // seller leaves this step (`exitVerifying`), not now. Going straight to 'verifying' rather than
        // calling `onPublish` here is the one behavior change from before: with zero proofs there is
        // nothing to watch, so that case still calls `onPublish` immediately, exactly as today.
        setPostedListing(listing);
        setVerification(null);
        setStep('verifying');
        beginVerifyPolling(listing.id, uploads.length);
      } else {
        onPublish?.(listing);
      }
    } catch (error) {
      setPublishError(listingErrorMessage(error));
    } finally {
      setPublishing(false);
    }
  };

  if (step === 'preview' && previewListing) {
    return (
      <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
        <Header onClose={onClose} onSave={onSave} busy={publishing} />
        <ProgressBar filled={3} />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
              PREVIEW
            </Text>
            <Text style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19 }}>
              This is how your listing will appear in the feed. Nothing is posted yet.
            </Text>
          </View>
          <View style={{ pointerEvents: 'none' }}>
            <ListingCard listing={previewListing} />
          </View>
          {previewListing.tags && previewListing.tags.length > 0 && (
            <View>
              <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
                TAGS ON THIS LISTING
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {previewListing.tags.map((tag) => (
                  <TextBadge key={tag} label={tag} accent={C.gold} selected />
                ))}
              </View>
            </View>
          )}
          {previewListing.screenshots && previewListing.screenshots.length > 0 && (
            <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted }}>
              {previewListing.screenshots.length} proof photo{previewListing.screenshots.length === 1 ? '' : 's'} attached
            </Text>
          )}
        </ScrollView>
        <PreviewFooter
          onBack={() => setStep('form')}
          onPublish={() => void publish()}
          publishing={publishing}
          error={publishError}
          bottomInset={insets.bottom}
        />
      </View>
    );
  }

  if (step === 'verifying' && postedListing) {
    // Keyed by `kind`, not proof id: `listing_proofs_one_per_kind` guarantees at most one proof per
    // kind, so this is a safe (and the only available) join back to the local `uploads` thumbnails —
    // the fetched rows carry a DB-generated `id` this component never saw before now.
    const statusByKind = new Map<ProofKind, ListingProofStatus['status']>(
      (verification?.proofs ?? []).map((p) => [p.kind, p.status])
    );
    const rows = uploads.map((upload) => ({ upload, status: statusByKind.get(upload.proofKind) ?? null }));
    const allSettled =
      verification !== null && rows.every(({ status }) => status === 'verified' || status === 'failed' || status === 'rejected');

    return (
      <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
        {/* No `onSave`: the listing is already posted, so there is no draft left to save. */}
        <Header onClose={exitVerifying} />
        <ProgressBar filled={3} />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
              VERIFYING
            </Text>
            <Text style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19 }}>
              Your listing is live. We're reading your proof photos automatically — this usually takes a
              minute or two, and you don't need to keep this open.
            </Text>
          </View>

          <View className="gap-2.5">
            {rows.map(({ upload, status }) => (
              <VerifyProofRow key={upload.proofKind} upload={upload} status={status} />
            ))}
          </View>

          {allSettled && verification ? (
            <VerificationSummary verification={verification} />
          ) : verifyTimedOut ? (
            <View
              className="gap-3 rounded-[14px] border p-4"
              style={{ borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)' }}
            >
              <Text style={{ fontSize: 13, lineHeight: 19, color: C.textSecondary }}>
                Verification is taking longer than usual. Your listing is posted — proofs keep verifying
                in the background and badges appear on the listing automatically.
              </Text>
              <Pressable
                onPress={() => beginVerifyPolling(postedListing.id, uploads.length)}
                accessibilityRole="button"
                accessibilityLabel="Keep waiting"
                className="items-center rounded-xl py-3 active:opacity-90"
                style={MODAL_SURFACE.ctaGold}
              >
                <Text className="font-display" style={{ fontSize: 14, color: '#0a0a0f', letterSpacing: -0.15 }}>
                  Keep Waiting
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={C.gold} />
              <Text className="font-mono" style={{ fontSize: 12, color: C.textMuted }}>
                Reading your screenshots…
              </Text>
            </View>
          )}
        </ScrollView>
        <VerifyingFooter onDone={exitVerifying} bottomInset={insets.bottom} />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
      <Header onClose={onClose} onSave={onSave} />
      <ProgressBar filled={2} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <CreatureSelector selected={selectedCreature} onPress={() => setPickerFor('creature')} />
        <AttributesCard
          shiny={shiny}
          onToggleShiny={() => setShiny((v) => !v)}
          purified={purified}
          onTogglePurified={() => setPurified((v) => !v)}
          specialBackground={specialBackground}
          onToggleSpecialBackground={() => setSpecialBackground((v) => !v)}
          costume={costume}
          onToggleCostume={() => setCostume((v) => !v)}
          willTravel={willTravel}
          onToggleWillTravel={() => setWillTravel((v) => !v)}
        />
        <IvSpreadSection
          knowsIv={knowsIv}
          onToggleKnowsIv={() => setKnowsIv((v) => !v)}
          ivAtk={ivAtk}
          ivDef={ivDef}
          ivSta={ivSta}
          onChangeAtk={setIvAtk}
          onChangeDef={setIvDef}
          onChangeSta={setIvSta}
        />
        <LogisticsSection
          pokeball={pokeball}
          onSelectPokeball={setPokeball}
          tradeTimeline={tradeTimeline}
          onSelectTimeline={setTradeTimeline}
        />
        <ListingTags selectedTags={selectedTags} onToggleTag={toggleTag} />
        <SellerNotes notes={notes} onChangeNotes={setNotes} />
        <ProofUploadsSection
          uploads={uploads}
          picking={picking}
          error={proofError}
          onAddProof={() => void addProof()}
          onRemoveProof={removeProof}
        />
        <WantedInReturn wanted={wanted} onAddWanted={openWantedPicker} onRemoveWanted={removeWanted} />
      </ScrollView>
      <Footer onContinue={goToPreview} disabled={!selectedCreature} bottomInset={insets.bottom} />
      <PokemonPickerModal
        visible={pickerFor !== null}
        title={pickerFor === 'wanted' ? 'Add to Looking For' : 'Choose your Pokémon'}
        onClose={() => setPickerFor(null)}
        onSelect={handlePickPokemon}
        allowShiny={pickerFor === 'wanted'}
        exclude={pickerFor === 'wanted' ? wanted : undefined}
      />
    </View>
  );
}

function Header({ onClose, onSave, busy }: { onClose?: () => void; onSave?: () => void; busy?: boolean }) {
  return (
    <View
      className="flex-row items-center justify-between border-b px-5 py-4"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <Pressable
        onPress={onClose}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className={`h-10 w-10 items-center justify-center rounded-xl border ${busy ? 'opacity-40' : 'active:opacity-70'}`}
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <X size={18} color={C.textPrimary} strokeWidth={2.5} />
      </Pressable>
      <View className="items-center">
        <Text className="font-display" style={{ fontSize: 17, color: C.textPrimary }}>
          Create Listing
        </Text>
        <Text className="font-mono mt-0.5" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          STEP 2 OF 3
        </Text>
      </View>
      {onSave ? (
        <Pressable
          onPress={onSave}
          accessibilityRole="button"
          accessibilityLabel="Save draft"
          className="px-3 py-2 active:opacity-70"
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Save</Text>
        </Pressable>
      ) : (
        <View className="h-10 w-10" />
      )}
    </View>
  );
}

function ProgressBar({ filled }: { filled: number }) {
  return (
    <View className="px-5 pt-1">
      <View
        className="flex-row gap-[3px] overflow-hidden rounded-full"
        style={{ height: 3, backgroundColor: C.bgCard }}
      >
        {[0, 1, 2].map((i) => (
          <View key={i} className="flex-1" style={{ backgroundColor: i < filled ? C.gold : C.borderDefault }} />
        ))}
      </View>
    </View>
  );
}

/** dex label as `#<padded id>` — matches PokemonPickerModal's own `PokedexRow` formatting. */
const dexLabel = (pokemonId: number) => `#${String(pokemonId).padStart(3, '0')}`;

function CreatureSelector({ selected, onPress }: { selected: PokedexEntry | null; onPress: () => void }) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          CREATURE
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.pink, letterSpacing: 1 }}>
          REQUIRED
        </Text>
      </View>

      {selected ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${selected.name} selected. Change creature`}
          className="flex-row items-center gap-3 rounded-[14px] border px-4 py-3 active:opacity-80"
          style={{ backgroundColor: C.bgCard, borderColor: C.gold, boxShadow: '0 0 0 4px rgba(251,191,36,0.08)' }}
        >
          <Chip creature={selected} size={44} />
          <View className="flex-1">
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{selected.name}</Text>
            <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted }}>
              {dexLabel(selected.pokemonId)} · {selected.type}
            </Text>
          </View>
          <Text className="font-mono-semi" style={{ fontSize: 11, color: C.gold, letterSpacing: 0.6 }}>
            CHANGE
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Choose a Pokémon"
          className="flex-row items-center justify-center gap-2 rounded-[14px] border border-dashed py-4 active:opacity-70"
          style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
        >
          <Search size={16} color={C.textDim} strokeWidth={2} />
          <Text className="font-mono" style={{ fontSize: 12, color: C.textDim, letterSpacing: 0.6 }}>
            CHOOSE A POKÉMON
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function ToggleKnob({ on }: { on: boolean }) {
  return (
    <View
      className="absolute rounded-full"
      style={[
        { top: 2, width: 20, height: 20 },
        on ? { right: 2 } : { left: 2 },
        { backgroundColor: on ? '#fff' : C.textMuted },
        on ? { boxShadow: '0 2px 4px rgba(0,0,0,0.3)' } : null,
      ]}
    />
  );
}

function AttributeRow({
  icon,
  tint,
  title,
  description,
  on,
  onGradient,
  onPress,
  isLast,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  description: string;
  on: boolean;
  onGradient?: ViewStyle;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: on }}
      className="flex-row px-4 py-3 active:opacity-80"
      style={[
        { alignItems: 'center', justifyContent: 'space-between' },
        !isLast ? { borderBottomWidth: 1, borderBottomColor: C.borderSubtle } : undefined,
      ]}
    >
      <View className="h-9 w-9 items-center justify-center rounded-[10px]" style={{ backgroundColor: tint }}>
        {icon}
      </View>
      <View className="flex-1 px-3">
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{title}</Text>
        <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 1 }}>{description}</Text>
      </View>
      <View
        className="relative rounded-full"
        style={[
          { width: 44, height: 24, alignSelf: 'center' },
          on ? onGradient : { backgroundColor: C.borderDefault },
        ]}
      >
        <ToggleKnob on={on} />
      </View>
    </Pressable>
  );
}

function AttributesCard({
  shiny,
  onToggleShiny,
  purified,
  onTogglePurified,
  specialBackground,
  onToggleSpecialBackground,
  costume,
  onToggleCostume,
  willTravel,
  onToggleWillTravel,
}: {
  shiny: boolean;
  onToggleShiny: () => void;
  purified: boolean;
  onTogglePurified: () => void;
  specialBackground: boolean;
  onToggleSpecialBackground: () => void;
  costume: boolean;
  onToggleCostume: () => void;
  willTravel: boolean;
  onToggleWillTravel: () => void;
}) {
  return (
    <View>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        ATTRIBUTES
      </Text>
      <View
        className="overflow-hidden rounded-[14px] border"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <AttributeRow
          icon={<Star size={18} color={C.gold} strokeWidth={2.2} />}
          tint="rgba(251,191,36,0.12)"
          title="Shiny"
          description="Rare alternate coloration"
          on={shiny}
          onGradient={MODAL_SURFACE.toggleGold}
          onPress={onToggleShiny}
        />
        <AttributeRow
          icon={<Sparkles size={18} color={C.blue} strokeWidth={2.2} />}
          tint="rgba(56,189,248,0.12)"
          title="Purified"
          description="Cleansed from Shadow form"
          on={purified}
          onGradient={MODAL_SURFACE.toggleBlue}
          onPress={onTogglePurified}
        />
        <AttributeRow
          icon={<ImageIcon size={18} color={C.pink} strokeWidth={2.2} />}
          tint="rgba(236,72,153,0.12)"
          title="Special Background"
          description="Legacy Move or event background art"
          on={specialBackground}
          onGradient={MODAL_SURFACE.togglePink}
          onPress={onToggleSpecialBackground}
        />
        <AttributeRow
          icon={<Shirt size={18} color={C.pink} strokeWidth={2.2} />}
          tint="rgba(236,72,153,0.12)"
          title="Costume"
          description="Costume-event variant of the creature"
          on={costume}
          onGradient={MODAL_SURFACE.togglePink}
          onPress={onToggleCostume}
        />
        <AttributeRow
          icon={<Car size={18} color={C.blue} strokeWidth={2.2} />}
          tint="rgba(56,189,248,0.12)"
          title="Will Travel"
          description="Willing to meet away from your usual spot"
          on={willTravel}
          onGradient={MODAL_SURFACE.toggleBlue}
          onPress={onToggleWillTravel}
          isLast
        />
      </View>
    </View>
  );
}

/** One ATK/DEF/STA stepper, clamped to the DB's `between 0 and 15` check — there's no way to type an
 *  out-of-range or non-integer value in through +/- buttons, so `parseIv` on the write path can never
 *  reject what this section produces. */
function IvStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View
      className="flex-1 items-center gap-1.5 rounded-[14px] border py-3"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
        {label}
      </Text>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          className="h-7 w-7 items-center justify-center rounded-full border active:opacity-70"
          style={{ borderColor: C.borderDefault }}
        >
          <Text style={{ fontSize: 16, lineHeight: 16, color: C.textSecondary, fontWeight: '700' }}>−</Text>
        </Pressable>
        <Text className="font-display" style={{ fontSize: 18, color: C.textPrimary, minWidth: 22, textAlign: 'center' }}>
          {value}
        </Text>
        <Pressable
          onPress={() => onChange(Math.min(15, value + 1))}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          className="h-7 w-7 items-center justify-center rounded-full border active:opacity-70"
          style={{ borderColor: C.borderDefault }}
        >
          <Text style={{ fontSize: 16, lineHeight: 16, color: C.textSecondary, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The `iv_atk`/`iv_def`/`iv_sta` columns (migration …000200_tables.sql) are seller-declared, read off
 *  the trainer's own in-game Appraise screen — nothing here is extracted by OCR (that's the Appraisal
 *  *proof upload* below, which only backs a Lucky/catch-date/size claim). `knowsIv` off keeps every
 *  listing 'Unrated' by default, matching the DB's all-or-none null columns. */
function IvSpreadSection({
  knowsIv,
  onToggleKnowsIv,
  ivAtk,
  ivDef,
  ivSta,
  onChangeAtk,
  onChangeDef,
  onChangeSta,
}: {
  knowsIv: boolean;
  onToggleKnowsIv: () => void;
  ivAtk: number;
  ivDef: number;
  ivSta: number;
  onChangeAtk: (value: number) => void;
  onChangeDef: (value: number) => void;
  onChangeSta: (value: number) => void;
}) {
  return (
    <View>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        IV SPREAD (OPTIONAL)
      </Text>
      <Pressable
        onPress={onToggleKnowsIv}
        accessibilityRole="switch"
        accessibilityLabel="I know my Pokémon's IVs"
        accessibilityState={{ checked: knowsIv }}
        className="mb-2.5 flex-row items-center justify-between rounded-[14px] border px-4 py-3.5 active:opacity-80"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <View className="flex-1 pr-3">
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>I know my IVs</Text>
          <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 1 }}>From the in-game Appraise screen</Text>
        </View>
        <View
          className="relative rounded-full"
          style={[{ width: 44, height: 24 }, knowsIv ? MODAL_SURFACE.toggleGold : { backgroundColor: C.borderDefault }]}
        >
          <ToggleKnob on={knowsIv} />
        </View>
      </Pressable>
      {knowsIv && (
        <View className="flex-row gap-2.5">
          <IvStepper label="ATK" value={ivAtk} onChange={onChangeAtk} />
          <IvStepper label="DEF" value={ivDef} onChange={onChangeDef} />
          <IvStepper label="STA" value={ivSta} onChange={onChangeSta} />
        </View>
      )}
    </View>
  );
}

function ListingTags({
  selectedTags,
  onToggleTag,
}: {
  selectedTags: ListingTag[];
  onToggleTag: (tag: ListingTag) => void;
}) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          LISTING TAGS
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {selectedTags.length} / {MAX_TAGS} SELECTED
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {TAG_OPTIONS.map((tag) => (
          <TextBadge
            key={tag}
            label={tag}
            accent={C.gold}
            selected={selectedTags.includes(tag)}
            onPress={() => onToggleTag(tag)}
          />
        ))}
      </View>
    </View>
  );
}

function PokeballOption({
  label,
  selected,
  onPress,
  isLast,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      className="flex-row items-center justify-between px-3.5 py-2.5 active:opacity-80"
      style={{
        backgroundColor: selected ? 'rgba(251,191,36,0.08)' : 'transparent',
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: C.borderSubtle,
      }}
    >
      <Text className="font-display-semi" style={{ fontSize: 13, color: selected ? C.gold : C.textPrimary }}>
        {label}
      </Text>
      {selected ? <Check size={14} color={C.gold} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

/** Optional — `null` ("Not specified") is a real, first-class choice, not just an unset default: most
 *  sellers never learn (or bother recording) which ball a catch used. */
function PokeballPicker({ pokeball, onSelect }: { pokeball: Pokeball | null; onSelect: (pokeball: Pokeball | null) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const label = pokeball ? POKEBALL_LABELS[pokeball] : 'Not specified';
  const options: { value: Pokeball | null; label: string }[] = [
    { value: null, label: 'Not specified' },
    ...POKEBALLS.map((ball) => ({ value: ball, label: POKEBALL_LABELS[ball] })),
  ];

  return (
    <View>
      <Text className="font-mono mb-1.5" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
        CAUGHT IN (OPTIONAL)
      </Text>
      <Pressable
        ref={anchorRef}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Poké Ball caught in: ${label}`}
        accessibilityHint="Opens a list of Poké Balls to choose from"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between rounded-[14px] border px-4 py-3.5 active:opacity-80"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <Text style={{ fontSize: 14, fontWeight: '600', color: pokeball ? C.textPrimary : C.textMuted }}>{label}</Text>
        <ChevronDown size={16} color={C.textMuted} />
      </Pressable>
      <Dropdown visible={open} onRequestClose={() => setOpen(false)} anchorRef={anchorRef} align="stretch">
        {options.map((option, i) => (
          <PokeballOption
            key={option.label}
            label={option.label}
            selected={pokeball === option.value}
            onPress={() => {
              onSelect(option.value);
              setOpen(false);
            }}
            isLast={i === options.length - 1}
          />
        ))}
      </Dropdown>
    </View>
  );
}

function TimelinePicker({ timeline, onSelect }: { timeline: TradeTimeline; onSelect: (timeline: TradeTimeline) => void }) {
  return (
    <View>
      <Text className="font-mono mb-1.5" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
        TRADE TIMELINE
      </Text>
      <View accessibilityRole="radiogroup" className="flex-row overflow-hidden rounded-[14px] border" style={{ borderColor: C.borderDefault }}>
        {TRADE_TIMELINES.map((t, i) => {
          const selected = t === timeline;
          return (
            <Pressable
              key={t}
              onPress={() => onSelect(t)}
              accessibilityRole="radio"
              accessibilityLabel={TRADE_TIMELINE_LABELS[t]}
              accessibilityState={{ selected }}
              className="flex-1 items-center justify-center py-2.5 active:opacity-80"
              style={{
                backgroundColor: selected ? C.gold : C.bgCard,
                borderLeftWidth: i === 0 ? 0 : 1,
                borderLeftColor: C.borderDefault,
              }}
            >
              <Text className="font-display-semi" style={{ fontSize: 11, color: selected ? '#0a0a0f' : C.textMuted }}>
                {TRADE_TIMELINE_LABELS[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function LogisticsSection({
  pokeball,
  onSelectPokeball,
  tradeTimeline,
  onSelectTimeline,
}: {
  pokeball: Pokeball | null;
  onSelectPokeball: (pokeball: Pokeball | null) => void;
  tradeTimeline: TradeTimeline;
  onSelectTimeline: (timeline: TradeTimeline) => void;
}) {
  return (
    <View>
      <Text className="font-mono-semi mb-2.5" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
        LOGISTICS
      </Text>
      <View className="gap-3">
        <PokeballPicker pokeball={pokeball} onSelect={onSelectPokeball} />
        <TimelinePicker timeline={tradeTimeline} onSelect={onSelectTimeline} />
        {/* size_class is service-role only (constants/listing-attributes.ts) — no control here ever. */}
        <Text style={{ fontSize: 12, lineHeight: 18, color: C.textDim }}>
          XXL/XXS is added automatically when your appraisal proof verifies.
        </Text>
      </View>
    </View>
  );
}

function SellerNotes({ notes, onChangeNotes }: { notes: string; onChangeNotes: (value: string) => void }) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          ADDITIONAL NOTES (OPTIONAL)
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {notes.length} / {NOTES_MAX_LENGTH}
        </Text>
      </View>
      <TextInput
        value={notes}
        onChangeText={onChangeNotes}
        maxLength={NOTES_MAX_LENGTH}
        placeholder="Meet-up preferences, add-ons you'd accept, anything buyers should know…"
        placeholderTextColor={C.textDim}
        multiline
        numberOfLines={4}
        accessibilityLabel="Additional notes for buyers"
        className="rounded-[14px] border px-4 py-3.5"
        style={{
          backgroundColor: C.bgCard,
          borderColor: C.borderDefault,
          color: C.textPrimary,
          fontSize: 14,
          lineHeight: 21,
          minHeight: 96,
          textAlignVertical: 'top',
        }}
      />
    </View>
  );
}

function ProofRow({ upload, onRemove }: { upload: ProofUpload; onRemove: () => void }) {
  const { image } = upload;
  return (
    <View
      className="flex-row items-center gap-4 rounded-[14px] border px-4 py-3.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <View
        className="h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-xl"
        style={MODAL_SURFACE.stripedTile}
      >
        <Image
          source={{ uri: image.uri }}
          style={{ width: 52, height: 52 }}
          contentFit="cover"
          accessibilityLabel={`${upload.kind} screenshot`}
        />
      </View>
      <View className="flex-1">
        <Text className="font-mono-semi" style={{ fontSize: 9, color: C.gold, letterSpacing: 0.8 }}>
          {upload.kind.toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary, marginTop: 2 }}>
          {image.filename}
        </Text>
        <Text className="font-mono" style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
          {image.sizeBytes === null ? 'Ready to upload' : `${formatBytes(image.sizeBytes)} · ready to upload`}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${upload.kind} upload`}
        className="h-9 w-9 items-center justify-center rounded-[10px] border active:opacity-70"
        style={{ borderColor: C.borderDefault }}
      >
        <X size={14} color={C.textSecondary} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

/** `ProofRow`'s 'verifying'-step twin: same thumbnail-plus-metadata row, but the trailing remove
 *  button (nothing can be removed once posted) is replaced by a status badge over the thumbnail
 *  itself. `status` is null until the first poll response names this proof, which reads the same as
 *  'pending'/'processing' — still in flight, just not confirmed as such yet. */
function VerifyProofRow({ upload, status }: { upload: ProofUpload; status: ListingProofStatus['status'] | null }) {
  const { image } = upload;
  const inFlight = status === null || status === 'pending' || status === 'processing';
  const verified = status === 'verified';
  const failed = status === 'failed' || status === 'rejected';

  return (
    <View
      className="flex-row items-center gap-4 rounded-[14px] border px-4 py-3.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <View
        className="relative h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-xl"
        style={MODAL_SURFACE.stripedTile}
      >
        <Image
          source={{ uri: image.uri }}
          style={{ width: 52, height: 52, opacity: inFlight ? 0.45 : 1 }}
          contentFit="cover"
          accessibilityLabel={`${upload.kind} screenshot`}
        />
        {inFlight && (
          <View
            className="absolute inset-0 items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
          >
            <ActivityIndicator size="small" color={C.gold} />
          </View>
        )}
        {(verified || failed) && (
          <View
            className="absolute bottom-0 right-0 h-5 w-5 items-center justify-center rounded-full border"
            style={{ backgroundColor: verified ? C.success : C.danger, borderColor: C.bgCard }}
          >
            {verified ? (
              <Check size={11} color={C.successText} strokeWidth={3} />
            ) : (
              <X size={11} color={C.textPrimary} strokeWidth={3} />
            )}
          </View>
        )}
      </View>
      <View className="flex-1">
        <Text className="font-mono-semi" style={{ fontSize: 9, color: C.gold, letterSpacing: 0.8 }}>
          {upload.kind.toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary, marginTop: 2 }}>
          {image.filename}
        </Text>
        <Text
          className="font-mono"
          style={{ fontSize: 11, marginTop: 2, color: failed ? C.danger : verified ? C.success : C.textSecondary }}
        >
          {verified ? 'Verified' : failed ? "Couldn't read this screenshot" : 'Reading…'}
        </Text>
      </View>
    </View>
  );
}

/** Shown once every proof in the 'verifying' step has settled (see `allSettled` above). Badges are
 *  additive and independent — a listing can pick up any subset of the three, including none, if the
 *  photos verified but didn't back a size/lucky/location claim. Never renders the location itself
 *  (only whether one was saved): see `ListingVerification.catchLocationSaved`'s comment in
 *  lib/api/listings.ts on why that string never reaches this client. */
function VerificationSummary({ verification }: { verification: ListingVerification }) {
  const { sizeClass, lucky, catchLocationSaved } = verification;
  const hasBadges = sizeClass !== null || lucky || catchLocationSaved;

  return (
    <View
      className="gap-2.5 rounded-[14px] border p-4"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <View className="flex-row items-center gap-2">
        <CheckSquare size={16} color={C.success} strokeWidth={2.5} />
        <Text className="font-mono-bold" style={{ fontSize: 12, color: C.success, letterSpacing: 1.1 }}>
          VERIFICATION COMPLETE
        </Text>
      </View>
      {hasBadges ? (
        <View className="flex-row flex-wrap gap-2">
          {sizeClass ? <TextBadge label={`${sizeClass} confirmed`} accent={C.gold} selected /> : null}
          {lucky ? <TextBadge label="Guaranteed Lucky applied" accent={C.gold} selected /> : null}
          {catchLocationSaved ? <TextBadge label="Catch location saved privately" accent={C.blue} selected /> : null}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: C.textMuted }}>
          Your photos checked out, but didn't back any extra badges.
        </Text>
      )}
    </View>
  );
}

function ProofUploadsSection({
  uploads,
  picking,
  error,
  onAddProof,
  onRemoveProof,
}: {
  uploads: ProofUpload[];
  picking: boolean;
  error: string | null;
  onAddProof: () => void;
  onRemoveProof: (proofKind: ProofKind) => void;
}) {
  const nextKind = nextProofSlot(uploads)?.label;

  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          PROOF UPLOADS (MAX 3)
        </Text>
        {uploads.length > 0 ? (
          <View className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: C.success, boxShadow: '0 0 8px #22c55e' }} />
            <Text className="font-mono-bold" style={{ fontSize: 12, color: C.success, letterSpacing: 1.2 }}>
              {uploads.length} / 3 ATTACHED
            </Text>
          </View>
        ) : (
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
            NONE YET
          </Text>
        )}
      </View>

      <View className="gap-2.5">
        {uploads.map((upload) => (
          <ProofRow key={upload.proofKind} upload={upload} onRemove={() => onRemoveProof(upload.proofKind)} />
        ))}

        {uploads.length < 3 && (
          <Pressable
            onPress={onAddProof}
            disabled={picking}
            accessibilityRole="button"
            accessibilityLabel={`Add ${nextKind ?? 'proof'} upload`}
            className={`flex-row items-center justify-center gap-2 rounded-[14px] border border-dashed py-3.5 ${picking ? 'opacity-60' : 'active:opacity-70'}`}
            style={{ borderColor: C.borderDefault }}
          >
            {picking ? (
              <ActivityIndicator size="small" color={C.textDim} />
            ) : (
              <Plus size={16} color={C.textDim} strokeWidth={2} />
            )}
            <Text className="font-mono" style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.6 }}>
              {picking ? 'OPENING PHOTOS…' : `ADD PROOF${nextKind ? ` · ${nextKind.toUpperCase()}` : ''}`}
            </Text>
          </Pressable>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={{ fontSize: 12, color: C.danger }}>
            {error}
          </Text>
        ) : null}
      </View>

      {uploads.length > 0 && !USE_SUPABASE && (
        <View
          className="relative mt-3 overflow-hidden rounded-[14px] border p-[18px]"
          style={[MODAL_SURFACE.extractedCard, { borderColor: 'rgba(251,191,36,0.3)' }]}
        >
          <View className="absolute left-0 right-0 top-0 h-0.5" style={[MODAL_SURFACE.sheenLine, { opacity: 0.5 }]} />

          <View className="mb-3.5 flex-row items-center gap-2">
            <CheckSquare size={16} color={C.gold} strokeWidth={2.5} />
            <Text className="font-mono-bold" style={{ fontSize: 13, color: C.gold, letterSpacing: 1.3 }}>
              EXTRACTED FROM SCAN
            </Text>
          </View>

          <View
            className="mb-2.5 flex-row items-center gap-3.5 rounded-xl px-4 py-3.5"
            style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          >
            <Calendar size={22} color="#d4d4d8" strokeWidth={2} />
            <View className="flex-1">
              <Text className="font-mono-semi" style={{ fontSize: 12, color: C.textSecondary, letterSpacing: 1.2 }}>
                CAUGHT
              </Text>
              <Text className="font-mono-bold" style={{ fontSize: 20, color: C.textPrimary, marginTop: 4 }}>
                08 / 14 / 2019
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-3 rounded-xl px-3.5 py-3" style={MODAL_SURFACE.luckyBadge}>
            <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}>
              <Star size={18} color="#0a0a0f" fill="#0a0a0f" />
            </View>
            <View className="flex-1">
              <Text className="font-display" style={{ fontSize: 16, color: '#0a0a0f', letterSpacing: -0.16 }}>
                Guaranteed Lucky
              </Text>
              <Text style={{ fontSize: 12, fontWeight: '500', color: 'rgba(10,10,15,0.75)', marginTop: 2 }}>
                Caught before 07/2019 · auto-applied
              </Text>
            </View>
          </View>
        </View>
      )}
      {uploads.length > 0 && USE_SUPABASE && (
        <Text className="mt-3" style={{ fontSize: 12, lineHeight: 18, color: C.textMuted }}>
          Proofs are stored privately and uploaded when you post. They're verified automatically after
          that — usually within a minute or two — and any badges they unlock appear on the listing on
          their own.
        </Text>
      )}
    </View>
  );
}

function WantedSlot({ creature, onRemove }: { creature: CreatureRef; onRemove?: () => void }) {
  return (
    <View
      className="relative aspect-square flex-1 items-center justify-center rounded-xl border p-2.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${creatureDisplayName(creature)}`}
        className="absolute right-1 top-1 h-[18px] w-[18px] items-center justify-center rounded-full border active:opacity-70"
        style={{ backgroundColor: '#0a0a0f', borderColor: C.borderDefault }}
      >
        <X size={10} color={C.textSecondary} strokeWidth={3} />
      </Pressable>
      <Chip creature={creature} size={36} />
      <Text className="mt-1.5" numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: C.textPrimary }}>
        {creatureDisplayName(creature)}
      </Text>
      <Text className="font-mono" style={{ fontSize: 9, color: C.textMuted }}>
        {dexLabel(creature.pokemonId)}
      </Text>
    </View>
  );
}

function WantedInReturn({
  wanted,
  onAddWanted,
  onRemoveWanted,
}: {
  wanted: CreatureRef[];
  onAddWanted?: () => void;
  /** Keyed by `spriteVariantKey(spriteVariantOf(...))`, not `pokemonId` — a shiny and non-shiny entry
   *  for the same species are distinct wanted slots (see `handlePickPokemon`'s dedupe). */
  onRemoveWanted?: (variantKey: string) => void;
}) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          WANTED IN RETURN (OPTIONAL)
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {wanted.length} / 3
        </Text>
      </View>
      {wanted.length === 0 ? (
        // A real, valid empty state — not just an unfilled default: nothing here is required to
        // publish (creature_ref_array_is_valid(looking, 3) accepts an empty array), so this reads as
        // "up to 3, none yet" rather than a blown-up single `aspect-square` tile stretched to full width.
        <Pressable
          onPress={onAddWanted}
          accessibilityRole="button"
          accessibilityLabel="Add up to 3 creatures you'd like in return"
          className="flex-row items-center justify-center gap-2 rounded-xl border border-dashed py-5 active:opacity-70"
          style={{ borderColor: C.borderDefault }}
        >
          <Plus size={18} color={C.textDim} strokeWidth={2} />
          <Text className="font-mono" style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.5 }}>
            ADD UP TO 3
          </Text>
        </Pressable>
      ) : (
        <View className="flex-row gap-2">
          {wanted.map((w) => {
            const key = spriteVariantKey(spriteVariantOf(w));
            return <WantedSlot key={key} creature={w} onRemove={() => onRemoveWanted?.(key)} />;
          })}
          {wanted.length < 3 && (
            <Pressable
              onPress={onAddWanted}
              accessibilityRole="button"
              accessibilityLabel="Add wanted creature"
              className="aspect-square flex-1 items-center justify-center gap-1 rounded-xl border border-dashed active:opacity-70"
              style={{ borderColor: C.borderDefault }}
            >
              <Plus size={20} color={C.textDim} strokeWidth={2} />
              <Text className="font-mono" style={{ fontSize: 10, color: C.textDim, letterSpacing: 0.5 }}>
                ADD
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function Footer({
  onContinue,
  disabled,
  bottomInset = 0,
}: {
  onContinue?: () => void;
  disabled?: boolean;
  bottomInset?: number;
}) {
  return (
    <View
      className="border-t px-5 pt-4"
      style={{
        borderTopColor: C.borderSubtle,
        backgroundImage: 'linear-gradient(180deg, transparent, #0d0d14 30%)',
        paddingBottom: Math.max(bottomInset, 24),
      }}
    >
      <Pressable
        onPress={disabled ? undefined : onContinue}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Preview listing"
        className={`flex-row items-center justify-center gap-2 rounded-2xl py-4 ${disabled ? 'opacity-50' : 'active:opacity-90'}`}
        style={MODAL_SURFACE.ctaGold}
      >
        <Text className="font-display" style={{ fontSize: 15, color: '#0a0a0f', letterSpacing: -0.15 }}>
          Preview Listing
        </Text>
        <ArrowRight size={18} color="#0a0a0f" strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function PreviewFooter({
  onBack,
  onPublish,
  publishing,
  error,
  bottomInset = 0,
}: {
  onBack?: () => void;
  onPublish?: () => void;
  publishing?: boolean;
  error?: string | null;
  bottomInset?: number;
}) {
  return (
    <View
      className="gap-2.5 border-t px-5 pt-4"
      style={{
        borderTopColor: C.borderSubtle,
        backgroundImage: 'linear-gradient(180deg, transparent, #0d0d14 30%)',
        paddingBottom: Math.max(bottomInset, 24),
      }}
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 13, lineHeight: 19, color: C.danger }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        onPress={publishing ? undefined : onPublish}
        disabled={publishing}
        accessibilityRole="button"
        accessibilityLabel="Post listing"
        accessibilityState={{ busy: publishing }}
        className={`flex-row items-center justify-center gap-2 rounded-2xl py-4 ${publishing ? 'opacity-70' : 'active:opacity-90'}`}
        style={MODAL_SURFACE.ctaGreen}
      >
        {publishing ? (
          <ActivityIndicator size="small" color={C.successText} />
        ) : (
          <Check size={18} color={C.successText} strokeWidth={2.5} />
        )}
        <Text className="font-display" style={{ fontSize: 15, color: C.successText, letterSpacing: -0.15 }}>
          {publishing ? 'Posting…' : error ? 'Try Again' : 'Post Listing'}
        </Text>
      </Pressable>
      <Pressable
        onPress={onBack}
        disabled={publishing}
        accessibilityRole="button"
        accessibilityLabel="Back to edit"
        className={`flex-row items-center justify-center gap-2 py-2 ${publishing ? 'opacity-40' : 'active:opacity-70'}`}
      >
        <ArrowLeft size={16} color={C.textMuted} strokeWidth={2.5} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Back to Edit</Text>
      </Pressable>
    </View>
  );
}

/** The 'verifying' step's only footer action. Always enabled, even mid-poll: the listing is already
 *  live and the worker's own sweep keeps verifying it in the background regardless of whether this
 *  modal is still open, so there is nothing "Done" needs to wait for. */
function VerifyingFooter({ onDone, bottomInset = 0 }: { onDone?: () => void; bottomInset?: number }) {
  return (
    <View
      className="border-t px-5 pt-4"
      style={{
        borderTopColor: C.borderSubtle,
        backgroundImage: 'linear-gradient(180deg, transparent, #0d0d14 30%)',
        paddingBottom: Math.max(bottomInset, 24),
      }}
    >
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Done"
        className="flex-row items-center justify-center gap-2 rounded-2xl py-4 active:opacity-90"
        style={MODAL_SURFACE.ctaGold}
      >
        <Check size={18} color="#0a0a0f" strokeWidth={2.5} />
        <Text className="font-display" style={{ fontSize: 15, color: '#0a0a0f', letterSpacing: -0.15 }}>
          Done
        </Text>
      </Pressable>
    </View>
  );
}
