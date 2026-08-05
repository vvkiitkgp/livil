import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { supabase } from '../../../lib/supabase';
import { fetchAlbumDetail, type AlbumDetail } from '../../services/albums';
import { usePlayback, type NowPlayingInfo } from '../../contexts/PlaybackContext';
import DetailView, { type DetailTrack } from '../../components/DetailView';
import DetailActionSheet from '../../components/DetailActionSheet';

type Props = NativeStackScreenProps<RootStackParamList, 'AlbumDetail'>;

export default function AlbumDetailScreen({ route }: Props) {
  const { albumId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { nowPlaying, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer } = usePlayback();

  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [data, auth] = await Promise.all([
        fetchAlbumDetail(albumId),
        supabase.auth.getUser(),
      ]);
      setAlbum(data);
      setViewerId(auth.data.user?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load album.');
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => { void load(); }, [load]);

  // Refresh when the screen regains focus (e.g. after returning from
  // EditAlbum where the user may have removed tracks, changed the cover,
  // or renamed the album). Skip the first focus — initial load already
  // covered it.
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

  const toNowPlaying = useCallback((t: AlbumDetail['tracks'][number], a: AlbumDetail): NowPlayingInfo => ({
    postId: t.trackId, // album rows aren't posts — use trackId so the engine can play & the player has a stable key
    trackId: t.trackId,
    title: t.title,
    artistName: a.uploaderDisplayName ?? a.uploaderUsername,
    authorId: a.uploaderId,
    authorUsername: a.uploaderUsername,
    authorAvatarUrl: a.uploaderAvatarUrl,
    coverArtUrl: t.coverArtUrl,
    thumbnailUrl: t.thumbnailUrl,
    mediaKind: t.mediaKind,
    audioUrl: t.audioUrl ?? undefined,
    videoUrl: t.videoUrl ?? undefined,
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    viewerHasLiked: false,
    clipStartSec: null,
    clipEndSec: null,
    kind: 'upload',
    originalPostId: null,
    knownDurationSec: t.durationSec ?? 0,
    // Stuff the album title into every queue item so the car HU shows it the
    // instant playback starts — no fetch latency. For non-album queues this
    // stays undefined and GlobalAudioPlayer's lazy fetch fills it in.
    albumTitle: a.title,
  }), []);

  const startQueue = useCallback((startIdx: number, shuffle: boolean) => {
    if (!album || album.tracks.length === 0) { return; }
    let ordered = album.tracks.map(t => toNowPlaying(t, album));
    let initialIdx = startIdx;
    if (shuffle) {
      // Fisher–Yates, then put the chosen start at index 0
      ordered = ordered.slice();
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i]!, ordered[j]!] = [ordered[j]!, ordered[i]!];
      }
      initialIdx = 0;
    }
    setQueue(ordered, initialIdx, `album:${album.title}`);
    setNowPlaying(ordered[initialIdx]!);
    requestPlay(ordered[initialIdx]!.postId);
    openFullScreenPlayer();
  }, [album, toNowPlaying, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer]);

  const handlePressTrack = useCallback((idx: number) => { startQueue(idx, false); }, [startQueue]);
  const handlePlay = useCallback(() => { startQueue(0, false); }, [startQueue]);
  const handleShuffle = useCallback(() => { startQueue(0, true); }, [startQueue]);

  const handleOverflow = useCallback(() => { setActionSheetOpen(true); }, []);
  const goToEdit = useCallback(() => {
    if (!album) { return; }
    navigation.navigate('EditAlbum', { albumId: album.id });
  }, [album, navigation]);

  const handlePressOwner = useCallback(() => {
    if (!album) { return; }
    navigation.navigate('UserProfile', { userId: album.uploaderId });
  }, [album, navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error || !album) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error || 'Album not found.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const detailTracks: DetailTrack[] = album.tracks.map(t => ({
    id: t.trackId,
    title: t.title,
    coverArtUrl: t.coverArtUrl,
    durationSec: t.durationSec,
  }));

  const isOwner = viewerId === album.uploaderId;

  return (
    <>
      <DetailView
        kind="album"
        title={album.title}
        coverArtUrl={album.coverArtUrl}
        ownerHandle={album.uploaderUsername}
        ownerDisplayName={album.uploaderDisplayName}
        isOwner={isOwner}
        releaseYear={album.releaseDate ? parseInt(album.releaseDate.slice(0, 4), 10) : null}
        countLabel={`${album.tracks.length} ${album.tracks.length === 1 ? 'track' : 'tracks'}`}
        totalDurationSec={album.totalDurationSec}
        tracks={detailTracks}
        currentTrackId={nowPlaying?.trackId ?? null}
        onBack={() => navigation.goBack()}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        onPressTrack={handlePressTrack}
        onPressOwner={handlePressOwner}
        onOverflow={isOwner ? handleOverflow : undefined}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      <DetailActionSheet
        visible={actionSheetOpen}
        onClose={() => setActionSheetOpen(false)}
        actions={[
          { key: 'edit', label: 'Edit album', icon: 'edit', onPress: goToEdit },
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
