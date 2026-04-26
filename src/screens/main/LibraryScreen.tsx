import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../theme/colors';

const SECTIONS = [
  { id: 'l1', title: 'Liked Songs', count: '247 tracks', accent: '#7C3AED' },
  { id: 'l2', title: 'Recently Saved', count: '34 tracks', accent: '#EC4899' },
  { id: 'l3', title: 'My Playlists', count: '12 playlists', accent: '#22D3EE' },
  { id: 'l4', title: 'Following', count: '89 artists', accent: '#F59E0B' },
];

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Library</Text>
        <Text style={styles.subtitle}>Everything you've saved, in one place</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {SECTIONS.map(section => (
          <View key={section.id} style={styles.row}>
            <View style={[styles.thumb, { backgroundColor: section.accent }]}>
              <Text style={styles.thumbText}>{section.title.charAt(0)}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{section.title}</Text>
              <Text style={styles.rowSubtitle}>{section.count}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  title: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  list: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  chev: {
    color: COLORS.textMuted,
    fontSize: 24,
    fontWeight: '300',
    marginRight: 6,
  },
});
