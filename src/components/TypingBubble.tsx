import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { typingLabel, useChatTyping } from '../utils/chatTyping';

const DOT_STAGGER_MS = 150;

function Dot({ index }: { index: number }) {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withDelay(
      index * DOT_STAGGER_MS,
      withRepeat(withTiming(1, { duration: 420 }), -1, true),
    );
    // Reanimated keeps an infinite repeat running after unmount otherwise.
    return () => cancelAnimation(lift);
  }, [lift, index]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * lift.value,
    transform: [{ translateY: -3 * lift.value }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

/**
 * The three dots under the newest message while someone is typing, drawn like an incoming
 * bubble. It reads the typing store itself, so a signal redraws this and not the chat.
 *
 * Goes in the inverted list's header with TYPING_SLOT_STYLE as ListHeaderComponentStyle.
 */
export default function TypingBubble({ conversationId }: { conversationId: string }) {
  const people = useChatTyping(conversationId);
  const person = people[0];
  if (!person) { return null; }

  return (
    <View
      style={styles.row}
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={typingLabel(people, true)}
    >
      {person.avatarUrl ? (
        <Image source={{ uri: person.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarText}>{(person.name || '?').slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.bubble}>
        <Dot index={0} />
        <Dot index={1} />
        <Dot index={2} />
      </View>
    </View>
  );
}

const SLOT_HEIGHT = 32;
const LIST_GAP = 6;

/**
 * Sits inside the empty space the list keeps under the newest message (its 200pt resting
 * padding), so showing the dots moves nothing: no message shifts, here or for someone reading
 * further up. The inverted list lays this out before the first message, hence the negative
 * top margin; LIST_GAP is ConversationScreen's listContent gap, which still applies after it.
 */
export const TYPING_SLOT_STYLE = { height: SLOT_HEIGHT, marginTop: -(SLOT_HEIGHT + LIST_GAP) };

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginTop: 2,
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarPlaceholder: {
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 29,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: COLORS.surface,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.textSecondary },
});
