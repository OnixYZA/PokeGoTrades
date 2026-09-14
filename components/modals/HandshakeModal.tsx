import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckSquare, Copy, Lock, Star, X } from 'lucide-react-native';

import { MODAL_COLORS, MODAL_SURFACE, monogramGradient } from './tokens';

const C = MODAL_COLORS;

interface HandshakeModalProps {
  onCopyMyCode?: () => void;
  onCopyTheirCode?: () => void;
  onMarkCompleted?: () => void;
  onReturnToChat?: () => void;
}

/** Post-lock "Handshake & Verify" overlay — static layout match of the design handoff, with onPress hooks left open for the caller. */
export function HandshakeModal({ onCopyMyCode, onCopyTheirCode, onMarkCompleted, onReturnToChat }: HandshakeModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 px-5"
      style={{
        backgroundColor: C.bgBase,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <LockRibbon />
      <TitleBlock />
      <HandshakeAvatars />

      <View className="mb-5">
        <FriendCodeCard
          stripeFrom={C.pink}
          stripeTo={C.pinkDark}
          avatarFrom={C.pink}
          avatarTo={C.pinkDark}
          avatarLabel="R"
          name="RaticateBoss99"
          roleKicker="YOU · SELLER"
          code="4821 · 5904 · 3372"
          onCopy={onCopyMyCode}
        />
        <FriendCodeCard
          stripeFrom={C.blue}
          stripeTo={C.blueDark}
          avatarFrom={C.blue}
          avatarTo={C.blueDark}
          avatarLabel="K"
          name="KantoKing"
          roleKicker="BUYER · 4.9 ★ (128)"
          code="1109 · 7462 · 8503"
          ratingStar
          isLast
          onCopy={onCopyTheirCode}
        />
      </View>

      <WarningCallout />

      <Pressable
        onPress={onMarkCompleted}
        accessibilityRole="button"
        accessibilityLabel="Mark trade completed"
        className="flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] active:opacity-90"
        style={[MODAL_SURFACE.ctaGreen, { marginTop: 'auto' }]}
      >
        <CheckSquare size={20} color={C.successText} strokeWidth={2.8} />
        <Text className="font-display" style={{ fontSize: 16, color: C.successText, letterSpacing: -0.16 }}>
          Mark Trade Completed
        </Text>
      </Pressable>
      <Pressable
        onPress={onReturnToChat}
        accessibilityRole="button"
        accessibilityLabel="Return to chat"
        className="items-center py-3 active:opacity-70"
      >
        <Text style={{ fontSize: 13, fontWeight: '500', color: C.textMuted }}>Return to chat</Text>
      </Pressable>
    </View>
  );
}

function LockRibbon() {
  return (
    <View className="mb-5 flex-row items-center justify-center gap-2">
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, transparent, #38bdf8)' }} />
      <View
        className="flex-row items-center gap-2 rounded-full px-3.5 py-1.5"
        style={{ backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)' }}
      >
        <Lock size={12} color={C.blue} strokeWidth={2.5} />
        <Text className="font-mono-semi" style={{ fontSize: 11, color: C.blue, letterSpacing: 1.1 }}>
          TRADE LOCKED
        </Text>
      </View>
      <View className="h-px flex-1" style={{ backgroundImage: 'linear-gradient(90deg, #38bdf8, transparent)' }} />
    </View>
  );
}

function TitleBlock() {
  return (
    <View className="mb-12 items-center">
      <Text className="font-display text-center" style={{ fontSize: 26, lineHeight: 30, color: C.textPrimary, letterSpacing: -0.52 }}>
        Exchange{'\n'}Friend Codes
      </Text>
      <Text className="mt-2.5 text-center" style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19.5 }}>
        Both trainers have accepted. Add each other in-game and meet up.
      </Text>
    </View>
  );
}

function HandshakeAvatars() {
  return (
    <View className="mb-8 flex-row items-center justify-center gap-3">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={[monogramGradient(C.pink, C.pinkDark), { borderWidth: 2, borderColor: C.bgSurface, boxShadow: `0 0 0 2px ${C.pink}` }]}
      >
        <Text className="font-display" style={{ fontSize: 20, color: '#fff' }}>
          R
        </Text>
      </View>
      <View className="items-center gap-1">
        <X size={24} color={C.blue} strokeWidth={2} />
        <Text className="font-mono" style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.9 }}>
          MATCH
        </Text>
      </View>
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={[monogramGradient(C.blue, C.blueDark), { borderWidth: 2, borderColor: C.bgSurface, boxShadow: `0 0 0 2px ${C.blue}` }]}
      >
        <Text className="font-display" style={{ fontSize: 20, color: '#fff' }}>
          K
        </Text>
      </View>
    </View>
  );
}

function FriendCodeCard({
  stripeFrom,
  stripeTo,
  avatarFrom,
  avatarTo,
  avatarLabel,
  name,
  roleKicker,
  code,
  ratingStar,
  isLast,
  onCopy,
}: {
  stripeFrom: string;
  stripeTo: string;
  avatarFrom: string;
  avatarTo: string;
  avatarLabel: string;
  name: string;
  roleKicker: string;
  code: string;
  ratingStar?: boolean;
  isLast?: boolean;
  onCopy?: () => void;
}) {
  return (
    <View
      className="relative overflow-hidden rounded-2xl border p-4"
      style={[{ backgroundColor: C.bgCard, borderColor: C.borderDefault }, !isLast ? { marginBottom: 12 } : null]}
    >
      <View className="absolute bottom-0 left-0 top-0 w-[3px]" style={monogramGradient(stripeFrom, stripeTo)} />
      <View className="mb-2.5 flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-full" style={monogramGradient(avatarFrom, avatarTo)}>
          <Text className="font-display" style={{ fontSize: 13, color: '#fff' }}>
            {avatarLabel}
          </Text>
        </View>
        <View>
          <View className="flex-row items-center gap-1.5">
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.textPrimary }}>{name}</Text>
            {ratingStar ? <Star size={12} color={C.blue} fill={C.blue} /> : null}
          </View>
          <Text className="font-mono" style={{ fontSize: 10, color: C.textMuted, letterSpacing: 0.8 }}>
            {roleKicker}
          </Text>
        </View>
      </View>
      <View
        className="flex-row items-center gap-2 rounded-[10px] border px-3.5 py-3"
        style={{ backgroundColor: C.bgBase, borderColor: C.borderSubtle }}
      >
        <Text className="font-mono-bold flex-1" style={{ fontSize: 17, color: C.textPrimary, letterSpacing: 1.36 }}>
          {code}
        </Text>
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${name}'s friend code`}
          className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 active:opacity-70"
          style={{ backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)' }}
        >
          <Copy size={12} color={C.blue} strokeWidth={2.5} />
          <Text className="font-mono-bold" style={{ fontSize: 10, color: C.blue, letterSpacing: 0.8 }}>
            COPY
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function WarningCallout() {
  return (
    <View
      className="mb-5 flex-row gap-3 rounded-xl border p-4"
      style={{ backgroundColor: 'rgba(253,224,71,0.12)', borderColor: 'rgba(253,224,71,0.5)' }}
    >
      <AlertTriangle size={22} color={C.goldBright} strokeWidth={2.2} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text style={{ fontSize: 14, fontWeight: '700', color: C.goldBright, marginBottom: 4 }}>
          Location Data is hidden
        </Text>
        <Text style={{ fontSize: 13, color: C.goldPale, lineHeight: 19.5 }}>
          Coordinate your meet-up safely in the chat. Never share your home address.
        </Text>
      </View>
    </View>
  );
}
