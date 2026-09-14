import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CheckSquare,
  Image as ImageIcon,
  Plus,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react-native';

import { ListingCard } from '@/components/feed/ListingCard';
import { TextBadge } from '@/components/ui/TextBadge';
import { useTradeStore } from '@/store/trade-store';
import type { BackgroundHint, CreatureRef, Listing, TradeType } from '@/data/types';

import { MODAL_COLORS, MODAL_SURFACE, monogramGradient } from './tokens';

const C = MODAL_COLORS;

interface CreatureOption {
  label: string;
  from: string;
  to: string;
  name: string;
  meta: string;
  pokemonId: number;
  hue: number;
}

const CREATURE_OPTIONS: CreatureOption[] = [
  { label: 'Ch', from: '#f97316', to: '#dc2626', name: 'Charizard', meta: '#006 · Fire / Flying', pokemonId: 6, hue: 18 },
  { label: 'Ch', from: '#fb923c', to: '#ea580c', name: 'Charmeleon', meta: '#005 · Fire', pokemonId: 5, hue: 18 },
  { label: 'Ch', from: '#fdba74', to: '#f97316', name: 'Charmander', meta: '#004 · Fire', pokemonId: 4, hue: 18 },
  { label: 'Bl', from: '#60a5fa', to: '#2563eb', name: 'Blastoise', meta: '#009 · Water', pokemonId: 9, hue: 205 },
  { label: 'Ve', from: '#86efac', to: '#16a34a', name: 'Venusaur', meta: '#003 · Grass / Poison', pokemonId: 3, hue: 130 },
];

interface WantedCreature {
  label: string;
  from: string;
  to: string;
  name: string;
  dex: string;
  pokemonId: number;
  hue: number;
}

const WANTED_POOL: WantedCreature[] = [
  { label: 'Mw', from: '#a78bfa', to: '#7c3aed', name: 'Mewtwo', dex: '#150', pokemonId: 150, hue: 275 },
  { label: 'Ar', from: '#60a5fa', to: '#2563eb', name: 'Articuno', dex: '#144', pokemonId: 144, hue: 210 },
  { label: 'Zp', from: '#fde68a', to: '#f59e0b', name: 'Zapdos', dex: '#145', pokemonId: 145, hue: 48 },
  { label: 'Mo', from: '#fca5a5', to: '#dc2626', name: 'Moltres', dex: '#146', pokemonId: 146, hue: 15 },
  { label: 'Dn', from: '#93c5fd', to: '#1d4ed8', name: 'Dragonite', dex: '#149', pokemonId: 149, hue: 205 },
];

interface ProofUpload {
  id: string;
  kind: 'Appraisal' | 'Movesets' | 'Event Badge';
  filename: string;
  meta: string;
}

/** No real camera/gallery picker is wired up in this mock app — "adding a proof" cycles through a
 *  small preset pool, same simulated-upload pattern as `WANTED_POOL` above. */
const PROOF_POOL: ProofUpload[] = [
  { id: 'proof-appraisal', kind: 'Appraisal', filename: 'IMG_2049.jpg', meta: '2.1 MB · scanned in 1.2s' },
  { id: 'proof-movesets', kind: 'Movesets', filename: 'IMG_2051.jpg', meta: '1.8 MB · scanned in 0.9s' },
  { id: 'proof-badges', kind: 'Event Badge', filename: 'IMG_2058.jpg', meta: '956 KB · scanned in 0.6s' },
];

const TAG_OPTIONS = ['Legacy Move', 'Community Day', 'PvP Ready', 'Raid Exclusive', 'Hundo IV'];

const NOTES_MAX_LENGTH = 280;

type Step = 'form' | 'preview';

interface CreateListingModalProps {
  onClose?: () => void;
  onSave?: () => void;
  /** Fired when the trainer confirms the preview — the caller is expected to append the listing
   *  to the global store. */
  onPublish?: (listing: Listing) => void;
}

/** Full-screen "Create Listing" seller flow, wired for local interactivity — a working creature
 *  search, editable "wanted in return" slots, and a preview step that renders the real
 *  `ListingCard` before the listing is appended to the store. */
