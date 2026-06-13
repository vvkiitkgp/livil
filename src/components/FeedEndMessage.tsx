import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';

type Props = {
  title?: string;
  subtitle?: string;
};

/**
 * Friendly music-themed end-of-list card. Renders at the bottom of a feed once
 * pagination is exhausted, so the list doesn't just stop abruptly.
 */
export default function FeedEndMessage({
  title = 'End of the playlist',
  subtitle = "You're all caught up — fresh tracks land here when there's something new.",
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.barRow}>
        <View style={[styles.bar, styles.bar1]} />
        <View style={[styles.bar, styles.bar2]} />
        <View style={[styles.bar, styles.bar3]} />
        <View style={[styles.bar, styles.bar4]} />
        <View style={[styles.bar, styles.bar5]} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 36,
    paddingTop: 28,
    paddingBottom: 36,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 24,
    gap: 4,
    marginBottom: 16,
    opacity: 0.85,
  },
  bar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: COLORS.purpleLight,
  },
  bar1: { height: 10 },
  bar2: { height: 18 },
  bar3: { height: 24 },
  bar4: { height: 14 },
  bar5: { height: 8 },
  title: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
