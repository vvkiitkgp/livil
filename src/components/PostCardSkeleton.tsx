import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../theme/colors';

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
      <View style={styles.media} />
      <View style={styles.actions}>
        <View style={[styles.pill, styles.pillAction]} />
        <View style={[styles.pill, styles.pillAction]} />
        <View style={[styles.pill, styles.pillAction]} />
      </View>
      <View style={[styles.line, styles.lineCaption]} />
      <View style={[styles.line, styles.lineCaptionEnd]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  lineHandle: { width: '30%', marginTop: 8 },
  lineCaption: { width: '72%', marginTop: 14 },
  lineCaptionEnd: { width: '54%', marginTop: 10 },
  media: {
    height: 220,
    borderRadius: 14,
    backgroundColor: COLORS.border,
  },
  actions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
  pill: {
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.border,
  },
  pillAction: { width: 52 },
});
