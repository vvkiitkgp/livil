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
      {/* The pulse runs THROUGH the badge and out both sides, so the wrapper is as wide as
          the pulse: a child drawn past its parent's edge is clipped on Android. */}
      <View style={styles.mark}>
        <View style={styles.badge}>
          <GradientBorder borderRadius={BADGE / 2} />
        </View>
        <GradientPulse />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

let gradientCounter = 0;

/** The badge's diameter, and how far the pulse's flat ends run past it on each side. */
const BADGE = 26;
const OVERHANG = 7;
const MARK_W = BADGE + OVERHANG * 2;
const PULSE_H = 14;
/** The spike below is drawn at 18px; this scales it to PULSE_H. */
const K = PULSE_H / 18;

/**
 * Phosphor's Pulse spike (bold), with its flat ends stretched to MARK_W so they cross the
 * badge's edge, stroked with the SAME purple ramp as GradientBorder. Drawn here rather than
 * through Icon because Icon takes one flat colour and a square box. Unique gradient id per
 * instance, as GradientBorder does.
 */
function GradientPulse() {
  const [id] = React.useState(() => `lvpulse_${++gradientCounter}`);
  // The spike keeps Pulse's proportions (x 56..200 of 256, y 40..216), centred.
  const c = MARK_W / 2;
  const mid = PULSE_H / 2;
  const points = [
    [1, mid], [c - 5.06 * K, mid], [c - 2.25 * K, 2.8 * K], [c + 2.25 * K, 15.2 * K],
    [c + 5.06 * K, mid], [MARK_W - 1, mid],
  ].map(([x, y]) => `${x} ${y}`).join(' ');
  return (
    <Svg width={MARK_W} height={PULSE_H} viewBox={`0 0 ${MARK_W} ${PULSE_H}`} style={styles.pulse}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={COLORS.purpleRoyal} stopOpacity="1" />
          <Stop offset="0.45" stopColor={COLORS.purple} stopOpacity="1" />
          <Stop offset="0.72" stopColor={COLORS.purpleLight} stopOpacity="1" />
          <Stop offset="1" stopColor={COLORS.purpleNeon} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Polyline
        points={points}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// A round badge — the primary gradient border, no fill — crossed by the gradient pulse,
// whose flat ends run out past the circle; the number sits beside it (owner, 2026-10-18).
// No overflow: 'hidden' on the badge: GradientBorder draws inside the bounds, and
// clipping would shave the glow.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    marginTop: 8,
  },
  mark: {
    width: MARK_W,
    height: BADGE,
  },
  badge: {
    position: 'absolute',
    left: OVERHANG,
    top: 0,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
  },
  pulse: {
    position: 'absolute',
    left: 0,
    top: (BADGE - PULSE_H) / 2,
  },
  text: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
});
