import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
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
  type ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
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
 * A bottom sheet with two resting heights: HALF (where it opens) and EXPANDED. Up from half
 * — dragging the grabber/header, or trying to scroll the list — expands it; the list scrolls
 * only once it is expanded. Down from expanded returns to half (from the grabber, or from the
 * list once it is at the top); down from half closes it. Put the scrolling body in
 * `SheetFlatList` / `SheetScrollView` (or read `useSheetList()`) so it can hand those drags
 * to the sheet.
 *
 * Two ways to show one:
 *   - `SheetModal` — in its own Modal, with a backdrop (likes, comments, share, playlists).
 *   - `SheetSurface` — inline, positioned over whatever it is rendered in (the full-screen
 *     player's Queue/Info panel, which must stay under the floating player). Close it from
 *     outside through its ref, so it animates away before it unmounts.
 *
 * The sheet is always laid out at its EXPANDED height and slides: `offsetY` is how far it
 * sits below fully expanded. Sliding is a transform, so a drag never re-lays-out the list,
 * and at half the list cannot scroll — so nothing ever sits in the off-screen part that the
 * reader would need to reach.
 *
 * keyboardAware sheets (comments) sit on the keyboard and fill the space above it while it
 * is up, whatever the resting height, then return to it. A drag that moves the sheet closes
 * the keyboard first.
 */

/** Default share of the window the sheet shows at HALF. */
const HALF_SHARE = 0.5;
/** Default share of the window at EXPANDED (capped below the status bar). */
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
const CLOSE_DURATION = 200;

export type SheetHandle = {
  /** Animate closed, then call onClose. */
  close: () => void;
};

export type SheetList = {
  gesture: ComposedGesture;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /** Only once expanded (or while typing). At half, an upward swipe expands the sheet instead. */
  scrollEnabled: boolean;
  /** While true the sheet ignores drags on its list — e.g. a queue row being reordered. */
  setLocked: (locked: boolean) => void;
};

const SheetListContext = createContext<SheetList | null>(null);

/** The sheet this list sits in, or null outside one — a list used elsewhere is unchanged. */
export function useSheetList(): SheetList | null {
  return useContext(SheetListContext);
}

type SheetSurfaceProps = {
  onClose: () => void;
  /** Title row under the grabber. Part of the drag area. */
  header: ReactNode;
  /** The sheet's body — usually a SheetFlatList or SheetScrollView. */
  children: ReactNode;
  /** Sit on the keyboard when an input in the sheet opens it. */
  keyboardAware?: boolean;
  /** Share of the window shown at HALF. */
  halfShare?: number;
  /** EXPANDED height in px; defaults to 90% of the window, below the status bar. */
  expandedHeight?: number;
  /** Dim what is behind the sheet; a tap on it closes. */
  backdrop?: boolean;
  /** Slide up from closed on mount. A Modal does its own slide, so only inline sheets want it. */
  enterFromClosed?: boolean;
  /** The sheet's own surface — background, corners. */
  style?: StyleProp<ViewStyle>;
  ref?: Ref<SheetHandle>;
};

function dismissKeyboard() {
  KeyboardController.dismiss().catch(() => {});
}

export function SheetSurface({
  onClose,
  header,
  children,
  keyboardAware = false,
  halfShare = HALF_SHARE,
  expandedHeight: expandedProp,
  backdrop = true,
  enterFromClosed = false,
  style,
  ref,
}: SheetSurfaceProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();

  const maxTop = insets.top + TOP_GAP;
  const expandedHeight =
    expandedProp ?? Math.min(windowHeight * EXPANDED_SHARE, windowHeight - maxTop);
  const halfHeight = Math.min(windowHeight * halfShare, expandedHeight);
  const halfOffset = expandedHeight - halfHeight;
  const closedOffset = expandedHeight;

  /** How far the sheet sits below EXPANDED: 0 = expanded, halfOffset = half. */
  const offsetY = useSharedValue(enterFromClosed ? closedOffset : halfOffset);
  const dragStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  /** Set by a list drag at the start: 1 = the sheet was expanded, so the list owns the drag. */
  const listOwnsDrag = useSharedValue(0);
  // The list drag's translation when it began moving the sheet down from the top; -1 before.
  const listDragOrigin = useSharedValue(-1);
  const locked = useSharedValue(false);

  const [expanded, setExpanded] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (enterFromClosed) { offsetY.value = withSpring(halfOffset, SNAP_SPRING); }
  // Mount only: the entrance happens once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAnimatedReaction(
    () => keyboardAware && keyboard.progress.value > 0.5,
    (open, wasOpen) => {
      if (open !== wasOpen) { runOnJS(setTyping)(open); }
    },
  );

  const close = useCallback(() => {
    offsetY.value = withTiming(closedOffset, { duration: CLOSE_DURATION }, finished => {
      if (finished) { runOnJS(onClose)(); }
    });
  }, [offsetY, closedOffset, onClose]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  const gestures = useMemo(() => {
    const typingProgress = () => {
      'worklet';
      return keyboardAware ? keyboard.progress.value : 0;
    };

    const snapTo = (target: number, velocity: number) => {
      'worklet';
      if (target >= closedOffset) {
        offsetY.value = withTiming(closedOffset, { duration: CLOSE_DURATION }, finished => {
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
        if (locked.value) { return; }
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
        if (locked.value) { return; }
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
    locked,
    halfOffset,
    halfHeight,
    closedOffset,
    onClose,
  ]);

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const setLocked = useCallback((value: boolean) => { locked.value = value; }, [locked]);

  const sheetList = useMemo<SheetList>(
    () => ({ gesture: gestures.list, onScroll, scrollEnabled: expanded || typing, setLocked }),
    [gestures.list, onScroll, expanded, typing, setLocked],
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

  // Full between expanded and half; fades below half, so a drag-close leaves nothing for a
  // Modal's own slide-out to show.
  const backdropStyle = useAnimatedStyle(() => {
    const progress = keyboardAware ? keyboard.progress.value : 0;
    const belowHalf = offsetY.value * (1 - progress) - halfOffset;
    return { opacity: 1 - Math.min(1, Math.max(0, belowHalf / halfHeight)) };
  });

  return (
    <>
      {backdrop ? (
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
      ) : null}

      <Animated.View style={[styles.sheet, style, sheetStyle]}>
        <GestureDetector gesture={gestures.handle}>
          <View collapsable={false}>
            <View style={styles.grabber} />
            {header}
          </View>
        </GestureDetector>
        <SheetListContext.Provider value={sheetList}>{children}</SheetListContext.Provider>
      </Animated.View>
    </>
  );
}

type SheetModalProps = Omit<SheetSurfaceProps, 'backdrop' | 'enterFromClosed' | 'ref'> & {
  visible: boolean;
  /** Other modals launched from inside the sheet, or views that must share its window. */
  outside?: ReactNode;
};

export default function SheetModal({ visible, outside, ...surface }: SheetModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={surface.onClose}
    >
      {/* The Modal mounts its children only while open, so the keyboard hook (which switches
          the Android resize mode) is held only then, and every open starts at half. Android
          needs a gesture root of its own inside a Modal. */}
      <GestureHandlerRootView style={styles.root}>
        <SheetSurface {...surface} />
        {outside}
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The FlatList for a sheet. Scrolls only once the sheet is expanded, and hands the drags
 * that move the sheet to it. No bounce or overscroll stretch at the top: the sheet moving
 * IS the overscroll.
 */
export function SheetFlatList<T>({
  ref,
  ...props
}: Omit<FlatListProps<T>, 'CellRendererComponent'> & { ref?: Ref<FlatList<T>> }) {
  const sheet = useSheetList();
  const list = (
    <Animated.FlatList
      ref={ref}
      {...props}
      onScroll={sheet?.onScroll}
      scrollEventThrottle={16}
      scrollEnabled={sheet ? sheet.scrollEnabled : props.scrollEnabled}
      bounces={false}
      overScrollMode="never"
    />
  );
  return sheet ? <GestureDetector gesture={sheet.gesture}>{list}</GestureDetector> : list;
}

/** The ScrollView for a sheet, for bodies that are not lists. Same rules as SheetFlatList. */
export function SheetScrollView({
  ref,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView> }) {
  const sheet = useSheetList();
  const scroll = (
    <Animated.ScrollView
      ref={ref}
      {...props}
      onScroll={sheet?.onScroll}
      scrollEventThrottle={16}
      scrollEnabled={sheet ? sheet.scrollEnabled : props.scrollEnabled}
      bounces={false}
      overScrollMode="never"
    />
  );
  return sheet ? <GestureDetector gesture={sheet.gesture}>{scroll}</GestureDetector> : scroll;
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
