import React, { createContext, useContext, useMemo, type ReactNode, type Ref } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type FlatList,
  type FlatListProps,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type ComposedGesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';

/**
 * A bottom sheet in its own Modal: opens at half the screen and closes on a drag down —
 * from the grabber/header, or from its list once the list is scrolled to the top.
 *
 * The grabber used to be drawn with nothing behind it: these sheets had no gesture at all
 * and closed only on the backdrop or ✕. Put the list in `SheetFlatList` so it can hand a
 * downward drag to the sheet.
 *
 * Everything that tracks the keyboard or the finger lives in SheetBody, which the Modal
 * mounts only while it is open — the keyboard hook switches the Android resize mode while
 * mounted, and a fresh body means every open starts from rest.
 */

/** Share of the window the sheet fills while the keyboard is down. */
const RESTING_SHARE = 0.5;
/** With the keyboard up (keyboardAware sheets), share of the space above it. */
const TYPING_SHARE = 0.9;
/** Released past this share of the resting height, the sheet closes. */
const CLOSE_SHARE = 0.25;
/** …or flicked down at least this fast (px/s). */
const CLOSE_VELOCITY = 900;
/** Below the status bar, so a tall typing sheet never runs under it. */
const TOP_GAP = 8;

type ListDrag = {
  gesture: ComposedGesture;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
};

const ListDragContext = createContext<ListDrag | null>(null);

type SheetModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Title row under the grabber. Part of the drag area. */
  header: ReactNode;
  /** The sheet's body — usually a SheetFlatList. */
  children: ReactNode;
  /** Other modals launched from inside the sheet. They must live in this Modal's tree. */
  outside?: ReactNode;
  /** Grow above the keyboard when an input in the sheet opens it. */
  keyboardAware?: boolean;
};

export default function SheetModal({ visible, onClose, ...body }: SheetModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SheetBody onClose={onClose} {...body} />
    </Modal>
  );
}

function SheetBody({
  onClose,
  header,
  children,
  outside,
  keyboardAware = false,
}: Omit<SheetModalProps, 'visible'>) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();

  const dragY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  // The list drag's translation at the moment the list reached its top; -1 while it has not.
  const listDragOrigin = useSharedValue(-1);

  const restingHeight = windowHeight * RESTING_SHARE;
  const maxTop = insets.top + TOP_GAP;

  const gestures = useMemo(() => {
    const settle = (velocityY: number) => {
      'worklet';
      if (dragY.value <= 0) { return; }
      if (dragY.value > restingHeight * CLOSE_SHARE || velocityY > CLOSE_VELOCITY) {
        dragY.value = withTiming(windowHeight, { duration: 200 }, finished => {
          if (finished) { runOnJS(onClose)(); }
        });
      } else {
        dragY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    };

    // Downward only: an upward drag on the header means nothing, and on the list it scrolls.
    const handle = Gesture.Pan()
      .activeOffsetY(8)
      .onUpdate(e => {
        dragY.value = Math.max(0, e.translationY);
      })
      .onEnd(e => settle(e.velocityY));

    const listPan = Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-20, 20])
      .onUpdate(e => {
        // Still scrolling back to the top: the list has this drag, the sheet stays put.
        if (scrollY.value > 0.5 && listDragOrigin.value < 0) { return; }
        if (listDragOrigin.value < 0) { listDragOrigin.value = e.translationY; }
        dragY.value = Math.max(0, e.translationY - listDragOrigin.value);
      })
      .onEnd(e => settle(e.velocityY))
      .onFinalize(() => {
        listDragOrigin.value = -1;
      });

    return {
      handle,
      list: Gesture.Simultaneous(listPan, Gesture.Native()),
    };
  }, [dragY, scrollY, listDragOrigin, restingHeight, windowHeight, onClose]);

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const listDrag = useMemo<ListDrag>(
    () => ({ gesture: gestures.list, onScroll }),
    [gestures.list, onScroll],
  );

  const sheetStyle = useAnimatedStyle(() => {
    const keyboardHeight = keyboardAware ? Math.abs(keyboard.height.value) : 0;
    const progress = keyboardAware ? keyboard.progress.value : 0;
    const above = windowHeight - keyboardHeight;
    const typingHeight = Math.min(above * TYPING_SHARE, above - maxTop);
    return {
      height: restingHeight + (typingHeight - restingHeight) * progress,
      transform: [{ translateY: dragY.value - keyboardHeight }],
    };
  });

  // Fades with the drag, so a drag-close leaves nothing for the Modal's own slide-out to show.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, dragY.value / restingHeight),
  }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
      </Animated.View>

      <Animated.View style={[styles.sheet, sheetStyle]}>
        <GestureDetector gesture={gestures.handle}>
          <View collapsable={false}>
            <View style={styles.grabber} />
            {header}
          </View>
        </GestureDetector>
        <ListDragContext.Provider value={listDrag}>{children}</ListDragContext.Provider>
      </Animated.View>

      {outside}
    </GestureHandlerRootView>
  );
}

/**
 * The list for a SheetModal. Hands a downward drag to the sheet once it is scrolled to the
 * top. No bounce or overscroll stretch at the top: the sheet moving IS the overscroll.
 */
export function SheetFlatList<T>({
  ref,
  ...props
}: Omit<FlatListProps<T>, 'CellRendererComponent'> & { ref?: Ref<FlatList<T>> }) {
  const drag = useContext(ListDragContext);
  const list = (
    <Animated.FlatList
      ref={ref}
      {...props}
      onScroll={drag?.onScroll}
      scrollEventThrottle={16}
      bounces={false}
      overScrollMode="never"
    />
  );
  return drag ? <GestureDetector gesture={drag.gesture}>{list}</GestureDetector> : list;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginTop: 8,
    marginBottom: 8,
  },
});
