import { Image } from 'expo-image';
import { RefreshCw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormalOfferCard } from '@/components/chats/FormalOfferCard';
import { SURFACE } from '@/constants/theme';
import type { ChatMessage } from '@/data/types';
import { getChatImageUrl } from '@/lib/api/chats';
import type { OfferAvailability } from '@/store/offer-state';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Re-sends a failed message under the same client id. */
  onRetry?: () => void;
  /** For an offer message: what may be done with it right now. Without it the card is display-only. */
  offerAvailability?: OfferAvailability;
  /** Opens the Trade Summary for this offer message. */
  onReviewOffer?: () => void;
}

export function MessageBubble({ message, onRetry, offerAvailability, onReviewOffer }: MessageBubbleProps) {
  // Lock / unlock / confirm / completed / closed: a centered line, not a bubble from either trainer.
  if (message.role === 'system') {
    return (
      <View className="items-center px-6 py-1">
        <Text className="text-center font-mono" style={{ fontSize: 10, lineHeight: 15, letterSpacing: 0.3, color: '#7d87a0' }}>
          {message.text}
        </Text>
      </View>
    );
  }

  const mine = message.role === 'me';

  const meta = (
    <View className="flex-row items-center gap-1.5" style={{ marginTop: 3, paddingHorizontal: 4 }}>
      <Text className="font-mono" style={{ fontSize: 9, color: '#4a5169' }}>
        {message.time}
      </Text>
      {message.delivery === 'pending' ? (
        <Text className="font-mono" style={{ fontSize: 9, color: '#7d87a0' }}>
          Sending…
        </Text>
      ) : null}
      {message.delivery === 'failed' ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry sending this message" hitSlop={8}>
          <Text className="font-mono" style={{ fontSize: 9, color: '#ff5c8a' }}>
            Not sent · Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  const dim = message.delivery === 'pending' ? 0.6 : 1;

  if (message.offer) {
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', opacity: dim }}>
        <FormalOfferCard offer={message.offer} availability={offerAvailability} onPress={onReviewOffer} />
        {meta}
      </View>
    );
  }

  if (message.kind === 'image' || Boolean(message.imagePath || message.imageUri)) {
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', opacity: dim }}>
        <ImageBubbleContent message={message} mine={mine} />
        {meta}
      </View>
    );
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', opacity: dim }}>
      <View
        className="border px-3.5 py-2.5"
        style={[
          { maxWidth: '78%', borderRadius: 16 },
          mine
            ? { ...SURFACE.bubbleMe, borderColor: 'transparent', borderBottomRightRadius: 4 }
            : { backgroundColor: '#0f1524', borderColor: '#1a2032', borderBottomLeftRadius: 4 },
          message.delivery === 'failed' ? { borderColor: 'rgba(255,92,138,.6)' } : null,
        ]}
      >
        <Text style={{ fontSize: 13, lineHeight: 18, color: mine ? '#04121f' : '#e8ecf5', fontWeight: mine ? '600' : '400' }}>
          {message.text}
        </Text>
      </View>
      {meta}
    </View>
  );
}

function ImageBubbleContent({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const insets = useSafeAreaInsets();
  const [signedUri, setSignedUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(!message.imageUri && message.imagePath));
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const imagePath = message.imagePath;
  const resolvedUri = message.imageUri ?? signedUri;
  const caption = message.text.trim();

  useEffect(() => {
    if (message.imageUri || !imagePath) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    void getChatImageUrl(imagePath).then(
      (url) => {
        if (cancelled) return;
        setSignedUri(url);
        setLoadFailed(!url);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setSignedUri(null);
        setLoadFailed(true);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [message.imageUri, imagePath, reloadAttempt]);

  return (
    <>
      <View
        className="border"
        style={[
          { maxWidth: '78%', borderRadius: 16, padding: 6 },
          mine
            ? { ...SURFACE.bubbleMe, borderColor: 'transparent', borderBottomRightRadius: 4 }
            : { backgroundColor: '#0f1524', borderColor: '#1a2032', borderBottomLeftRadius: 4 },
          message.delivery === 'failed' ? { borderColor: 'rgba(255,92,138,.6)' } : null,
        ]}
      >
        {resolvedUri ? (
          <Pressable
            onPress={() => setLightboxOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={caption ? `View screenshot: ${caption}` : 'View screenshot'}
            className="active:opacity-90"
          >
            <Image
              source={{ uri: resolvedUri }}
              style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: '#0a0f1c' }}
              contentFit="cover"
              onError={() => {
                if (!message.imageUri) {
                  setSignedUri(null);
                  setLoadFailed(true);
                }
              }}
            />
          </Pressable>
        ) : loading ? (
          <View
            className="items-center justify-center rounded-[12px]"
            style={{ width: 220, height: 220, backgroundColor: '#0a0f1c' }}
          >
            <ActivityIndicator color="#4fb3ff" />
          </View>
        ) : (
          <Pressable
            onPress={() => setReloadAttempt((n) => n + 1)}
            disabled={!imagePath}
            accessibilityRole="button"
            accessibilityLabel="Retry loading photo"
            className="items-center justify-center gap-2 rounded-[12px] px-4 active:opacity-75"
            style={{ width: 220, height: 220, minHeight: 44, backgroundColor: '#0a0f1c' }}
          >
            <RefreshCw size={18} color="#7d87a0" />
            <Text className="text-center font-mono text-text-subtle" style={{ fontSize: 11, lineHeight: 16 }}>
              {loadFailed || imagePath ? 'Could not load photo · Tap to retry' : 'Photo unavailable'}
            </Text>
          </Pressable>
        )}

        {caption.length > 0 ? (
          <Text
            style={{
              fontSize: 13,
              lineHeight: 18,
              color: mine ? '#04121f' : '#e8ecf5',
              fontWeight: mine ? '600' : '400',
              paddingHorizontal: 8,
              paddingTop: 6,
              paddingBottom: 2,
            }}
          >
            {caption}
          </Text>
        ) : null}
      </View>

      <Modal
        visible={lightboxOpen && Boolean(resolvedUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxOpen(false)}
        statusBarTranslucent
      >
        <View
          className="flex-1"
          style={{
            backgroundColor: 'rgba(5, 8, 16, 0.96)',
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View className="w-full max-w-md mx-auto flex-1 px-4">
            <View className="flex-row justify-end pb-2">
              <Pressable
                onPress={() => setLightboxOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close full screen photo"
                className="items-center justify-center rounded-full border border-border-strong bg-bg-card active:opacity-75"
                style={{ width: 44, height: 44 }}
              >
                <X size={20} color="#e8ecf5" />
              </Pressable>
            </View>
            <View className="flex-1 items-center justify-center">
              {resolvedUri ? (
                <Image
                  source={{ uri: resolvedUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                  accessibilityLabel={caption || 'Chat screenshot'}
                />
              ) : null}
            </View>
            {caption.length > 0 ? (
              <Text className="pt-3 text-center text-text-primary" style={{ fontSize: 14, lineHeight: 20 }}>
                {caption}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
