import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../theme/colors';

/**
 * A feed card while posts load, in PostCard's shape so the real cards drop into place
 * rather than reflowing: header, a caption line, the full-width square cover with its source
 * tag (top-right) and the song's name (bottom-left) where they will sit, then the action row
 * — play on the left, the counters packed on the right.
 */
export default function PostCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar} />
        <View style={styles.headerText}>
          <View style={[styles.line, styles.lineName]} />
          <View style={[styles.line, styles.lineHandle]} />
        </View>
      </View>
      <View style={[styles.line, styles.lineCaption]} />
      <View style={styles.cover}>
        <View style={styles.tag} />
        <View style={styles.songLines}>
          <View style={[styles.bar, styles.barTitle]} />
          <View style={[styles.bar, styles.barArtist]} />
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.playDot} />
        <View style={styles.stats}>
          <View style={[styles.pill, styles.pillAction]} />
          <View style={[styles.pill, styles.pillAction]} />
          <View style={[styles.pill, styles.pillAction]} />
        </View>
      </View>
    </View>
  );
}

// Sizes are PostCard's: card padding/radius/gap, 42 avatar, 18-radius cover, 31-tall source
// tag, 46 play button.
const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.border,
  },
  headerText: {
    flex: 1,
    gap: 8,
  },
  line: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.border,
  },
  lineName: { width: '46%' },
  lineHandle: { width: '30%' },
  lineCaption: { width: '62%', marginTop: 14 },
  // The cover's fill is a step lighter than the card, and the marks on it a step lighter
  // again, so they read as things ON the cover.
  cover: {
    width: '100%',
    aspectRatio: 1,
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: COLORS.card,
  },
  tag: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 112,
    height: 31,
    borderRadius: 16,
    backgroundColor: COLORS.border,
  },
  songLines: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    gap: 8,
  },
  bar: {
    borderRadius: 8,
    backgroundColor: COLORS.border,
  },
  barTitle: { width: '58%', height: 18 },
  barArtist: { width: '36%', height: 13 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  playDot: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.border,
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
  },
  pill: {
    height: 26,
    borderRadius: 10,
    backgroundColor: COLORS.border,
  },
  pillAction: { width: 46 },
});
