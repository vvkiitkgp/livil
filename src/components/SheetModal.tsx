import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
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
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';

/**
 * A bottom sheet in its own Modal with two resting heights: HALF (where it opens) and
 * EXPANDED. Up from half — dragging the grabber/header, or trying to scroll the list —
 * expands it; the list scrolls only once it is expanded. Down from expanded returns to half
 * (from the grabber, or from the list once it is at the top); down from half closes it.
 * Put the list in `SheetFlatList` so it can hand those drags to the sheet.
 *
 * The sheet is always laid out at its EXPANDED height and slides: `offsetY` is how far it
 * sits below fully expanded. Sliding is a transform, so a drag never re-lays-out the list,
 * and at half the list cannot scroll — so nothing ever sits in the off-screen part that the
 * reader would need to reach.
 *
 * keyboardAware sheets (comments) sit on the keyboard and fill the space above it while it
 * is up, whatever the resting height, then return to it. A drag that moves the sheet closes
 * the keyboard first.
 *
 * Everything that tracks the keyboard or the finger lives in SheetBody, which the Modal
 * mounts only while it is open — the keyboard hook switches the Android resize mode while
 * mounted, and a fresh body means every open starts at half.
 */

/** Share of the window the sheet shows at HALF. */
const HALF_SHARE = 0.5;
/** Share of the window at EXPANDED (capped below the status bar). */
const EXPANDED_SHARE = 0.9;
/** Below the status bar, so the sheet's top never runs under it. */
const TOP_GAP = 8;
/** From half: moved up this far (px) and released, it expands. */
const EXPAND_DISTANCE = 24;
/** From expanded: moved down this far (px) and released, it returns to half. */
const COLLAPSE_DISTANCE = 80;
/** From half: released past this share of the half height, it closes. */
const CLOSE_SHARE = 0.25;
/** A flick at least this fast (px/s) moves one step in its direction. */
const FLICK_VELOCITY = 600;
/** A flick down from half at least this fast closes. */
const CLOSE_VELOCITY = 900;
/**
 * Snap between half and expanded: quick, and never past its resting height. Stiff and
 * critically damped (damping = 2·√stiffness) so it lands fast without wobbling, carrying the
 * finger's release velocity; overshootClamping stops it AT the target even when a hard flick
 * would otherwise carry it past. (24/260 bounced visibly at both ends.)
 */
const SNAP_SPRING = { damping: 45, stiffness: 500, overshootClamping: true };

