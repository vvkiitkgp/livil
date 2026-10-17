import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Logo } from './Logo';
import { GradientBorder } from './GradientBorder';
import { COLORS } from '../theme/colors';
import { formatMusicScore } from '../services/musicScore';

/**
 * The music score beside a profile's @name (ADR-0032), marked with the Livil logo itself —
 * our own mark, not a stock icon (owner, 2026-10-18). Deliberately says nothing about
 * itself — no label, nothing to tap; how it grows lives on livil-music.com/score.
 * Renders nothing until there is a score above 0.
 */
export default function MusicScoreTag({ score }: { score: number | null }) {
  if (score == null || score <= 0) {return null;}
  const text = formatMusicScore(score);
  return (
    <View style={styles.tag} accessibilityLabel={`Music score ${text}`} testID="music-score-tag">
      <GradientBorder borderRadius={RADIUS} />
      <Logo size={30} color={COLORS.white} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const RADIUS = 999;

// The Livil outline (the primary button's gradient border) around a white logo and number —
// no fill (owner, 2026-10-18). No overflow: 'hidden' here: GradientBorder draws inside
// the bounds, and clipping would shave the glow (see CLAUDE.md, GradientBorder).
const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS,
  },
  text: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
  },
});
