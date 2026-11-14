import { Image } from 'expo-image';
import { ArrowLeftRight, Camera, RefreshCw, Send } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import { formatBytes, pickProofImage, ProofImageError, type PickedProof } from '@/lib/proof-image';

interface ChatAttachmentSheetProps {
  onOpenArsenal: () => void;
  onSendImage: (image: PickedProof, caption?: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** Bottom sheet for the Composer's "+" button: attach a proof/screenshot image or send a formal Arsenal offer. */
export function ChatAttachmentSheet({ onOpenArsenal, onSendImage, onCancel, disabled }: ChatAttachmentSheetProps) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<PickedProof | null>(null);
  const [caption, setCaption] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const choosePhoto = async () => {
    if (picking || disabled) return;
    setPickError(null);
    setPicking(true);
    try {
      const image = await pickProofImage();
      if (image) setPicked(image);
    } catch (reason) {
      setPickError(reason instanceof ProofImageError ? reason.message : 'Could not open your photos.');
    } finally {
      setPicking(false);
    }
  };

  const handleSend = () => {
    if (!picked || disabled) return;
    const trimmed = caption.trim();
    onSendImage(picked, trimmed.length > 0 ? trimmed : undefined);
    setPicked(null);
    setCaption('');
    setPickError(null);
  };

  return (
    <Pressable
      onPress={onCancel}
      accessibilityRole="button"
      accessibilityLabel="Close attachment sheet"
      className="flex-1 justify-end"
      style={{ backgroundImage: 'linear-gradient(180deg, rgba(5,8,16,0.4), rgba(5,8,16,0.92) 30%, rgba(5,8,16,0.98))' }}
    >
      <View className="flex-1 justify-end items-center">
        <Pressable onPress={() => {}} className="w-full max-w-md mx-auto">
          <View
            className="border-t border-border-strong px-5 pt-3"
            style={{
              backgroundColor: '#0a0f1c',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: insets.bottom + 24,
              maxHeight: '85%',
            }}
          >
            <View className="mb-4 items-center">
              <View className="h-1 w-10 rounded-full bg-border-strong" />
            </View>

            {picked ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <Text className="font-display text-center text-text-primary" style={{ fontSize: 20, letterSpacing: -0.4 }}>
                  Send Screenshot
                </Text>

                <View
                  className="items-center justify-center overflow-hidden rounded-2xl border border-border bg-bg-card"
                  style={{ height: 220 }}
                >
                  <Image
                    source={{ uri: picked.uri }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                    accessibilityLabel="Selected screenshot preview"
                  />
                </View>

                <View className="flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
                      {picked.filename}
                    </Text>
                    <Text className="font-mono text-text-subtle" style={{ fontSize: 11, marginTop: 2 }}>
                      {picked.sizeBytes !== null ? formatBytes(picked.sizeBytes) : 'Ready to upload'}
                    </Text>
                  </View>

                  <Pressable
                    onPress={choosePhoto}
                    disabled={picking || disabled}
                    accessibilityRole="button"
                    accessibilityLabel="Change photo"
                    className={`flex-row items-center gap-1.5 rounded-xl border border-border bg-bg-card px-3 ${
                      picking || disabled ? 'opacity-50' : 'active:opacity-75'
                    }`}
                    style={{ minHeight: 44 }}
                  >
                    {picking ? (
                      <ActivityIndicator size="small" color="#4fb3ff" />
                    ) : (
                      <RefreshCw size={14} color="#4fb3ff" />
                    )}
                    <Text className="font-display-semi text-accent-blue" style={{ fontSize: 12 }}>
                      Change photo
                    </Text>
                  </Pressable>
                </View>

                <TextInput
                  value={caption}
                  onChangeText={setCaption}
                  editable={!disabled}
                  placeholder="Add a caption (optional)…"
                  placeholderTextColor="#6d7690"
                  maxLength={280}
                  style={{ fontSize: 13, color: '#e8ecf5' }}
                  className="rounded-[16px] border border-border bg-bg-card px-4 py-3"
                  accessibilityLabel="Screenshot caption"
                />

                {pickError ? (
                  <Text accessibilityRole="alert" className="font-display-med text-accent-danger" style={{ fontSize: 13 }}>
                    {pickError}
                  </Text>
                ) : null}

                <PrimaryButton
                  label="Send Screenshot"
                  icon={<Send size={15} color="#04121f" />}
                  style={{ ...SURFACE.ctaBlue, minHeight: 48 }}
                  textColor="#04121f"
                  disabled={disabled || picking}
                  onPress={handleSend}
                />

                <Pressable
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  className="items-center justify-center active:opacity-70"
                  style={{ minHeight: 44 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#8b93a7' }}>Cancel</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <View className="gap-3">
                <Text className="font-display mb-1 text-center text-text-primary" style={{ fontSize: 20, letterSpacing: -0.4 }}>
                  Add to Chat
                </Text>

                <Pressable
                  onPress={choosePhoto}
                  disabled={picking || disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Upload Proof or Screenshot"
                  className={`flex-row items-center gap-3 rounded-2xl border border-border bg-bg-card p-3.5 ${
                    picking || disabled ? 'opacity-50' : 'active:opacity-80'
                  }`}
                  style={{ minHeight: 56 }}
                >
                  <View
                    className="items-center justify-center rounded-xl border border-border bg-bg-cardAlt"
                    style={{ width: 42, height: 42 }}
                  >
                    {picking ? (
                      <ActivityIndicator size="small" color="#4fb3ff" />
                    ) : (
                      <Camera size={20} color="#4fb3ff" />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
                      Upload Proof / Screenshot
                    </Text>
                    <Text className="text-text-subtle" style={{ fontSize: 12, lineHeight: 17, marginTop: 1 }}>
                      Share appraisal, moveset, or storage box photo · max 5 MB
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={onOpenArsenal}
                  disabled={picking || disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Send a Formal Offer"
                  className={`flex-row items-center gap-3 rounded-2xl border border-border bg-bg-card p-3.5 ${
                    picking || disabled ? 'opacity-50' : 'active:opacity-80'
                  }`}
                  style={{ minHeight: 56 }}
                >
                  <View
                    className="items-center justify-center rounded-xl border border-border bg-bg-cardAlt"
                    style={{ width: 42, height: 42 }}
                  >
                    <ArrowLeftRight size={20} color="#f5c518" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
                      Send a Formal Offer
                    </Text>
                    <Text className="text-text-subtle" style={{ fontSize: 12, lineHeight: 17, marginTop: 1 }}>
                      Pick a Pokémon from your Arsenal to propose a trade
                    </Text>
                  </View>
                </Pressable>

                {pickError ? (
                  <Text accessibilityRole="alert" className="font-display-med text-accent-danger pt-1" style={{ fontSize: 13 }}>
                    {pickError}
                  </Text>
                ) : null}

                <Pressable
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  className="items-center justify-center active:opacity-70"
                  style={{ minHeight: 44 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#8b93a7' }}>Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
}
