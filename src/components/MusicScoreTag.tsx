import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { COLORS } from '../theme/colors';
import { formatMusicScore } from '../services/musicScore';

/**
 * The profile's VIBE beside its @name (ADR-0032 — built as the "music score"; renamed to
 * Vibe by the owner on 2026-10-18, like the chat vibe, with a purple heart for the old
 * pulse): the heart and the number in a soft purple pill. Deliberately says nothing about
 * itself — no label, nothing to tap; how it grows lives on livil-music.com/vibe.
 * Renders nothing until there is a score above 0.
 */
export default function MusicScoreTag({ score }: { score: number | null }) {
  if (score == null || score <= 0) {return null;}
  const text = formatMusicScore(score);
  return (
    <View style={styles.tag} accessibilityLabel={`Vibe ${text}`} testID="music-score-tag">
      <Icon name="heart" size={13} color={COLORS.purpleNeon} weight="fill" />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.purpleDim,
  },
  text: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '800',
  },
});