export function CreateListingModal({ onClose, onSave, onPublish }: CreateListingModalProps) {
  const insets = useSafeAreaInsets();
  const filterLocation = useTradeStore((s) => s.filterLocation);

  const [step, setStep] = useState<Step>('form');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCreature, setSelectedCreature] = useState<CreatureOption | null>(CREATURE_OPTIONS[0]);
  const [shiny, setShiny] = useState(true);
  const [purified, setPurified] = useState(false);
  const [specialBackground, setSpecialBackground] = useState(true);
  const [wanted, setWanted] = useState<WantedCreature[]>(WANTED_POOL.slice(0, 2));
  const [uploads, setUploads] = useState<ProofUpload[]>(PROOF_POOL.slice(0, 1));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const previewListing = useMemo<Listing | null>(() => {
    if (!selectedCreature) return null;
    const bg: BackgroundHint = shiny ? 'shiny' : specialBackground ? 'legacy' : 'meta';
    const tradeType: TradeType = shiny ? 'Unregistered (Shiny/Legendary)' : 'Unregistered (Standard)';
    const looking: CreatureRef[] = wanted.map((w) => ({ name: w.name, pokemonId: w.pokemonId, hue: w.hue }));

    return {
      id: `draft-${selectedCreature.pokemonId}-${Date.now()}`,
      name: selectedCreature.name,
      pokemonId: selectedCreature.pokemonId,
      hue: selectedCreature.hue,
      form: purified ? 'Purified' : 'Standard',
      year: new Date().getFullYear(),
      lucky: true,
      shiny,
      accent: '#fbbf24',
      bg,
      seller: 'You',
      dist: 0,
      loc: filterLocation,
      pvp: 'NEW',
      demand: 'NEW',
      tradeType,
      iv: 'Unrated',
      looking,
      screenshots: uploads.map((u) => u.filename),
      tags: selectedTags,
      notes: notes.trim() || undefined,
    };
  }, [selectedCreature, shiny, purified, specialBackground, wanted, filterLocation, uploads, selectedTags, notes]);

  const addWanted = () => {
    if (wanted.length >= 3) return;
    const next = WANTED_POOL.find((w) => !wanted.some((existing) => existing.name === w.name));
    if (next) setWanted((prev) => [...prev, next]);
  };

  const removeWanted = (name: string) => {
    setWanted((prev) => prev.filter((w) => w.name !== name));
  };

  const addProof = () => {
    if (uploads.length >= 3) return;
    const next = PROOF_POOL.find((p) => !uploads.some((existing) => existing.kind === p.kind));
    if (next) setUploads((prev) => [...prev, next]);
  };

  const removeProof = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const goToPreview = () => {
    if (!selectedCreature) return;
    setStep('preview');
  };

  const publish = () => {
    if (!previewListing) return;
    onPublish?.(previewListing);
  };

  if (step === 'preview' && previewListing) {
    return (
      <View className="flex-1" style={{ backgroundColor: C.bgSurface, paddingTop: insets.top }}>
        <Header onClose={onClose} onSave={onSave} />
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
        <PreviewFooter onBack={() => setStep('form')} onPublish={publish} bottomInset={insets.bottom} />
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
        <CreatureSelector
          query={searchQuery}
          onQueryChange={setSearchQuery}
          selected={selectedCreature}
          onSelect={setSelectedCreature}
        />
        <AttributesCard
          shiny={shiny}
          onToggleShiny={() => setShiny((v) => !v)}
          purified={purified}
          onTogglePurified={() => setPurified((v) => !v)}
          specialBackground={specialBackground}
          onToggleSpecialBackground={() => setSpecialBackground((v) => !v)}
        />
        <ListingTags selectedTags={selectedTags} onToggleTag={toggleTag} />
        <SellerNotes notes={notes} onChangeNotes={setNotes} />
        <ProofUploadsSection uploads={uploads} onAddProof={addProof} onRemoveProof={removeProof} />
        <WantedInReturn wanted={wanted} onAddWanted={addWanted} onRemoveWanted={removeWanted} />
      </ScrollView>
      <Footer onContinue={goToPreview} disabled={!selectedCreature} bottomInset={insets.bottom} />
    </View>
  );
}

