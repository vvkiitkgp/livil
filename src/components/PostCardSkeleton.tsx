import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../theme/colors';

export default function PostCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar} />
        <View style={styles.headerText}>
          <View style={[styles.line, { width: '46%' }]} />
          <View style={[styles.line, { width: '30%', marginTop: 8 }]} />
        </View>
      </View>
      <View style={styles.media} />
      <View style={styles.actions}>
        <View style={[styles.pill, { width: 52 }]} />
        <View style={[styles.pill, { width: 52 }]} />
        <View style={[styles.pill, { width: 52 }]} />
      </View>
      <View style={[styles.line, { width: '72%', marginTop: 14 }]} />
      <View style={[styles.line, { width: '54%', marginTop: 10 }]} />
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
});
