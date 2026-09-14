import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Image } from 'react-native';
import Animated, {
  FadeOutLeft,
  LinearTransition,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

const { width: SCREEN_W } = Dimensions.get('window');
const ROW_H = 64;
const SWIPE_THRESHOLD = SCREEN_W * 0.35;
const SPRING_CFG = { damping: 40, stiffness: 400 };

export type DisplayItem = {
  track: NowPlayingInfo;
  queueIndex: number;
  displayIndex: number;
  isCurrent: boolean;
};

// ─── Now-playing equalizer ─────────────────────────────────────────────────

const EQ_H = 14;

/**
 * Purely decorative — this is NOT driven by the audio. Each bar gets its own
 * duration and start delay, all mutually non-divisible, so the three drift
 * permanently out of phase and read as random rather than as a synchronised
 * pulse. Cheaper and steadier than re-rolling a random target every cycle,
 * which needs a JS round-trip per bar per bounce.
 *
 * The beat-synced wave is a separate thing entirely (WaveVisualizer, driven by
 * `tracks.waveform_peaks`) — do not wire this to it. A queue row is off-screen
 * most of the time and is not worth a decode.
 */
const EQ_BARS = [
  { from: 0.35, to: 1.0, duration: 380, delay: 0 },
  { from: 0.55, to: 0.8, duration: 530, delay: 130 },
  { from: 0.3, to: 0.9, duration: 450, delay: 260 },
] as const;

function EqBar({ spec }: { spec: (typeof EQ_BARS)[number] }) {
  const h = useSharedValue(spec.from * EQ_H);

  useEffect(() => {
    h.value = withDelay(
      spec.delay,
      withRepeat(withTiming(spec.to * EQ_H, { duration: spec.duration }), -1, true),
    );
    // Reanimated keeps an infinite repeat running after unmount otherwise.
    return () => cancelAnimation(h);
  }, [h, spec]);

  const style = useAnimatedStyle(() => ({ height: h.value }));

  return <Animated.View style={[st.eqBar, style]} />;
}

/** Three bouncing bars marking the row that is currently playing. */
function EqIndicator() {
  return (
    <View style={st.eq}>
      {EQ_BARS.map((spec, i) => (
        <EqBar key={i} spec={spec} />
      ))}
    </View>
  );
}

// ─── Queue Row ─────────────────────────────────────────────────────────────

type RowProps = {
  item: DisplayItem;
  dragActiveIndex: SharedValue<number>;
  dragTY: SharedValue<number>;
  canTap: boolean;
  canSwipe: boolean;
  canDrag: boolean;
  onTap: (item: DisplayItem) => void;
  onSwipe: (item: DisplayItem) => void;
  onDrop: (fromDisplay: number, offset: number) => void;
  onDragToggle: (active: boolean) => void;
};

const QueueRow = React.memo(function QueueRow({
  item,
  dragActiveIndex,
  dragTY,
  canTap,
  canSwipe,
  canDrag,
  onTap,
  onSwipe,
  onDrop,
  onDragToggle,
}: RowProps) {
  const swipeX = useSharedValue(0);
  const isMe = useSharedValue(false);
  const scale = useSharedValue(1);
  const canInteract = !item.isCurrent;

  // ── Swipe to remove ──
  const swipeG = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .enabled(canInteract && canSwipe)
    .onUpdate(e => {
      swipeX.value = e.translationX;
    })
    .onEnd(e => {
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        swipeX.value = withTiming(
          Math.sign(e.translationX) * SCREEN_W,
          { duration: 120 },
          () => runOnJS(onSwipe)(item),
        );
      } else {
        swipeX.value = withSpring(0, SPRING_CFG);
      }
    });

  // ── Drag to reorder ──
  const dragG = Gesture.Pan()
    .activateAfterLongPress(350)
    .enabled(canInteract && canDrag)
    .onStart(() => {
      isMe.value = true;
      scale.value = withSpring(1.04, { damping: 15 });
      dragActiveIndex.value = item.displayIndex;
      runOnJS(onDragToggle)(true);
    })
    .onUpdate(e => {
      dragTY.value = e.translationY;
    })
    .onFinalize(() => {
      const off = Math.round(dragTY.value / ROW_H);
      isMe.value = false;
      scale.value = withSpring(1, { damping: 15 });
      dragActiveIndex.value = -1;
      dragTY.value = 0;
      runOnJS(onDragToggle)(false);
      if (off !== 0) {
        runOnJS(onDrop)(item.displayIndex, off);
      }
    });

  // ── Tap to play ──
  const tapG = Gesture.Tap()
    .enabled(canInteract && canTap)
    .onEnd(() => runOnJS(onTap)(item));

  const gesture = Gesture.Race(dragG, swipeG, tapG);

  // Artwork falls back the same way the lock-screen metadata does (see
  // buildNowPlayingMetadata): audio posts carry `coverArtUrl`, video posts only
  // have a `thumbnailUrl`, and anything with neither borrows the author's
  // avatar so a row is never an empty tile. The placeholder below is now only
  // reached for a track whose author has no avatar either.
  const artUri =
    item.track.coverArtUrl ?? item.track.thumbnailUrl ?? item.track.authorAvatarUrl;

  const animStyle = useAnimatedStyle(() => {
    // This item is being dragged — follow finger
    if (isMe.value) {
      return {
        transform: [
          { translateY: dragTY.value },
          { scale: scale.value },
        ],
        zIndex: 999,
      };
    }

    // Another item is being dragged — make space if needed
    let spaceY = 0;
    const ai = dragActiveIndex.value;
    if (ai >= 0 && ai !== item.displayIndex) {
      const dragPos = ai * ROW_H + dragTY.value;
      const myPos = item.displayIndex * ROW_H;
      if (ai < item.displayIndex && dragPos > myPos - ROW_H / 2) {
        spaceY = -ROW_H;
      } else if (ai > item.displayIndex && dragPos < myPos + ROW_H / 2) {
        spaceY = ROW_H;
      }
    }

    // While dragging: spring into displaced position.
    // After drag ends (ai === -1): snap to 0 instantly so itemLayoutAnimation
    // can take over without fighting a spring-back.
    const yVal = ai >= 0 ? withSpring(spaceY, SPRING_CFG) : 0;

    return {
      transform: [
        { translateX: swipeX.value },
        { translateY: yVal },
        { scale: scale.value },
      ],
      zIndex: 0,
    };
  });

  const deleteStyleLeft = useAnimatedStyle(() => {
    const x = swipeX.value;
    return {
      opacity: x > 10 ? Math.min(x / SWIPE_THRESHOLD, 1) : 0,
    };
  });

  const deleteStyleRight = useAnimatedStyle(() => {
    const x = swipeX.value;
    return {
      opacity: x < -10 ? Math.min(Math.abs(x) / SWIPE_THRESHOLD, 1) : 0,
    };
  });

  return (
    <Animated.View exiting={FadeOutLeft.duration(150)} style={st.cell}>
      {/* Red delete backgrounds — stationary behind the row */}
      {canSwipe && (
        <>
          <Animated.View style={[st.deleteBg, st.deleteBgLeft, deleteStyleLeft]}>
            <Icon name="trash" size={22} color={COLORS.white} />
          </Animated.View>
          <Animated.View style={[st.deleteBg, st.deleteBgRight, deleteStyleRight]}>
            <Icon name="trash" size={22} color={COLORS.white} />
          </Animated.View>
        </>
      )}
      {/* Row — moves freely for swipe (X) and drag (Y) */}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[st.row, animStyle]}>
          {artUri ? (
            <Image source={{ uri: artUri }} style={st.cover} />
          ) : (
            <View style={[st.cover, st.coverFb]} />
          )}
          <View style={st.meta}>
            <Text
              style={[st.title, item.isCurrent && st.titleCur]}
              numberOfLines={1}
            >
              {item.track.title}
            </Text>
            <Text style={st.artist} numberOfLines={1}>
              {item.track.artistName}
            </Text>
          </View>
          {item.isCurrent && <EqIndicator />}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}, (a, b) =>
  a.item.queueIndex === b.item.queueIndex
  && a.item.isCurrent === b.item.isCurrent
  && a.item.displayIndex === b.item.displayIndex
  && a.canTap === b.canTap
  && a.canSwipe === b.canSwipe
  && a.canDrag === b.canDrag
);

