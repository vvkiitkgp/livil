import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import FormInput from './FormInput';
import { useToast } from '../contexts/ToastContext';
import { useJamSuggestions } from '../contexts/JamSuggestionsContext';
import { searchPosts, type FeedPost } from '../services/posts';
import type { JamSuggester, JamSuggestionGroup, SuggestionStatus } from '../services/jamSuggestions';

const FACE = 24;
const MAX_FACES = 4;

/** Overlapping profile-picture bubbles of who suggested a song, newest first. */
function FaceStack({ people }: { people: JamSuggester[] }) {
  const shown = people.slice(0, MAX_FACES);
  const extra = people.length - shown.length;
  return (
    <View style={styles.faces}>
      {shown.map((p, i) => (
        <View key={p.id} style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: MAX_FACES - i }]}>
          {p.avatarUrl ? (
            <Image source={{ uri: p.avatarUrl }} style={styles.faceImg} />
          ) : (
            <Text style={styles.faceInitial}>
              {(p.displayName || p.username).charAt(0).toUpperCase() || '♪'}
            </Text>
          )}
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.face, styles.faceOverlap, styles.faceMore]}>
          <Text style={styles.faceMoreText}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

function suggestedByLabel(people: JamSuggester[]): string {
  const names = people.map(p => p.displayName || `@${p.username}`);
  if (names.length === 1) { return `Suggested by ${names[0]}`; }
  if (names.length === 2) { return `Suggested by ${names[0]} and ${names[1]}`; }
  return `Suggested by ${names[0]} and ${names.length - 1} others`;
}

const STATUS_UI: Record<SuggestionStatus, { icon: IconName; label: string; color: string }> = {
  waiting: { icon: 'pending', label: 'Waiting', color: COLORS.textSecondary },
  queued: { icon: 'queue', label: 'In queue', color: COLORS.purpleLight },
  played: { icon: 'checkCircle', label: 'Played', color: COLORS.info },
};

function Cover({ post }: { post: FeedPost }) {
  const uri = post.track.coverArtUrl ?? post.track.thumbnailUrl ?? null;
  return uri ? (
    <Image source={{ uri }} style={styles.cover} />
  ) : (
    <View style={[styles.cover, styles.coverEmpty]}>
      <Icon name="musicNote" size={20} color={COLORS.textSecondary} />
    </View>
  );
}

/**
 * The jam's Suggests tab (ADR-0022/0023). Everyone sees every suggestion — grouped by
 * song, most-suggested first — with the faces of who suggested it. Only the HOST can act
 * (Play now / Add to queue / dismiss); a listener sees the song's status and, on tap, is
 * told only the host can play it. The search box finds any song: a listener suggests it,
 * the host can play or queue it straight away.
 */
