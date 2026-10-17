import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { COLORS } from '../theme/colors';
import { formatMusicScore } from '../services/musicScore';

/**
 * The music score beside a profile's @name (ADR-0032): the pulse and the number in a soft
 * purple pill — the first design, which the owner kept after trying a logo, a gradient
 * outline and a round badge (2026-10-18). Deliberately says nothing about itself — no
 * label, nothing to tap; how it grows lives on livil-music.com/score.
 * Renders nothing until there is a score above 0.
 */
export default function MusicScoreTag({ score }: { score: number | null }) {
  if (score == null || score <= 0) {return null;}
  const text = formatMusicScore(score);
  return (
    <View style={styles.tag} accessibilityLabel={`Music score ${text}`} testID="music-score-tag">
      <Icon name="pulse" size={16} color={COLORS.purpleNeon} />
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
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.purpleDim,
  },
  text: {
    color: COLORS.purpleLight,
    fontSize: 15,
    fontWeight: '800',
  },
});
