import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Logo } from './Logo';
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
      <Logo size={22} color={COLORS.purpleNeon} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.purpleDim,
  },
  text: {
    color: COLORS.purpleLight,
    fontSize: 12,
    fontWeight: '800',
  },
});
