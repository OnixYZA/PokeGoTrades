import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Dimensions, Modal, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface DropdownProps {
  visible: boolean;
  onRequestClose: () => void;
  anchorRef: RefObject<View | null>;
  children: ReactNode;
  /** 'stretch' matches the anchor's width (location filter); 'right' hugs the anchor's right edge
   *  at a fixed width (friendship menu). */
  align?: 'stretch' | 'right';
  minWidth?: number;
  gap?: number;
}

/** Absolutely-positioned menu rendered in a transparent Modal, measured off its anchor.
 *  Using a Modal (rather than a local absolute View) keeps the tap-outside backdrop reliable
 *  across the whole screen regardless of where the anchor sits in the tree, and sidesteps
 *  Android's zIndex/elevation stacking quirks for nested absolute views. */
export function Dropdown({ visible, onRequestClose, anchorRef, children, align = 'stretch', minWidth, gap = 6 }: DropdownProps) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Opacity defaults to opaque; the only writes to it are the two lines in the effect below,
  // which always run back-to-back in the same synchronous callback. There is no code path that
  // sets it to 0 without immediately queuing the return to 1 — see the comment on Animated.View.
  const opacity = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // measureInWindow's callback is async; this token guards against one landing after the menu
  // has since closed (or reopened at a new anchor position) from clobbering current state —
  // the same request-token idiom lib/use-feed.ts and app/(tabs)/profile.tsx use for their fetches.
  const measureToken = useRef(0);

  // Measuring (and the state update it schedules) is a side effect and must run from an effect,
  // not from the render body: React 19 can invoke a render function more than once per commit
  // (StrictMode, an interrupted concurrent render), and calling it inline here fired a redundant
  // native `measureInWindow` round-trip on every such extra pass while `rect` was still null.
  useEffect(() => {
    if (!visible) {
      measureToken.current++;
      setRect(null);
      return;
    }
    const token = ++measureToken.current;
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (token !== measureToken.current) return;
      setRect({ x, y, width, height });
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: 180 });
    });
  }, [visible, anchorRef, opacity]);

  // The anchor can move under an already-open menu on web (browser resize) or native (rotation);
  // reposition without re-triggering the fade above.
  useEffect(() => {
    if (!visible) return;
    const sub = Dimensions.addEventListener('change', () => {
      const token = measureToken.current;
      anchorRef.current?.measureInWindow((x, y, width, height) => {
        if (token !== measureToken.current) return;
        setRect({ x, y, width, height });
      });
    });
    return () => sub.remove();
  }, [visible, anchorRef]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onRequestClose} statusBarTranslucent>
      <Pressable
        accessibilityLabel="Close menu"
        style={{ flex: 1 }}
        onPress={() => {
          setRect(null);
          onRequestClose();
        }}
      >
        {rect ? (
          // Deliberately not using Reanimated's `entering` prop here: on web it renders the view
          // at `visibility: hidden` until a real browser `animationstart` DOM event fires (see
          // node_modules/react-native-reanimated's AnimatedComponent.tsx — the library's own
          // comment there acknowledges this is a best-effort timing assumption, not a guarantee).
          // Inside a portal-rendered Modal, that event can be missed, which leaves the panel
          // permanently invisible-but-present — an opaque menu that reads as "transparent over
          // the feed." `fadeStyle` is a plain animated style driven by `withTiming`, so it has no
          // such gate: opaque is the default, the fade is enhancement on top of it.
          <Animated.View
            className="absolute overflow-hidden rounded-xl border border-border-strong bg-bg-card"
            style={[
              fadeStyle,
              {
                top: rect.y + rect.height + gap,
                left: align === 'stretch' ? rect.x : rect.x + rect.width - (minWidth ?? rect.width),
                width: align === 'stretch' ? rect.width : undefined,
                minWidth,
                boxShadow: '0 12px 40px rgba(0,0,0,.6)',
              },
            ]}
          >
            <Pressable onPress={() => {}}>{children}</Pressable>
          </Animated.View>
        ) : null}
      </Pressable>
    </Modal>
  );
}
