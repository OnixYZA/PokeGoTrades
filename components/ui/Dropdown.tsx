import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

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

  const measure = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setRect({ x, y, width, height });
    });
  };

  if (visible && !rect) measure();

  useEffect(() => {
    if (!visible) setRect(null);
  }, [visible]);

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
          <Animated.View
            entering={FadeIn.duration(180)}
            className="absolute overflow-hidden rounded-xl border border-border-strong bg-bg-card"
            style={{
              top: rect.y + rect.height + gap,
              left: align === 'stretch' ? rect.x : rect.x + rect.width - (minWidth ?? rect.width),
              width: align === 'stretch' ? rect.width : undefined,
              minWidth,
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            <Pressable onPress={() => {}}>{children}</Pressable>
          </Animated.View>
        ) : null}
      </Pressable>
    </Modal>
  );
}
