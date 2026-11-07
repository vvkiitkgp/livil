import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { COLORS } from '../theme/colors';
import FormInput from './FormInput';
import { Icon } from './Icon';
import SheetModal, { SheetFlatList } from './SheetModal';
import { chunk, EMOJI_CATEGORIES, searchEmojis } from '../utils/emojiData';
import { getRecentReactions, noteRecentReaction } from '../services/recentReactions';

const COLUMNS = 6;
const RECENT_TAB = 'recent';
/** Share of the window. One resting height, so the category tabs at the bottom are always on screen. */
const BODY_SHARE = 0.66;

type Row =
  | { key: string; title: string }
  | { key: string; note: string }
  | { key: string; emojis: string[] };

/** Titled rows of emoji, flat, for one list. */
function section(title: string, emojis: readonly string[]): Row[] {
  if (emojis.length === 0) { return []; }
  return [
    { key: `title-${title}`, title },
    ...chunk(emojis, COLUMNS).map((row, i) => ({ key: `${title}-${i}`, emojis: row })),
  ];
}

/**
 * Every reaction, from the "+" in the long-press menu: a search, then "Your Reactions" and
 * "Recent", or one category picked from the tabs at the bottom.
 */
export default function ReactionEmojiSheet({
  visible,
  quickReactions,
  onPick,
  onClose,
}: {
  visible: boolean;
  quickReactions: readonly string[];
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(RECENT_TAB);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) { return; }
    setQuery('');
    setTab(RECENT_TAB);
    let alive = true;
    void getRecentReactions().then(saved => { if (alive) { setRecent(saved); } });
    return () => { alive = false; };
  }, [visible]);

  const rows = useMemo<Row[]>(() => {
    if (query.trim()) {
      const found = searchEmojis(query);
      return found.length > 0
        ? chunk(found, COLUMNS).map((row, i) => ({ key: `found-${i}`, emojis: row }))
        // At the top, never centred: the keyboard covers the middle of the sheet.
        : [{ key: 'none', note: 'No emoji found' }];
    }
    if (tab === RECENT_TAB) {
      return [...section('Your Reactions', quickReactions), ...section('Recent', recent)];
    }
    const category = EMOJI_CATEGORIES.find(c => c.key === tab);
    return category ? section(category.label, category.emojis.map(e => e.char)) : [];
  }, [query, tab, quickReactions, recent]);

  const pick = useCallback((emoji: string) => {
    void noteRecentReaction(emoji);
    onPick(emoji);
  }, [onPick]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if ('title' in item) { return <Text style={styles.title}>{item.title}</Text>; }
    if ('note' in item) { return <Text style={styles.note}>{item.note}</Text>; }
    return (
      <View style={styles.emojiRow}>
        {item.emojis.map(emoji => (
          <Pressable
            key={emoji}
            onPress={() => pick(emoji)}
            accessibilityRole="button"
            accessibilityLabel={`React with ${emoji}`}
            style={({ pressed }) => [styles.emojiCell, pressed && styles.pressed]}
          >
            <Text style={styles.emoji} allowFontScaling={false}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
    );
  }, [pick]);

  return (
    <SheetModal visible={visible} onClose={onClose} fit keyboardAware header={null}>
      <View style={[styles.body, { height: Math.round(windowHeight * BODY_SHARE) }]}>
        <FormInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          leading={(
            <View style={styles.searchIcon}>
              <Icon name="search" size={18} color={COLORS.textMuted} />
            </View>
          )}
          wrapperStyle={styles.search}
          style={styles.searchInput}
        />
        <SheetFlatList
          style={styles.list}
          data={rows}
          keyExtractor={item => item.key}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={14}
          contentContainerStyle={styles.listContent}
        />
        {query.trim() ? null : (
          <View style={styles.tabs}>
            {[{ key: RECENT_TAB, label: 'Recent', icon: 'recent' as const }, ...EMOJI_CATEGORIES].map(c => (
              <Pressable
                key={c.key}
                onPress={() => setTab(c.key)}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                accessibilityState={{ selected: tab === c.key }}
                style={[styles.tab, tab === c.key && styles.tabActive]}
              >
                <Icon name={c.icon} size={20} color={tab === c.key ? COLORS.white : COLORS.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1, paddingBottom: 8 },
  search: { marginHorizontal: 12, marginTop: 4, marginBottom: 6, borderRadius: 22 },
  searchIcon: { marginLeft: 14, marginRight: 8 },
  searchInput: { paddingVertical: 10 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 12 },
  title: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingTop: 14,
    paddingBottom: 6,
  },
  note: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 24,
  },
  emojiRow: { flexDirection: 'row' },
  emojiCell: {
    width: `${100 / COLUMNS}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full width, so a wide glyph is never cut at its measured edge.
  emoji: { width: '100%', textAlign: 'center', fontSize: 46, lineHeight: 56 },
  pressed: { opacity: 0.6 },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  tab: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: COLORS.purpleDim },
});
