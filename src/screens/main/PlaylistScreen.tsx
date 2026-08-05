import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { supabase } from '../../../lib/supabase';
import {
  fetchLikedPosts,
  fetchPlaylistPosts,
  type PlaylistItem,
  type PlaylistVisibility,
} from '../../services/playlists';
import { usePlayback, type NowPlayingInfo } from '../../contexts/PlaybackContext';
import DetailView, { type DetailTrack } from '../../components/DetailView';
import DetailActionSheet from '../../components/DetailActionSheet';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaylistDetail'>;

type PlaylistMeta = {
  name: string;
  ownerId: string;
  ownerHandle: string;
  ownerDisplayName: string | null;
  visibility: PlaylistVisibility | undefined; // undefined for the virtual "liked" playlist
  coverEmoji: string | null;
  coverColor: string | null;
  coverColor2: string | null;
};

export default function PlaylistScreen({ route }: Props) {
  const { playlistId, playlistName } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { nowPlaying, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer } = usePlayback();

  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [meta, setMeta] = useState<PlaylistMeta | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const auth = await supabase.auth.getUser();
      const me = auth.data.user?.id ?? null;
      setViewerId(me);

      if (playlistId === 'liked') {
        const data = await fetchLikedPosts();
        setItems(data);
        setMeta({
          name: 'Liked Songs',
          ownerId: me ?? '',
          ownerHandle: 'you',
          ownerDisplayName: null,
          visibility: undefined,
          coverEmoji: null,
          coverColor: null,
          coverColor2: null,
        });
      } else {
        const [posts, m] = await Promise.all([
          fetchPlaylistPosts(playlistId),
          supabase
            .from('playlists')
            .select(`
              name,
              visibility,
              cover_emoji,
              cover_color,
              cover_color_2,
              user_id,
              owner:profiles!playlists_user_id_fkey ( username, display_name )
            `)
            .eq('id', playlistId)
            .maybeSingle(),
        ]);
        setItems(posts);
        if (m.data) {
          const owner = (m.data.owner ?? null) as { username: string; display_name: string | null } | null;
          setMeta({
            name: m.data.name,
            ownerId: m.data.user_id,
            ownerHandle: owner?.username ?? 'unknown',
            ownerDisplayName: owner?.display_name ?? null,
            visibility: m.data.visibility,
            coverEmoji: m.data.cover_emoji,
            coverColor: m.data.cover_color,
            coverColor2: m.data.cover_color_2,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load playlist.');
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => { void load(); }, [load]);

  // Re-fetch whenever the screen regains focus so any edit (rename, cover
  // change, post removal) inside EditPlaylist shows up immediately on return.
  const mountedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mountedRef.current) { mountedRef.current = true; return; }
      void load();
    }, [load]),
  );

  const handleRefresh = useCallback(async () => {
    // Acknowledge the pull the moment it fires — the spinner is at the top
    // of the screen, often under the user's own thumb.
    haptics.select();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const startQueue = useCallback((startIdx: number, shuffle: boolean) => {
    if (items.length === 0) { return; }
    const toInfo = (item: PlaylistItem): NowPlayingInfo => ({
      postId: item.postId,
      trackId: item.trackId,
      title: item.title,
      artistName: item.artistName,
      authorId: item.authorId,
      authorUsername: item.authorUsername,
      authorAvatarUrl: item.authorAvatarUrl,
      coverArtUrl: item.coverArtUrl,
      thumbnailUrl: item.thumbnailUrl,
      mediaKind: item.mediaKind,
      audioUrl: item.audioUrl ?? undefined,
      videoUrl: item.videoUrl ?? undefined,
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      viewsCount: 0,
      viewerHasLiked: false,
      clipStartSec: null,
      clipEndSec: null,
      kind: 'upload',
      originalPostId: null,
      knownDurationSec: 0,
    });
    let queue = items.map(toInfo);
    let initialIdx = startIdx;
    if (shuffle) {
      queue = queue.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i]!, queue[j]!] = [queue[j]!, queue[i]!];
      }
      initialIdx = 0;
    }
    const label = playlistId === 'liked' ? 'playlist:Liked Songs' : `playlist:${meta?.name ?? playlistName}`;
    setQueue(queue, initialIdx, label);
    setNowPlaying(queue[initialIdx]!);
    requestPlay(queue[initialIdx]!.postId);
    openFullScreenPlayer();
  }, [items, playlistId, playlistName, meta?.name, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer]);

  const handlePressTrack = useCallback((idx: number) => { startQueue(idx, false); }, [startQueue]);
  const handlePlay = useCallback(() => { startQueue(0, false); }, [startQueue]);
  const handleShuffle = useCallback(() => { startQueue(0, true); }, [startQueue]);

  const handleOverflow = useCallback(() => { setActionSheetOpen(true); }, []);
  const goToEdit = useCallback(() => {
    if (playlistId === 'liked') { return; }
    navigation.navigate('EditPlaylist', { playlistId });
  }, [navigation, playlistId]);

  const handlePressOwner = useCallback(() => {
    if (!meta?.ownerId) { return; }
    navigation.navigate('UserProfile', { userId: meta.ownerId });
  }, [meta?.ownerId, navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOwner = !!viewerId && !!meta?.ownerId && viewerId === meta.ownerId;

  // Cover = first post's cover art
  const coverArtUrl = items.find(i => i.coverArtUrl)?.coverArtUrl ?? null;

  const detailTracks: DetailTrack[] = items.map(i => ({
    id: i.postId,
    title: i.title,
    subtitle: i.artistName,
    coverArtUrl: i.coverArtUrl,
    durationSec: null, // unused — playlist rows render poster avatar on the right
    posterAvatarUrl: i.authorAvatarUrl,
    posterName: i.artistName,
  }));

  return (
    <>
      <DetailView
        kind="playlist"
        title={meta?.name ?? playlistName}
        coverArtUrl={coverArtUrl}
        coverEmoji={meta?.coverEmoji}
        coverColor={meta?.coverColor}
        coverColor2={meta?.coverColor2}
        ownerHandle={meta?.ownerHandle ?? 'unknown'}
        ownerDisplayName={meta?.ownerDisplayName ?? null}
        isOwner={isOwner}
        visibility={meta?.visibility}
        countLabel={`${items.length} ${items.length === 1 ? 'post' : 'posts'}`}
        tracks={detailTracks}
        currentTrackId={nowPlaying?.postId ?? null}
        onBack={() => navigation.goBack()}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        onPressTrack={handlePressTrack}
        onPressOwner={handlePressOwner}
        onOverflow={isOwner && playlistId !== 'liked' ? handleOverflow : undefined}
        emptyTitle={playlistId === 'liked' ? 'No liked posts yet' : undefined}
        emptyBody={
          playlistId === 'liked'
            ? "Like posts from the home feed — they appear here automatically."
            : undefined
        }
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      <DetailActionSheet
        visible={actionSheetOpen}
        onClose={() => setActionSheetOpen(false)}
        actions={[
          { key: 'edit', label: 'Edit playlist', icon: 'edit', onPress: goToEdit },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  errorWrap: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center' },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center' },
});