function Header({ onClose, onSave }: { onClose?: () => void; onSave?: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between border-b px-5 py-4"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="h-10 w-10 items-center justify-center rounded-xl border active:opacity-70"
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
      <Pressable
        onPress={onSave}
        accessibilityRole="button"
        accessibilityLabel="Save draft"
        className="px-3 py-2 active:opacity-70"
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Save</Text>
      </Pressable>
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

function MonogramTile({
  label,
  from,
  to,
  size = 40,
  radius = 10,
  fontSize = 15,
}: {
  label: string;
  from: string;
  to: string;
  size?: number;
  radius?: number;
  fontSize?: number;
}) {
  return (
    <View
      className="items-center justify-center"
      style={[{ width: size, height: size, borderRadius: radius }, monogramGradient(from, to)]}
    >
      <Text className="font-display" style={{ fontSize, color: '#fff' }}>
        {label}
      </Text>
    </View>
  );
}

function CreatureSelector({
  query,
  onQueryChange,
  selected,
  onSelect,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  selected: CreatureOption | null;
  onSelect: (creature: CreatureOption) => void;
}) {
  const matches = CREATURE_OPTIONS.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

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

      <View className="relative justify-center">
        <View className="absolute left-4 z-10">
          <Search size={18} color={C.textMuted} />
        </View>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search a creature…"
          placeholderTextColor={C.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search creature name"
          className="rounded-[14px] border py-4 pl-[46px] pr-4"
          style={{
            backgroundColor: C.bgCard,
            borderColor: C.gold,
            boxShadow: '0 0 0 4px rgba(251,191,36,0.08)',
            fontSize: 15,
            fontWeight: '500',
            color: C.textPrimary,
          }}
        />
      </View>

      <View
        className="mt-2 overflow-hidden rounded-[14px] border"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        {matches.length === 0 ? (
          <View className="px-4 py-4">
            <Text style={{ fontSize: 13, color: C.textMuted }}>No matches for &ldquo;{query}&rdquo;</Text>
          </View>
        ) : (
          matches.map((row, i) => {
            const focused = selected?.name === row.name;
            return (
              <Pressable
                key={row.name}
                onPress={() => onSelect(row)}
                accessibilityRole="menuitem"
                accessibilityLabel={`Select ${row.name}, ${row.meta}`}
                accessibilityState={{ selected: focused }}
                className="flex-row items-center gap-3 px-4 py-3 active:opacity-80"
                style={
                  focused
                    ? {
                        borderLeftWidth: 2,
                        borderLeftColor: C.gold,
                        backgroundImage: 'linear-gradient(90deg, rgba(251,191,36,0.08), transparent)',
                      }
                    : { borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.borderSubtle }
                }
              >
                <MonogramTile label={row.label} from={row.from} to={row.to} />
                <View className="flex-1">
                  <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{row.name}</Text>
                  <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted }}>
                    {row.meta}
                  </Text>
                </View>
                {focused ? <Check size={18} color={C.gold} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

function ToggleKnob({ on }: { on: boolean }) {
  return (
    <View
      className="absolute top-[3px] h-[22px] w-[22px] rounded-full"
      style={[
        on ? { right: 3 } : { left: 3 },
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
      className="flex-row items-center gap-3.5 px-4 py-3.5 active:opacity-80"
      style={!isLast ? { borderBottomWidth: 1, borderBottomColor: C.borderSubtle } : undefined}
    >
      <View className="h-9 w-9 items-center justify-center rounded-[10px]" style={{ backgroundColor: tint }}>
        {icon}
      </View>
      <View className="flex-1">
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{title}</Text>
        <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 1 }}>{description}</Text>
      </View>
      <View className="relative h-7 w-12 rounded-full" style={on ? onGradient : { backgroundColor: C.borderDefault }}>
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
}: {
  shiny: boolean;
  onToggleShiny: () => void;
  purified: boolean;
  onTogglePurified: () => void;
  specialBackground: boolean;
  onToggleSpecialBackground: () => void;
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
          description="Event / costume variant"
          on={specialBackground}
          onGradient={MODAL_SURFACE.togglePink}
          onPress={onToggleSpecialBackground}
          isLast
        />
      </View>
    </View>
  );
}

function ListingTags({
  selectedTags,
  onToggleTag,
}: {
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
}) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          LISTING TAGS
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {selectedTags.length} SELECTED
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
  return (
    <View
      className="flex-row items-center gap-4 rounded-[14px] border px-4 py-3.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <View
        className="h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-xl"
        style={MODAL_SURFACE.stripedTile}
      >
        <ImageIcon size={18} color={C.textDim} />
      </View>
      <View className="flex-1">
        <Text className="font-mono-semi" style={{ fontSize: 9, color: C.gold, letterSpacing: 0.8 }}>
          {upload.kind.toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary, marginTop: 2 }}>
          {upload.filename}
        </Text>
        <Text className="font-mono" style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
          {upload.meta}
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

function ProofUploadsSection({
  uploads,
  onAddProof,
  onRemoveProof,
}: {
  uploads: ProofUpload[];
  onAddProof: () => void;
  onRemoveProof: (id: string) => void;
}) {
  const nextKind = PROOF_POOL.find((p) => !uploads.some((u) => u.kind === p.kind))?.kind;

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
              {uploads.length} / 3 VERIFIED
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
          <ProofRow key={upload.id} upload={upload} onRemove={() => onRemoveProof(upload.id)} />
        ))}

        {uploads.length < 3 && (
          <Pressable
            onPress={onAddProof}
            accessibilityRole="button"
            accessibilityLabel={`Add ${nextKind ?? 'proof'} upload`}
            className="flex-row items-center justify-center gap-2 rounded-[14px] border border-dashed py-3.5 active:opacity-70"
            style={{ borderColor: C.borderDefault }}
          >
            <Plus size={16} color={C.textDim} strokeWidth={2} />
            <Text className="font-mono" style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.6 }}>
              ADD PROOF{nextKind ? ` · ${nextKind.toUpperCase()}` : ''}
            </Text>
          </Pressable>
        )}
      </View>

      {uploads.length > 0 && (
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
    </View>
  );
}

function WantedSlot({
  label,
  from,
  to,
  name,
  dex,
  onRemove,
}: {
  label: string;
  from: string;
  to: string;
  name: string;
  dex: string;
  onRemove?: () => void;
}) {
  return (
    <View
      className="relative aspect-square flex-1 items-center justify-center rounded-xl border p-2.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        className="absolute right-1 top-1 h-[18px] w-[18px] items-center justify-center rounded-full border active:opacity-70"
        style={{ backgroundColor: '#0a0a0f', borderColor: C.borderDefault }}
      >
        <X size={10} color={C.textSecondary} strokeWidth={3} />
      </Pressable>
      <MonogramTile label={label} from={from} to={to} size={36} radius={10} fontSize={13} />
      <Text className="mt-1.5" style={{ fontSize: 11, fontWeight: '600', color: C.textPrimary }}>
        {name}
      </Text>
      <Text className="font-mono" style={{ fontSize: 9, color: C.textMuted }}>
        {dex}
      </Text>
    </View>
  );
}

function WantedInReturn({
  wanted,
  onAddWanted,
  onRemoveWanted,
}: {
  wanted: WantedCreature[];
  onAddWanted?: () => void;
  onRemoveWanted?: (name: string) => void;
}) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          WANTED IN RETURN
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          {wanted.length} / 3
        </Text>
      </View>
      <View className="flex-row gap-2">
        {wanted.map((w) => (
          <WantedSlot
            key={w.name}
            label={w.label}
            from={w.from}
            to={w.to}
            name={w.name}
            dex={w.dex}
            onRemove={() => onRemoveWanted?.(w.name)}
          />
        ))}
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
  bottomInset = 0,
}: {
  onBack?: () => void;
  onPublish?: () => void;
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
      <Pressable
        onPress={onPublish}
        accessibilityRole="button"
        accessibilityLabel="Post listing"
        className="flex-row items-center justify-center gap-2 rounded-2xl py-4 active:opacity-90"
        style={MODAL_SURFACE.ctaGreen}
      >
        <Check size={18} color={C.successText} strokeWidth={2.5} />
        <Text className="font-display" style={{ fontSize: 15, color: C.successText, letterSpacing: -0.15 }}>
          Post Listing
        </Text>
      </Pressable>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to edit"
        className="flex-row items-center justify-center gap-2 py-2 active:opacity-70"
      >
        <ArrowLeft size={16} color={C.textMuted} strokeWidth={2.5} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Back to Edit</Text>
      </Pressable>
    </View>
  );
}
