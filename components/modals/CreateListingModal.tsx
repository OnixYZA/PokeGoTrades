import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { ArrowRight, Calendar, Check, CheckSquare, Image as ImageIcon, Plus, Search, Sparkles, Star, Trash2, X } from 'lucide-react-native';

import { MODAL_COLORS, MODAL_SURFACE, monogramGradient } from './tokens';

const C = MODAL_COLORS;

/** Full-screen "Create Listing" seller flow — static UI match of the design handoff, step 2 of 3. */
export function CreateListingModal() {
  return (
    <View className="flex-1" style={{ backgroundColor: C.bgSurface }}>
      <Header />
      <ProgressBar />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <CreatureSelector />
        <AttributesCard />
        <AppraisalSection />
        <WantedInReturn />
      </ScrollView>
      <Footer />
    </View>
  );
}

function Header() {
  return (
    <View
      className="flex-row items-center justify-between border-b px-5 py-4"
      style={{ borderBottomColor: C.borderSubtle }}
    >
      <Pressable
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
      <Pressable accessibilityRole="button" accessibilityLabel="Save draft" className="px-3 py-2 active:opacity-70">
        <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Save</Text>
      </Pressable>
    </View>
  );
}

function ProgressBar() {
  return (
    <View className="px-5 pt-1">
      <View
        className="flex-row gap-[3px] overflow-hidden rounded-full"
        style={{ height: 3, backgroundColor: C.bgCard }}
      >
        <View className="flex-1" style={{ backgroundColor: C.gold }} />
        <View className="flex-1" style={{ backgroundColor: C.gold }} />
        <View className="flex-1" style={{ backgroundColor: C.borderDefault }} />
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

function CreatureSelector() {
  const otherMatches = [
    { label: 'Ch', from: '#fb923c', to: '#ea580c', name: 'Charmeleon', meta: '#005 · Fire' },
    { label: 'Ch', from: '#fdba74', to: '#f97316', name: 'Charmander', meta: '#004 · Fire' },
  ];

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
        <View
          className="rounded-[14px] border py-4 pl-[46px] pr-4"
          style={{
            backgroundColor: C.bgCard,
            borderColor: C.gold,
            boxShadow: '0 0 0 4px rgba(251,191,36,0.08)',
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '500', color: C.textPrimary }}>charizar</Text>
        </View>
      </View>

      <View
        className="mt-2 overflow-hidden rounded-[14px] border"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <View
          className="flex-row items-center gap-3 px-4 py-3"
          style={{
            borderLeftWidth: 2,
            borderLeftColor: C.gold,
            backgroundImage: 'linear-gradient(90deg, rgba(251,191,36,0.08), transparent)',
          }}
        >
          <MonogramTile label="Ch" from="#f97316" to="#dc2626" />
          <View className="flex-1">
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>Charizard</Text>
            <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted }}>
              #006 · Fire / Flying
            </Text>
          </View>
          <Check size={18} color={C.gold} strokeWidth={2.5} />
        </View>
        {otherMatches.map((row) => (
          <View
            key={row.name}
            className="flex-row items-center gap-3 border-t px-4 py-3"
            style={{ borderTopColor: C.borderSubtle }}
          >
            <MonogramTile label={row.label} from={row.from} to={row.to} />
            <View className="flex-1">
              <Text style={{ fontSize: 15, fontWeight: '600', color: C.textPrimary }}>{row.name}</Text>
              <Text className="font-mono" style={{ fontSize: 11, color: C.textMuted }}>
                {row.meta}
              </Text>
            </View>
          </View>
        ))}
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
  isLast,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  description: string;
  on: boolean;
  onGradient?: ViewStyle;
  isLast?: boolean;
}) {
  return (
    <View
      className="flex-row items-center gap-3.5 px-4 py-3.5"
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
    </View>
  );
}

function AttributesCard() {
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
          on
          onGradient={MODAL_SURFACE.toggleGold}
        />
        <AttributeRow
          icon={<Sparkles size={18} color={C.blue} strokeWidth={2.2} />}
          tint="rgba(56,189,248,0.12)"
          title="Purified"
          description="Cleansed from Shadow form"
          on={false}
        />
        <AttributeRow
          icon={<ImageIcon size={18} color={C.pink} strokeWidth={2.2} />}
          tint="rgba(236,72,153,0.12)"
          title="Special Background"
          description="Event / costume variant"
          on
          onGradient={MODAL_SURFACE.togglePink}
          isLast
        />
      </View>
    </View>
  );
}

function AppraisalSection() {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          APPRAISAL SCREENSHOT
        </Text>
        <View className="flex-row items-center gap-1.5">
          <View className="h-2 w-2 rounded-full" style={{ backgroundColor: C.success, boxShadow: '0 0 8px #22c55e' }} />
          <Text className="font-mono-bold" style={{ fontSize: 12, color: C.success, letterSpacing: 1.2 }}>
            OCR VERIFIED
          </Text>
        </View>
      </View>

      <View
        className="flex-row items-center gap-4 rounded-[14px] border border-dashed px-5 py-[22px]"
        style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
      >
        <View
          className="h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-xl"
          style={MODAL_SURFACE.stripedTile}
        >
          <Text
            className="font-mono text-center"
            style={{ fontSize: 9, color: C.textDim, letterSpacing: 0.9, lineHeight: 12 }}
          >
            APPRAISAL{'\n'}SCREEN
          </Text>
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: C.textPrimary }}>
            IMG_2049.jpg
          </Text>
          <Text className="font-mono" style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>
            2.1 MB · scanned in 1.2s
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove screenshot"
          className="h-10 w-10 items-center justify-center rounded-[10px] border active:opacity-70"
          style={{ borderColor: C.borderDefault }}
        >
          <Trash2 size={16} color={C.textSecondary} strokeWidth={2.5} />
        </Pressable>
      </View>

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
    </View>
  );
}

function WantedSlot({ label, from, to, name, dex }: { label: string; from: string; to: string; name: string; dex: string }) {
  return (
    <View
      className="relative aspect-square flex-1 items-center justify-center rounded-xl border p-2.5"
      style={{ backgroundColor: C.bgCard, borderColor: C.borderDefault }}
    >
      <Pressable
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

function WantedInReturn() {
  return (
    <View>
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1.1 }}>
          WANTED IN RETURN
        </Text>
        <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>
          2 / 3
        </Text>
      </View>
      <View className="flex-row gap-2">
        <WantedSlot label="Mw" from="#a78bfa" to="#7c3aed" name="Mewtwo" dex="#150" />
        <WantedSlot label="Ar" from="#60a5fa" to="#2563eb" name="Articuno" dex="#144" />
        <Pressable
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
      </View>
    </View>
  );
}

function Footer() {
  return (
    <View
      className="border-t px-5 pb-6 pt-4"
      style={{ borderTopColor: C.borderSubtle, backgroundImage: 'linear-gradient(180deg, transparent, #0d0d14 30%)' }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue to preview"
        className="flex-row items-center justify-center gap-2 rounded-2xl py-4 active:opacity-90"
        style={MODAL_SURFACE.ctaGold}
      >
        <Text className="font-display" style={{ fontSize: 15, color: '#0a0a0f', letterSpacing: -0.15 }}>
          Continue to Preview
        </Text>
        <ArrowRight size={18} color="#0a0a0f" strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