type ListDrag = {
  gesture: ComposedGesture;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /** Only once expanded (or while typing). At half, an upward swipe expands the sheet instead. */
  scrollEnabled: boolean;
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
  /** Sit on the keyboard when an input in the sheet opens it. */
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

function dismissKeyboard() {
  KeyboardController.dismiss().catch(() => {});
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

  const maxTop = insets.top + TOP_GAP;
  const halfHeight = windowHeight * HALF_SHARE;
  const expandedHeight = Math.min(windowHeight * EXPANDED_SHARE, windowHeight - maxTop);
  const halfOffset = expandedHeight - halfHeight;
  const closedOffset = expandedHeight;

  /** How far the sheet sits below EXPANDED: 0 = expanded, halfOffset = half. */
  const offsetY = useSharedValue(halfOffset);
  const dragStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  /** Set by a list drag at the start: 1 = the sheet was expanded, so the list owns the drag. */
  const listOwnsDrag = useSharedValue(0);
  // The list drag's translation when it began moving the sheet down from the top; -1 before.
  const listDragOrigin = useSharedValue(-1);

  const [expanded, setExpanded] = useState(false);
  const [typing, setTyping] = useState(false);

  useAnimatedReaction(
    () => keyboardAware && keyboard.progress.value > 0.5,
    (open, wasOpen) => {
      if (open !== wasOpen) { runOnJS(setTyping)(open); }
    },
  );

  const gestures = useMemo(() => {
    const typingProgress = () => {
      'worklet';
      return keyboardAware ? keyboard.progress.value : 0;
    };

    const snapTo = (target: number, velocity: number) => {
      'worklet';
      if (target >= closedOffset) {
        offsetY.value = withTiming(closedOffset, { duration: 200 }, finished => {
          if (finished) { runOnJS(onClose)(); }
        });
        return;
      }
      offsetY.value = withSpring(target, { ...SNAP_SPRING, velocity });
      runOnJS(setExpanded)(target === 0);
    };

    // Where to rest after a drag that started at `start`, judged by intent: how far and
    // which way it moved, and how fast it was going when released.
    const settle = (start: number, velocityY: number) => {
      'worklet';
      const moved = offsetY.value - start; // + down, − up
      if (start < halfOffset / 2) {
        // Started expanded.
        if (offsetY.value > halfOffset + halfHeight * CLOSE_SHARE) { snapTo(closedOffset, velocityY); return; }
        snapTo(moved > COLLAPSE_DISTANCE || velocityY > FLICK_VELOCITY ? halfOffset : 0, velocityY);
        return;
      }
      // Started at half.
      if (moved > halfHeight * CLOSE_SHARE || velocityY > CLOSE_VELOCITY) { snapTo(closedOffset, velocityY); return; }
      snapTo(moved < -EXPAND_DISTANCE || velocityY < -FLICK_VELOCITY ? 0 : halfOffset, velocityY);
    };

    const handle = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .onStart(() => {
        dragStart.value = offsetY.value;
        if (typingProgress() > 0) { runOnJS(dismissKeyboard)(); }
      })
      .onUpdate(e => {
        offsetY.value = Math.max(0, dragStart.value + e.translationY);
      })
      .onEnd(e => settle(dragStart.value, e.velocityY));

    const listPan = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .failOffsetX([-20, 20])
      .onStart(() => {
        dragStart.value = offsetY.value;
        // What the reader SEES: while typing, the sheet shows expanded whatever its offset.
        listOwnsDrag.value = offsetY.value * (1 - typingProgress()) <= 0.5 ? 1 : 0;
      })
      .onUpdate(e => {
        if (listOwnsDrag.value === 0) {
          // At half the list is locked: the sheet follows the finger, up or down.
          offsetY.value = Math.max(0, dragStart.value + e.translationY);
          return;
        }
        // Expanded: the list scrolls. The sheet moves only for a drag DOWN from the top —
        // picking up mid-gesture once a scroll back to the top arrives there.
        if (listDragOrigin.value < 0) {
          if (scrollY.value > 0.5 || e.velocityY <= 0) { return; }
          listDragOrigin.value = e.translationY;
          if (typingProgress() > 0) { runOnJS(dismissKeyboard)(); }
        }
        offsetY.value = Math.max(0, e.translationY - listDragOrigin.value);
      })
      .onEnd(e => {
        if (listOwnsDrag.value === 1) {
          if (listDragOrigin.value < 0) { return; } // a plain scroll — the sheet never moved
          settle(0, e.velocityY);
          return;
        }
        settle(dragStart.value, e.velocityY);
      })
      .onFinalize(() => {
        listDragOrigin.value = -1;
      });

    return {
      handle,
      list: Gesture.Simultaneous(listPan, Gesture.Native()),
    };
  }, [
    keyboardAware,
    keyboard,
    offsetY,
    dragStart,
    scrollY,
    listOwnsDrag,
    listDragOrigin,
    halfOffset,
    halfHeight,
    closedOffset,
    onClose,
  ]);

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const listDrag = useMemo<ListDrag>(
    () => ({ gesture: gestures.list, onScroll, scrollEnabled: expanded || typing }),
    [gestures.list, onScroll, expanded, typing],
  );

  const sheetStyle = useAnimatedStyle(() => {
    const keyboardHeight = keyboardAware ? Math.abs(keyboard.height.value) : 0;
    const progress = keyboardAware ? keyboard.progress.value : 0;
    return {
      // Constant with the keyboard down, so sliding never re-lays-out the list.
      height: Math.min(expandedHeight, windowHeight - keyboardHeight - maxTop),
      transform: [{ translateY: offsetY.value * (1 - progress) - keyboardHeight }],
    };
  });

  // Full between expanded and half; fades below half, so a drag-close leaves nothing for the
  // Modal's own slide-out to show.
  const backdropStyle = useAnimatedStyle(() => {
    const progress = keyboardAware ? keyboard.progress.value : 0;
    const belowHalf = offsetY.value * (1 - progress) - halfOffset;
    return { opacity: 1 - Math.min(1, Math.max(0, belowHalf / halfHeight)) };
  });

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
 * The list for a SheetModal. Scrolls only once the sheet is expanded, and hands the drags
 * that move the sheet to it. No bounce or overscroll stretch at the top: the sheet moving
 * IS the overscroll.
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
      scrollEnabled={drag ? drag.scrollEnabled : props.scrollEnabled}
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
