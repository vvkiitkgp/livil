import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { fetchLikedPosts, createPlaylist, addPostToPlaylist, type PlaylistItem, type PlaylistVisibility } from '../../services/playlists';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import FeedEndMessage from '../../components/FeedEndMessage';
import VisibilitySelector from '../../components/VisibilitySelector';

type Props = NativeStackScreenProps<RootStackParamList, 'CreatePlaylist'>;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

type SuggestionItem = PlaylistItem & { isInitial?: boolean };

function SuggestionRow({
  item,
  index,
  selected,
  onToggle,
}: {
  item: SuggestionItem;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initials = item.title.trim().charAt(0).toUpperCase() || '♪';

  return (
    <View style={styles.suggRow}>
      <View style={[styles.cover, { backgroundColor: accents[0] }]}>
        <View style={[styles.coverAccent, { backgroundColor: accents[1] }]} />
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.coverInitial}>{initials}</Text>
        )}
      </View>

      <View style={styles.suggMeta}>
        <Text style={styles.suggTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.suggArtist} numberOfLines={1}>{item.artistName}</Text>
      </View>

      <TouchableOpacity
        style={[styles.addBtn, selected && styles.addBtnSelected]}
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        {selected ? <GradientBorder borderRadius={16} /> : null}
        <Icon
          name={selected ? 'check' : 'add'}
          size={16}
          color={selected ? COLORS.purpleNeon : COLORS.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
}

export default function CreatePlaylistScreen({ route }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const initialPost = route.params?.initialPost;

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<PlaylistVisibility>('public');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    initialPost ? new Set([initialPost.postId]) : new Set(),
  );
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLikedPosts(30)
      .then(posts => {
        if (cancelled) { return; }
        // Filter out the initialPost (we'll show it separately at the top)
        const filtered = posts.filter(p => p.postId !== initialPost?.postId);
        const items: SuggestionItem[] = initialPost
          ? [
              {
                postId: initialPost.postId,
                title: initialPost.title,
                artistName: initialPost.artistName,
                coverArtUrl: initialPost.coverArtUrl,
                thumbnailUrl: null,
                trackId: '',
                authorId: '',
                authorUsername: '',
                authorAvatarUrl: null,
                mediaKind: 'audio' as const,
                audioUrl: null,
                videoUrl: null,
                isInitial: true,
              },
              ...filtered,
            ]
          : filtered;
        setSuggestions(items);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setLoadingSuggestions(false); } });
    return () => { cancelled = true; };
  }, [initialPost?.postId]);

  const toggle = useCallback((postId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) { next.delete(postId); } else { next.add(postId); }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) { return; }
    setCreating(true);
    try {
      const playlist = await createPlaylist(trimmed, visibility);
      const toAdd = [...selectedIds];
      await Promise.all(toAdd.map(postId => addPostToPlaylist(playlist.id, postId)));
      navigation.goBack();
    } catch {
      // TODO: surface error to user
    } finally {
      setCreating(false);
    }
  }, [name, visibility, selectedIds, creating, navigation]);

  const canCreate = name.trim().length > 0;

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<SuggestionItem>) => (
    <SuggestionRow
      item={item}
      index={index}
      selected={selectedIds.has(item.postId)}
      onToggle={() => toggle(item.postId)}
    />
  ), [selectedIds, toggle]);

  const ListHeader = (
    <View>
      {/* Name input */}
      <View style={styles.nameSection}>
        <Text style={styles.nameLabel}>Playlist name</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Late night vibes"
          placeholderTextColor={COLORS.textMuted}
          autoFocus
          returnKeyType="done"
          maxLength={80}
        />
      </View>

      {/* Visibility */}
      <View style={styles.visSection}>
        <Text style={styles.nameLabel}>Visibility</Text>
        <VisibilitySelector value={visibility} onChange={setVisibility} />
      </View>

      {/* Suggestions header */}
      <View style={styles.suggHeader}>
        <Text style={styles.suggHeaderTitle}>
          {initialPost ? 'Add from Liked Songs' : 'Suggestions from Liked Songs'}
        </Text>
        {selectedIds.size > 0 && (
          <Text style={styles.suggHeaderCount}>{selectedIds.size} selected</Text>
        )}
      </View>

      {loadingSuggestions && (
        <ActivityIndicator color={COLORS.purpleLight} style={{ marginTop: 20 }} />
      )}

      {!loadingSuggestions && suggestions.length === 0 && (
        <Text style={styles.noSuggestions}>
          Like posts on the home feed — they'll appear here as suggestions.
        </Text>
      )}

      {/* "Currently playing" label for initialPost */}
      {initialPost && suggestions[0]?.isInitial && (
        <Text style={styles.nowPlayingLabel}>Currently playing</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="back" size={32} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Playlist</Text>
          <Button
            label="Create"
            onPress={handleCreate}
            variant="primary"
            size="sm"
            disabled={!canCreate}
            busy={creating}
            style={styles.createBtn}
          />
        </View>

        <FlatList
          data={loadingSuggestions ? [] : suggestions}
          keyExtractor={item => item.postId}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            !loadingSuggestions && suggestions.length > 0 ? (
              <FeedEndMessage
                title="That's the full crate"
                subtitle="Every track you’ve liked, ready to pick. Like more posts to grow the stash."
              />
            ) : null
          }
          contentContainerStyle={[styles.list, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.white, fontSize: 32, fontWeight: '300', lineHeight: 36 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  createBtn: {
    minWidth: 68,
  },

  list: { paddingBottom: 48 },

  nameSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  visSection: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  nameLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  nameInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '600',
  },

  suggHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 10,
  },
  suggHeaderTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  suggHeaderCount: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '600',
  },
  nowPlayingLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  noSuggestions: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  suggRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  coverAccent: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    bottom: -14,
    right: -14,
    opacity: 0.65,
  },
  coverInitial: { color: COLORS.white, fontSize: 20, fontWeight: '900' },

  suggMeta: { flex: 1, minWidth: 0 },
  suggTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  suggArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: COLORS.surface,
  },
  addBtnSelected: {
    borderColor: 'transparent',
  },
});
