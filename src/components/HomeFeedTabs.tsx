import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import type { HomeFeedTab } from '../services/posts';

const TABS: { key: HomeFeedTab; label: string }[] = [
  { key: 'for_you', label: 'For you' },
  { key: 'new_on_livil', label: 'New on Livil' },
];

export const HOME_FEED_TABS_HEIGHT = 48;

/**
 * Home's "For you | New on Livil" switch (owner design 2026-10-14).
 *
 * Drawn twice by HomeScreen: in the list under the Friends stories, and as a pinned copy
 * at the top of the screen once that one scrolls away. Purely presentational so the two
 * can never disagree.
 *
 * `showNewDot` marks New on Livil when someone uploaded since the viewer last opened it.
 */
export function HomeFeedTabs({
  active,
  onSelect,
  showNewDot,
}: {
  active: HomeFeedTab;
  onSelect: (tab: HomeFeedTab) => void;
  showNewDot: boolean;
}) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {TABS.map(t => {
        const selected = t.key === active;
        const dot = t.key === 'new_on_livil' && showNewDot && !selected;
        return (
          <Pressable
            key={t.key}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            onPress={() => onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={dot ? `${t.label}, new songs` : t.label}
            testID={`home-tab-${t.key}`}
          >
            <View style={styles.labelRow}>
              <Text style={[styles.label, selected && styles.labelSelected]}>{t.label}</Text>
              {dot ? <View style={styles.dot} testID="home-tab-new-dot" /> : null}
            </View>
            <View style={[styles.underline, selected && styles.underlineSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: HOME_FEED_TABS_HEIGHT,
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPressed: {
    opacity: 0.7,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  labelSelected: {
    color: COLORS.white,
    fontWeight: '800',
  },
  // Absolutely placed so the selected tab's underline never shifts its label.
  underline: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineSelected: {
    backgroundColor: COLORS.purpleNeon,
  },
  // A small indicator: exempt from the no-solid-purple rule (CLAUDE.md, Buttons).
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.purpleNeon,
  },
});
