import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { MODAL_COLORS, MODAL_SURFACE } from '@/components/modals/tokens';
import { IconButton } from '@/components/ui/IconButton';
import { ToastHost } from '@/components/ui/ToastHost';
import {
  FRIENDSHIP_TIERS,
  TRADE_GUIDE_STEP_IDS,
  stardustTable,
  tradeGuideSteps,
  type TradeGuideStepId,
} from '@/lib/trade-guide';

const C = MODAL_COLORS;

interface TradeGuideModalProps {
  visible: boolean;
  /** The step to open on each time the guide becomes visible. Defaults to the first. */
  initialStep?: TradeGuideStepId;
  onClose: () => void;
}

/**
 * The "How PokeGoTrades works" bottom sheet. All copy and every number comes from `lib/trade-guide.ts`
 * (pure, drift-tested); this file only lays it out. Reachable from the profile, onboarding and the Bail &
 * Block sheet's reputation row.
 */
export function TradeGuideModal({ visible, initialStep, onClose }: TradeGuideModalProps) {
  const insets = useSafeAreaInsets();
  const steps = useMemo(() => tradeGuideSteps(), []);
  const table = useMemo(() => stardustTable(), []);
  const [stepId, setStepId] = useState<TradeGuideStepId>(initialStep ?? TRADE_GUIDE_STEP_IDS[0]);

  useEffect(() => {
    if (visible) setStepId(initialStep ?? TRADE_GUIDE_STEP_IDS[0]);
  }, [visible, initialStep]);

  const index = Math.max(0, TRADE_GUIDE_STEP_IDS.indexOf(stepId));
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === TRADE_GUIDE_STEP_IDS.length - 1;

  const go = (i: number) => setStepId(TRADE_GUIDE_STEP_IDS[i]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close guide"
        style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.72)' }}
        onPress={onClose}
      >
        <View className="flex-1 items-center justify-end">
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, maxHeight: '90%' }}>
            <View
              style={{
                backgroundColor: C.bgSurface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderWidth: 1,
                borderColor: C.borderDefault,
                borderBottomWidth: 0,
                overflow: 'hidden',
              }}
            >
              <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
                <Text className="font-display" style={{ fontSize: 17, color: C.textPrimary }}>
                  How PokeGoTrades works
                </Text>
                <IconButton size={34} radius={17} accessibilityLabel="Close guide" onPress={onClose}>
                  <X size={16} color="#a1a1aa" />
                </IconButton>
              </View>

              <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2 px-5 pb-2">
                {steps.map((s, i) => {
                  const selected = s.id === stepId;
                  return (
                    <Pressable
                      key={s.id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      accessibilityLabel={s.shortTitle}
                      onPress={() => go(i)}
                      className="items-center justify-center rounded-full px-3 active:opacity-70"
                      style={{
                        minHeight: 44,
                        backgroundColor: selected ? 'rgba(251,191,36,0.14)' : C.bgCard,
                        borderWidth: 1,
                        borderColor: selected ? C.gold : C.borderDefault,
                      }}
                    >
                      <Text className="font-display-med" style={{ fontSize: 12, color: selected ? C.gold : C.textSecondary }}>
                        {s.shortTitle}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="px-5 pb-2 font-mono-semi" style={{ fontSize: 11, letterSpacing: 0.6, color: C.textMuted }}>
                {`Step ${index + 1} of ${TRADE_GUIDE_STEP_IDS.length}`}
              </Text>

              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}
              >
                <Text className="font-display" style={{ fontSize: 16, color: C.textPrimary }}>
                  {step.title}
                </Text>
                <Text className="mt-1.5 font-display-med" style={{ fontSize: 13, lineHeight: 19, color: C.textSecondary }}>
                  {step.intro}
                </Text>

                {step.sections.map((section) => (
                  <View key={section.heading} className="mt-4">
                    <Text accessibilityRole="header" className="font-display" style={{ fontSize: 13, color: C.gold }}>
                      {section.heading}
                    </Text>
                    {section.points.map((point) => (
                      <View key={point} className="mt-1.5 flex-row gap-2">
                        <Text style={{ fontSize: 13, lineHeight: 19, color: C.textMuted }}>{'•'}</Text>
                        <Text className="flex-1 font-display-med" style={{ fontSize: 13, lineHeight: 19, color: C.textPrimary }}>
                          {point}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}

                {step.id === 'stardust' ? (
                  <View className="mt-4" style={{ borderWidth: 1, borderColor: C.borderDefault, borderRadius: 14, overflow: 'hidden' }}>
                    <View className="flex-row items-center px-2.5 py-2" style={{ backgroundColor: C.bgCardAlt }}>
                      <View style={{ flex: 2 }} />
                      {FRIENDSHIP_TIERS.map((tier) => (
                        <Text key={tier} className="font-mono-semi text-center" style={{ flex: 1, fontSize: 10, color: C.textMuted }}>
                          {tier}
                        </Text>
                      ))}
                    </View>
                    {table.map((row) => (
                      <View
                        key={row.tradeType}
                        accessible
                        accessibilityLabel={`${row.label}: ${row.costs.map((c) => `${c.tier} ${c.text}`).join(', ')}`}
                        className="flex-row items-center px-2.5 py-2.5"
                        style={{
                          backgroundColor: row.highlight ? 'rgba(251,191,36,0.10)' : C.bgCard,
                          borderTopWidth: 1,
                          borderTopColor: C.borderSubtle,
                        }}
                      >
                        <Text
                          className="font-display-med"
                          style={{ flex: 2, fontSize: 11, lineHeight: 15, paddingRight: 6, color: row.highlight ? C.goldBright : C.textSecondary }}
                        >
                          {row.label}
                        </Text>
                        {row.costs.map((c) => (
                          <Text
                            key={c.tier}
                            className="font-mono-semi text-center"
                            style={{ flex: 1, fontSize: 11, color: row.highlight ? C.gold : C.textPrimary }}
                          >
                            {c.text}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>

              <View className="flex-row gap-3 px-5 pt-2" style={{ paddingBottom: insets.bottom + 16 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  accessibilityState={{ disabled: isFirst }}
                  disabled={isFirst}
                  onPress={() => go(index - 1)}
                  className="flex-1 items-center justify-center rounded-2xl active:opacity-80"
                  style={{
                    minHeight: 48,
                    backgroundColor: C.bgCard,
                    borderWidth: 1,
                    borderColor: C.borderDefault,
                    opacity: isFirst ? 0.4 : 1,
                  }}
                >
                  <Text className="font-display" style={{ fontSize: 14, color: C.textPrimary }}>
                    Back
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isLast ? 'Done' : 'Next'}
                  onPress={() => (isLast ? onClose() : go(index + 1))}
                  className="flex-1 items-center justify-center rounded-2xl active:opacity-80"
                  style={[{ minHeight: 48 }, MODAL_SURFACE.ctaGold]}
                >
                  <Text className="font-display" style={{ fontSize: 14, color: '#1a1200' }}>
                    {isLast ? 'Done' : 'Next'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
      <ToastHost />
    </Modal>
  );
}
