import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { COLORS } from '../theme/colors';
import { formatMusicScore } from '../services/musicScore';

/**
 * A chat's vibe, beside the friend's name in the inbox. Like the music score tag it says
 * nothing about itself. Renders nothing at 0.
 */
export default function VibeTag({ vibe }: { vibe: number }) {
  if (!(vibe > 0)) {return null;}
  const text = formatMusicScore(vibe);
  return (
    <View style={styles.tag} accessibilityLabel={`Vibe ${text}`} testID="vibe-tag">
      <Icon name="musicScore" size={11} color={COLORS.purpleNeon} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: COLORS.purpleDim,
    flexShrink: 0,
  },
  text: {
    color: COLORS.purpleNeon,
    fontSize: 12,
    fontWeight: '800',
  },
});