export default function JamSuggestsTab({
  isHost,
  hostName,
  onListScroll,
}: {
  isHost: boolean;
  hostName: string;
  /** Scroll offset of the list, so the jam room can give it full height. */
  onListScroll?: (offsetY: number) => void;
}) {
  const { groups, suggest, playNow, addToQueue, dismiss } = useJamSuggestions();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FeedPost[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      searchPosts(q, { limit: 20 })
        .then(r => { if (!cancelled) { setResults(r); } })
        .catch(() => { if (!cancelled) { setResults([]); } })
        .finally(() => { if (!cancelled) { setSearching(false); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const onlyHost = useCallback(() => {
    showToast(`Only the jam host ${hostName} can play suggested songs`, { kind: 'info' });
  }, [hostName, showToast]);

  const asGroup = (post: FeedPost): JamSuggestionGroup =>
    groups.find(g => g.postId === post.id)
    ?? { postId: post.id, post, suggesters: [], status: 'waiting', latestAt: '' };

  const renderGroup = useCallback(({ item }: { item: JamSuggestionGroup }) => {
    const status = STATUS_UI[item.status];
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && !isHost && styles.rowPressed]}
        onPress={isHost ? undefined : onlyHost}
      >
        <Cover post={item.post} />
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>{item.post.track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{item.post.author.displayName || `@${item.post.author.username}`}</Text>
          <View style={styles.byRow}>
            <FaceStack people={item.suggesters} />
            <Text style={styles.byText} numberOfLines={1}>{suggestedByLabel(item.suggesters)}</Text>
          </View>
        </View>
        {isHost ? (
          <View style={styles.hostActions}>
            {item.status === 'played' ? (
              <View style={styles.status}>
                <Icon name={status.icon} size={14} color={status.color} />
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
            ) : (
              <>
                <Button label="Play" icon="play" size="sm" onPress={() => playNow(item)} />
                {item.status === 'waiting' ? (
                  <Button label="Queue" variant="secondary" size="sm" onPress={() => addToQueue(item)} />
                ) : null}
              </>
            )}
            <TouchableOpacity
              onPress={() => dismiss(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Remove suggestion"
            >
              <Icon name="close" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.status}>
            <Icon name={status.icon} size={14} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        )}
      </Pressable>
    );
  }, [isHost, onlyHost, playNow, addToQueue, dismiss]);

  const renderResult = useCallback(({ item }: { item: FeedPost }) => (
    <View style={styles.row}>
      <Cover post={item} />
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>{item.track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{item.author.displayName || `@${item.author.username}`}</Text>
      </View>
      {isHost ? (
        <View style={styles.hostActions}>
          <Button label="Play" icon="play" size="sm" onPress={() => { playNow(asGroup(item)); setQuery(''); }} />
          <Button label="Queue" variant="secondary" size="sm" onPress={() => { addToQueue(asGroup(item)); setQuery(''); }} />
        </View>
      ) : (
        <Button label="Suggest" icon="add" size="sm" onPress={() => { void suggest(item.id); setQuery(''); }} />
      )}
    </View>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [isHost, playNow, addToQueue, suggest, groups]);

  const empty = useMemo(() => (
    <View style={styles.empty}>
      <Icon name="musicNotes" size={32} color={COLORS.textMuted} />
      <Text style={styles.emptyTitle}>No suggestions yet</Text>
      <Text style={styles.emptyBody}>
        {isHost
          ? 'When listeners tap a song anywhere in Livil, it shows up here for you to play.'
          : `Tap any song in Livil, or search here, to suggest it to ${hostName}.`}
      </Text>
    </View>
  ), [isHost, hostName]);

  const showingSearch = query.trim().length > 0;

  return (
    <View style={styles.flex}>
      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={COLORS.textMuted} />
        <FormInput
          nativeID="jam-suggest-search"
          value={query}
          onChangeText={setQuery}
          placeholder={isHost ? 'Search songs to play' : 'Search songs to suggest'}
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="clear" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showingSearch ? (
        searching && results.length === 0 ? (
          <ActivityIndicator color={COLORS.purpleLight} style={styles.loader} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={p => p.id}
            renderItem={renderResult}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.noResults}>No songs found</Text>}
          />
        )
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.postId}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          onScroll={e => onListScroll?.(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={32}
          ListEmptyComponent={empty}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
  },
  searchInput: { flex: 1, color: COLORS.white, fontSize: 14, paddingVertical: 8 },
  loader: { marginTop: 24 },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 4 },
  noResults: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 24 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowPressed: { opacity: 0.6 },
  cover: { width: 48, height: 48, borderRadius: 8 },
  coverEmpty: { backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  artist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  byText: { color: COLORS.textSecondary, fontSize: 11, flexShrink: 1 },

  faces: { flexDirection: 'row', alignItems: 'center' },
  face: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    borderWidth: 1.5,
    borderColor: COLORS.bg,
    backgroundColor: COLORS.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceOverlap: { marginLeft: -8 },
  faceImg: { width: '100%', height: '100%' },
  faceInitial: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  faceMore: { backgroundColor: COLORS.surface },
  faceMoreText: { color: COLORS.textSecondary, fontSize: 9, fontWeight: '700' },

  hostActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },

  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
