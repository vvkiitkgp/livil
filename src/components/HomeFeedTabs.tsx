import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import type { HomeFeedTab } from '../services/posts';

const PILL_HIT_SLOP = { top: 6, bottom: 6, left: 3, right: 3 };

const TABS: { key: HomeFeedTab; label: string }[] = [
  { key: 'for_you', label: 'For you' },
  // Shown as "Indie Vibes" since 2026-10-18 (owner); the key and the RPC keep the old name.
  { key: 'new_on_livil', label: 'Indie Vibes' },
];

/**
 * Home's "For you | New on Livil" switch (owner design 2026-10-14), as two pills: the open
 * feed wears the `selected` glow, the other a quiet outline (Button, never a purple fill).
 * No bar behind them — only the pills carry a background (`onMedia`'s opaque fill), so the
 * pinned copy floats over the feed instead of covering a strip of it.
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
          <View key={t.key} style={styles.pillSlot} testID={`home-tab-${t.key}`}>
            <Button
              label={t.label}
              size="sm"
              variant={selected ? 'selected' : 'secondary'}
              onPress={() => onSelect(t.key)}
              // HomeScreen fires the tab-switch haptic itself.
              haptic="none"
              // Opaque near-black fill: the pinned copy floats over posts and artwork.
              onMedia
              // The pill reads ~40pt tall; this makes the touch target 52pt without
              // making it look bigger. Sideways only as far as half the gap between pills,
              // so a tap there can never land on the wrong one.
              hitSlop={PILL_HIT_SLOP}
              style={styles.pill}
              labelStyle={styles.pillLabel}
              accessibilityLabel={`${t.label}${selected ? ', selected' : ''}${dot ? ', new songs' : ''}`}
            />
            {/* A small indicator: exempt from the no-solid-purple rule (CLAUDE.md, Buttons). */}
            {dot ? <View style={styles.dot} testID="home-tab-new-dot" pointerEvents="none" /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // The bar's own padding is the slots' padding taken off, so the pills sit where they did.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 17,
    paddingVertical: 2,
  },
  // Exactly PILL_HIT_SLOP of room around each pill. Android only delivers a touch to a view
  // inside its parent's bounds, so the slop must lie within the slot; it is also where the
  // dot sits on the pill's corner (Android clips a child that overhangs its parent).
  pillSlot: {
    paddingVertical: PILL_HIT_SLOP.top,
    paddingHorizontal: PILL_HIT_SLOP.left,
  },
  // Bigger than Button's `sm` (owner request), keeping its full pill radius — `md` would
  // square the corners off.
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  pillLabel: {
    fontSize: 15,
  },
  // On the pill's top-right edge, ringed in the page colour so it reads as a badge.
  dot: {
    position: 'absolute',
    top: PILL_HIT_SLOP.top - 3,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.bg,
    backgroundColor: COLORS.purpleNeon,
  },
});
