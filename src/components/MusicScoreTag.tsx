import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
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
        <Icon name="pulse" size={18} color={COLORS.white} />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

/** The round badge's diameter. */
const BADGE = 34;

// A round badge — the white pulse inside the primary gradient border, no fill — with the
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