// ─── Main Component ────────────────────────────────────────────────────────

type Props = {
  paddingBottom?: number;
  /** Allow tap-to-play on queue items (default: true) */
  canTap?: boolean;
  /** Allow swipe-to-remove on queue items (default: true) */
  canSwipe?: boolean;
  /** Allow drag-to-reorder on queue items (default: true) */
  canReorder?: boolean;
  /**
   * External data source — when provided, the component uses this instead of
   * reading from PlaybackContext. Useful for Jam room queues.
   */
  externalData?: DisplayItem[];
  /** External tap handler — used with externalData */
  onTap?: (item: DisplayItem) => void;
  /** External swipe/remove handler — used with externalData */
  onSwipe?: (item: DisplayItem) => void;
  /** External drop/reorder handler — used with externalData */
  onDrop?: (fromDisplay: number, offset: number) => void;
};

export default function QueueList({
  paddingBottom = 0,
  canTap = true,
  canSwipe = true,
  canReorder = true,
  externalData,
  onTap: externalOnTap,
  onSwipe: externalOnSwipe,
  onDrop: externalOnDrop,
}: Props) {
  const {
    queueRef,
    currentIndexRef,
    playAtIndex,
    moveQueueItem,
    removeFromQueue,
    nowPlaying,
    queueVersion,
  } = usePlayback();

  const isExternal = externalData !== undefined;

  const [internalData, setInternalData] = useState<DisplayItem[]>([]);
  const [version, setVersion] = useState(0);
  const [scrollLocked, setScrollLocked] = useState(false);

  const dragActiveIndex = useSharedValue(-1);
  const dragTY = useSharedValue(0);
  const skipNextLayoutAnim = useRef(false);

  // Build display data: current track + all upcoming (internal mode only)
  useEffect(() => {
    if (isExternal) { return; }
    const queue = queueRef.current;
    const idx = currentIndexRef.current;
    console.log(`[LIVIL][QL] rebuild: queueLen=${queue.length} curIdx=${idx} queueVersion=${queueVersion}`);
    const items: DisplayItem[] = [];
    for (let i = idx; i < queue.length; i++) {
      const track = queue[i];
      if (!track) { continue; }
      items.push({
        track,
        queueIndex: i,
        displayIndex: i - idx,
        isCurrent: i === idx,
      });
    }
    console.log(`[LIVIL][QL] built ${items.length} display items`);
    setInternalData(items);
    // Re-enable layout animation after the render triggered by drag-drop commits
    if (skipNextLayoutAnim.current) {
      requestAnimationFrame(() => {
        skipNextLayoutAnim.current = false;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExternal, nowPlaying?.postId, queueVersion, version]);

  const data = isExternal ? externalData : internalData;

  const handleTap = useCallback((item: DisplayItem) => {
    if (isExternal) {
      externalOnTap?.(item);
    } else {
      playAtIndex(item.queueIndex);
      setVersion(v => v + 1);
    }
  }, [isExternal, externalOnTap, playAtIndex]);

  const handleSwipe = useCallback((item: DisplayItem) => {
    if (isExternal) {
      externalOnSwipe?.(item);
    } else {
      removeFromQueue(item.queueIndex);
      setVersion(v => v + 1);
    }
  }, [isExternal, externalOnSwipe, removeFromQueue]);

  const handleDrop = useCallback((fromDisplay: number, offset: number) => {
    if (isExternal) {
      skipNextLayoutAnim.current = true;
      externalOnDrop?.(fromDisplay, offset);
    } else {
      const curIdx = currentIndexRef.current;
      const from = curIdx + fromDisplay;
      const to = Math.max(curIdx + 1, Math.min(from + offset, queueRef.current.length - 1));
      if (from !== to) {
        skipNextLayoutAnim.current = true;
        moveQueueItem(from, to);
        setVersion(v => v + 1);
      }
    }
  }, [isExternal, externalOnDrop, currentIndexRef, queueRef, moveQueueItem]);

  const handleDragToggle = useCallback((active: boolean) => {
    setScrollLocked(active);
  }, []);

  const renderItem = useCallback(({ item }: { item: DisplayItem }) => (
    <QueueRow
      item={item}
      dragActiveIndex={dragActiveIndex}
      dragTY={dragTY}
      canTap={canTap}
      canSwipe={canSwipe}
      canDrag={canReorder}
      onTap={handleTap}
      onSwipe={handleSwipe}
      onDrop={handleDrop}
      onDragToggle={handleDragToggle}
    />
  ), [dragActiveIndex, dragTY, canTap, canSwipe, canReorder, handleTap, handleSwipe, handleDrop, handleDragToggle]);

  const keyExtractor = useCallback((item: DisplayItem) => item.track?.postId ?? `q-${item.queueIndex}`, []);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_H,
    offset: ROW_H * index,
    index,
  }), []);

  return (
    <Animated.FlatList
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      itemLayoutAnimation={skipNextLayoutAnim.current ? undefined : LinearTransition.springify().damping(40).stiffness(400)}
      getItemLayout={getItemLayout}
      scrollEnabled={!scrollLocked}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom }}
      ListEmptyComponent={<Text style={st.empty}>Queue is empty</Text>}
    />
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  cell: {
    height: ROW_H,
  },
  deleteBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#E53935',
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  deleteBgLeft: { alignItems: 'flex-start' },
  deleteBgRight: { alignItems: 'flex-end' },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
  },
  cover: { width: 44, height: 44, borderRadius: 8, backgroundColor: COLORS.card },
  coverFb: { backgroundColor: COLORS.purpleDim },
  meta: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  titleCur: { color: COLORS.purpleLight },
  artist: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  // Bars grow upward from a common baseline, so the container is fixed-height
  // and bottom-aligned. Solid purple is fine here — the no-fill rule exempts
  // small indicators, and an outlined 3px bar would be invisible.
  eq: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: EQ_H,
    gap: 2,
  },
  eqBar: { width: 3, borderRadius: 1.5, backgroundColor: COLORS.purpleNeon },
  empty: { color: COLORS.textMuted, fontSize: 14, paddingTop: 20, textAlign: 'center' },
});
