import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '../theme/colors';
import { useGif } from '../services/gifs';
import type { CommentGif } from '../services/comments';

/** The GIF's box in a comment: this wide, unless that would make it taller than MAX_H. */
const MAX_W = 180;
const MAX_H = 220;
const MIN_SIDE = 48;

/**
 * The on-screen box for a GIF of this size: aspect ratio kept, at most maxW × maxH
 * (a comment's size by default). Known before the lookup answers (the comment stores the
 * size), so the comment never jumps when the GIF arrives.
 */
export function gifBox(
  width: number,
  height: number,
  maxW = MAX_W,
  maxH = MAX_H,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) { return { width: maxW, height: Math.round(maxW * 0.75) }; }
  const ratio = height / width;
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  return { width: Math.max(Math.round(w), MIN_SIDE), height: Math.max(Math.round(h), MIN_SIDE) };
}

/**
 * The GIF shared in a comment. It plays in place, with no controls and nothing to tap.
 *
 * The comment stores only the GIF's id; its media URL comes fresh from the `gifs` edge
 * function (GIPHY's terms forbid storing it), which also refuses anything rated above
 * PG-13. Until it answers, the box is reserved at the GIF's own aspect ratio. A GIF that
 * is gone, refused, or fails to load keeps the box and says so. A lookup that could not
 * be made (GIPHY down, quota spent) keeps the box empty instead: the GIF is not gone, and
 * the next time the comment is drawn it is asked for again.
 *
 * Android animates it only in a build with Fresco's animated-gif module; without one it
 * shows the first frame (ADR-0031).
 */
export default function CommentGifCard({
  gif,
  maxWidth = MAX_W,
  maxHeight = MAX_H,
  style,
}: {
  gif: Pick<CommentGif, 'id' | 'width' | 'height'>;
  /** A chat bubble draws it larger than a comment does. */
  maxWidth?: number;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const state = useGif(gif.id);
  const [failed, setFailed] = useState(false);
  const box = gifBox(gif.width, gif.height, maxWidth, maxHeight);
  const unavailable = state.status === 'unavailable' || failed;

  return (
    <View
      style={[styles.box, box, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={unavailable ? 'GIF unavailable' : `GIF${state.gif?.title ? `: ${state.gif.title}` : ''}`}
      testID="comment-gif"
    >
      {unavailable ? (
        <Text style={styles.unavailable}>GIF unavailable</Text>
      ) : state.gif ? (
        <Image
          source={{ uri: state.gif.url }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 6,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  unavailable: { color: COLORS.textSecondary, fontSize: 12 },
});
