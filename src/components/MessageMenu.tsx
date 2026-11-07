import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';
import {
  MENU_CARD_PADDING,
  MENU_GAP,
  MENU_HEADER_HEIGHT,
  MENU_PILL_HEIGHT,
  MENU_ROW_HEIGHT,
  menuCardHeight,
  messageMenuLayout,
  type MenuAnchor,
} from '../utils/messageMenuLayout';

/** A row of the card under the message (Reply, Copy, Delete). */
export type MessageMenuAction = {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
};

const SLIDE_MS = 160;
/** Smooth at both ends, so nothing starts or stops with a jump. */
const SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
/** The reactions and the card grow out of the message from this share of their size. */
const GROW_FROM = 0.92;
/** Against the small snapshot, so this reads as a heavy blur on the full screen. */
const BLUR_RADIUS = 8;
/** The chat list's own side padding, so the lifted message sits exactly over the original. */
const ROW_INSET = 12;

/**
 * The long-press menu: the pressed message lifted out of the chat, its quick reactions above it
 * (the "+" opens every emoji) and what can be done with it below. An overlay, not a Modal, so the
 * emoji sheet can open over it. The blurred chat fades in as the stack settles, and all of it
 * plays back when it closes, at one speed and without a bounce.
 */
export default function MessageMenu({
  visible,
  anchor,
  backdropUri,
  alignRight,
  timeLabel,
  reactions,
  myReaction,
  actions,
  onPick,
  onMore,
  onClose,
  children,
}: {
  visible: boolean;
  anchor: MenuAnchor | null;
  /** A small picture of the chat to draw blurred behind everything (blurSnapshot). Dims without. */
  backdropUri: string | null;
  /** My own message: the reactions and the card line up with it on the right. */
  alignRight: boolean;
  timeLabel: string;
  reactions: readonly string[];
  /** The reaction I already gave this message, marked so a tap reads as taking it back. */
  myReaction: string | null;
  actions: MessageMenuAction[];
  onPick: (emoji: string) => void;
  onMore: () => void;
  onClose: () => void;
  /** The pressed message, drawn as it is in the chat. Not pressable here. */
  children: ReactNode;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // On screen until it has animated away, showing what it showed when it was closed.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) { setMounted(true); }
  const shownRef = useRef({ anchor, backdropUri, alignRight, timeLabel, reactions, myReaction, actions, children });
  if (visible) {
    shownRef.current = { anchor, backdropUri, alignRight, timeLabel, reactions, myReaction, actions, children };
  }
  const shown = shownRef.current;

  const { top, rowMaxHeight, slideFrom } = messageMenuLayout({
    anchor: shown.anchor,
    cardHeight: menuCardHeight(shown.actions.length),
    windowHeight,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      easing: SLIDE_EASING,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Not when interrupted: reopened mid-close, it stays and climbs back from where it is.
      if (finished && !visible) { setMounted(false); }
    });
  }, [visible, progress]);

  const blurOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { blurOpacity.setValue(0); }, [shown.backdropUri, blurOpacity]);
  const showBlur = () => {
    Animated.timing(blurOpacity, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: SLIDE_EASING,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (!visible) { return; }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) { return null; }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [slideFrom, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [GROW_FROM, 1] });
  // The lifted copy covers the original almost at once, so the fade never shows the two apart.
  const rowOpacity = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] });
  const align = shown.alignRight ? styles.alignRight : styles.alignLeft;
  const side = shown.alignRight ? 'right' : 'left';

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]} pointerEvents="none">
        <View style={styles.dim} />
        {shown.backdropUri ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
            <Image
              source={{ uri: shown.backdropUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="stretch"
              blurRadius={BLUR_RADIUS}
              fadeDuration={0}
              onLoad={showBlur}
            />
            <View style={styles.blurTint} />
          </Animated.View>
        ) : null}
      </Animated.View>
      {/* A tap on the dim is the same as backing out. A sibling BEHIND the stack, so taps on
          the stack never reach it. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <Animated.View
        pointerEvents="box-none"
        style={[styles.stack, { top, transform: [{ translateY }] }]}
      >
        <Animated.View
          style={[styles.pill, align, { opacity: progress, transformOrigin: `${side} bottom`, transform: [{ scale }] }]}
        >
          {shown.reactions.map(emoji => (
            <Pressable
              key={emoji}
              onPress={() => onPick(emoji)}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              style={({ pressed }) => [
                styles.reaction,
                emoji === shown.myReaction && styles.reactionMine,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reactionEmoji} allowFontScaling={false}>{emoji}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel="More reactions"
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
          >
            <Icon name="add" size={22} color={COLORS.textSecondary} />
          </Pressable>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.row, { maxHeight: rowMaxHeight, opacity: rowOpacity }]}>
          {shown.children}
        </Animated.View>

        <Animated.View
          style={[styles.card, align, { opacity: progress, transformOrigin: `${side} top`, transform: [{ scale }] }]}
        >
          <Text style={styles.time} numberOfLines={1}>{shown.timeLabel}</Text>
          {shown.actions.map(a => (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Icon name={a.icon} size={22} color={a.destructive ? COLORS.error : COLORS.white} />
              <Text style={[styles.actionLabel, a.destructive && styles.actionLabelDanger]}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5,5,10,0.88)',
  },
  blurTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5,5,10,0.45)',
  },
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  alignLeft: { alignSelf: 'flex-start', marginLeft: 12 },
  alignRight: { alignSelf: 'flex-end', marginRight: 12 },
  pill: {
    height: MENU_PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderRadius: MENU_PILL_HEIGHT / 2,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: MENU_GAP,
  },
  reaction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionMine: { backgroundColor: COLORS.purpleDim },
  reactionEmoji: { fontSize: 36, lineHeight: 44 },
  pressed: { opacity: 0.6 },
  row: { overflow: 'hidden', paddingHorizontal: ROW_INSET },
  card: {
    minWidth: 200,
    paddingVertical: MENU_CARD_PADDING,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: MENU_GAP,
  },
  time: {
    height: MENU_HEADER_HEIGHT,
    lineHeight: MENU_HEADER_HEIGHT,
    paddingHorizontal: 18,
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  action: {
    height: MENU_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
  },
  actionPressed: { backgroundColor: COLORS.border },
  actionLabel: { color: COLORS.white, fontSize: 16, fontWeight: '500' },
  actionLabelDanger: { color: COLORS.error },
});
