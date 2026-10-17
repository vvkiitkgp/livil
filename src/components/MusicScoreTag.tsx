import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Polyline, Stop } from 'react-native-svg';
import { GradientBorder } from './GradientBorder';
import { COLORS } from '../theme/colors';
import { formatMusicScore } from '../services/musicScore';

/**
 * The music score beside a profile's @name (ADR-0032), marked with the pulse in a round
 * gradient badge (owner, 2026-10-18). Deliberately says nothing about
 * itself — no label, nothing to tap; how it grows lives on livil-music.com/score.
 * Renders nothing until there is a score above 0.
 */
export default function MusicScoreTag({ score }: { score: number | null }) {
  if (score == null || score <= 0) {return null;}
  const text = formatMusicScore(score);
  return (
    <View style={styles.row} accessibilityLabel={`Music score ${text}`} testID="music-score-tag">
      <View style={styles.badge}>
        <GradientBorder borderRadius={BADGE / 2} />
        <GradientPulse size={18} />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

let gradientCounter = 0;

/**
 * The pulse (Phosphor's Pulse, bold) stroked with the SAME purple ramp as GradientBorder,
 * so glyph and outline read as one piece. Drawn here rather than through Icon because
 * Icon takes one flat colour. A unique gradient id per instance, as GradientBorder does.
 */
function GradientPulse({ size }: { size: number }) {
  const [id] = React.useState(() => `lvpulse_${++gradientCounter}`);
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={COLORS.purpleRoyal} stopOpacity="1" />
          <Stop offset="0.45" stopColor={COLORS.purple} stopOpacity="1" />
          <Stop offset="0.72" stopColor={COLORS.purpleLight} stopOpacity="1" />
          <Stop offset="1" stopColor={COLORS.purpleNeon} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Polyline
        points="24 128 56 128 96 40 160 216 200 128 232 128"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={24}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The round badge's diameter. */
const BADGE = 34;

// A round badge — the gradient pulse inside the primary gradient border, no fill — with the
// number beside it, outside (owner, 2026-10-18). No overflow: 'hidden' on the badge:
// GradientBorder draws inside the bounds, and clipping would shave the glow.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
});
