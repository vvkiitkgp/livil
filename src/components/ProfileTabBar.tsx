import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { COLORS } from '../theme/colors';

export type ProfileTab = 'reposts' | 'uploads' | 'albums' | 'playlists';

export type TabCounts = {
  reposts: number;
  uploads: number;
  albums: number;
  playlists: number;
};

type TabSpec = { key: ProfileTab; label: string };

const ORDER: TabSpec[] = [
  { key: 'reposts', label: 'Reposts' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'albums', label: 'Albums' },
  { key: 'playlists', label: 'Playlists' },
];

/**
 * Tab visibility rule (locked in during design):
 *   Reposts + Playlists  → always render (they're universal affordances).
 *   Uploads + Albums     → render only when count > 0.
 *
 * For Reposts and Playlists we still render even when the count is 0 — they
 * show an in-tab empty state. This keeps the navigation predictable: a tab
 * doesn't appear and disappear as you fill it. Uploads/Albums are creator
 * concepts so showing them with "0" would be noise on a listener profile.
 */
export function visibleTabsFor(counts: TabCounts): TabSpec[] {
  return ORDER.filter(t => {
    if (t.key === 'reposts' || t.key === 'playlists') { return true; }
    return counts[t.key] > 0;
  });
}

export default function ProfileTabBar({
  active,
  counts,
  onChange,
}: {
  active: ProfileTab;
  counts: TabCounts;
  onChange: (next: ProfileTab) => void;
}) {
  const visible = visibleTabsFor(counts);
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {visible.map(tab => {
          const isActive = tab.key === active;
          const c = counts[tab.key];
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              style={[styles.pill, isActive && styles.pillActive]}
              android_ripple={{ color: COLORS.purpleDim }}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
              <Text style={[styles.count, isActive && styles.countActive]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.bg,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  row: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'transparent',
  },
  pillActive: {
    backgroundColor: COLORS.purple,
    borderColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  labelActive: { color: COLORS.white },
  count: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  countActive: { color: 'rgba(255,255,255,0.75)' },
});
