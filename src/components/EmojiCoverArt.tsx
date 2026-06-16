import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/**
 * Renders the playlist emoji cover — solid color when only `color` is set,
 * top-left → bottom-right linear gradient when both `color` + `color2` are.
 * Centralized so the same logic feeds the Library list thumb, profile grid
 * card, and DetailView hero — no duplicated gradient math.
 *
 * Uses react-native-svg (already a dep) for the gradient rather than adding
 * react-native-linear-gradient — see CLAUDE.md "no new packages".
 */
export type EmojiCoverArtProps = {
  emoji: string | null;
  color: string | null;
  color2: string | null;
  /** Square side. Emoji font-size scales to ~50% of this. */
  size: number;
  borderRadius?: number;
  /** Random gradient id collision is fine but in case multiple covers render
   *  in the same tree we let callers supply a unique key. */
  gradientId?: string;
};

let gradientCounter = 0;
function nextGradientId(): string {
  gradientCounter += 1;
  return `lvgrad_${gradientCounter}`;
}

export default function EmojiCoverArt({
  emoji, color, color2, size, borderRadius, gradientId,
}: EmojiCoverArtProps) {
  const radius = borderRadius ?? Math.round(size * 0.12);
  const isGradient = !!color && !!color2;
  const containerStyle: ViewStyle = {
    width: size, height: size, borderRadius: radius,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: isGradient ? COLORS.bg : (color ?? COLORS.bg),
  };

  // Slightly aggressive size so emojis fill the tile nicely.
  const emojiFontSize = Math.round(size * 0.5);
  const emojiLineHeight = Math.round(size * 0.58);

  // Use a stable gradient id within this render (re-mounts get a new id; that's
  // fine because SVG's <defs> are scoped to their own <Svg>).
  const gId = React.useMemo(() => gradientId ?? nextGradientId(), [gradientId]);

  return (
    <View style={containerStyle}>
      {isGradient ? (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgLinearGradient id={gId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={color!} stopOpacity="1" />
              <Stop offset="1" stopColor={color2!} stopOpacity="1" />
            </SvgLinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gId})`} />
        </Svg>
      ) : null}
      {emoji ? (
        <Text style={[styles.emoji, { fontSize: emojiFontSize, lineHeight: emojiLineHeight }]}>{emoji}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emoji: { textAlign: 'center' },
});
