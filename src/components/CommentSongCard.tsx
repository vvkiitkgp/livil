import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SpotifyLogo } from './SpotifyLogo';
import { usePlayback } from '../contexts/PlaybackContext';
import { useOpenInSpotify } from '../hooks/useOpenInSpotify';
import { fetchPostById, feedPostToNowPlaying, isPlayableInLivil, type FeedPost } from '../services/posts';
import { toShareablePost } from '../services/share';
import { artistLine, useSpotifyTrack } from '../services/spotify';
import type { CommentSong } from '../services/comments';

// Post id → the shared upload, or null when this viewer cannot see it. One lookup per post
// per app session however many comments share it; a failed lookup is not remembered.
const postCache = new Map<string, Promise<FeedPost | null>>();

function loadPost(postId: string): Promise<FeedPost | null> {
  let pending = postCache.get(postId);
  if (!pending) {
    pending = fetchPostById(postId).catch(() => {
      postCache.delete(postId);
      return null;
    });
    postCache.set(postId, pending);
  }
  return pending;
}

/** The composer already has the post it attached: its own card then draws without a fetch. */
export function primeCommentSongPost(post: FeedPost): void {
  postCache.set(post.id, Promise.resolve(post));
}

/** Test-only. */
export function __clearCommentSongCacheForTest(): void {
  postCache.clear();
}

type Shown = {
  source: 'livil' | 'spotify';
  title: string | null;
  artist: string | null;
  artUrl: string | null;
  loading: boolean;
};

/**
 * The song shared in a comment: one compact row — art, title, artist, where it plays.
 *
 * A Livil song plays right here, under the open comments, as a single-song queue; a second
 * tap pauses it. A Spotify song is handed to Spotify (useOpenInSpotify: Livil never plays
 * it). Art corners stay at 4 px with nothing drawn on them, Spotify's rule, kept for Livil
 * songs too so the two read alike — as in chat (ChatSongCard).
 *
 * When the song cannot be shown (hidden from this viewer, or gone), the comment's label line
 * stands in for it, so the comment still says what was shared.
 */
export default function CommentSongCard({ song, label }: { song: CommentSong; label: string | null }) {
  return song.kind === 'spotify'
    ? <SpotifySong trackId={song.trackId} label={label} />
    : <LivilSong postId={song.postId} label={label} />;
}

function LivilSong({ postId, label }: { postId: string; label: string | null }) {
  const playback = usePlayback();
  const { nowPlaying, activePostId, handlersRef, requestPlay, setNowPlaying, setQueue, markSeekTarget } = playback;
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setPost(undefined);
    loadPost(postId).then(found => { if (!cancelled) { setPost(found); } });
    return () => { cancelled = true; };
  }, [postId]);

  if (post === null || (post && !isPlayableInLivil(post))) {
    return <Fallback label={label} />;
  }

  const playing = activePostId === postId;
  const onPress = () => {
    if (!post) { return; }
    if (nowPlaying?.postId === postId && handlersRef.current) {
      // Already loaded: pause, or resume from where it stopped. Through the engine's own
      // handlers, as the floating player does — requestPlay alone only marks the post
      // active, and the engine (GlobalAudioPlayer) treats "active is the one I hold" as
      // already playing, so a paused song stayed silent while the card said playing
      // (owner report: paused by a Spotify hand-off, then tapped here).
      if (playing) { handlersRef.current.pause(); } else { handlersRef.current.play(); }
      return;
    }
    const item = feedPostToNowPlaying(post);
    // A song from a comment is one song, not the start of someone's feed: when it ends,
    // playback stops there instead of carrying on with whatever was queued before.
    setQueue([item], 0, 'comments');
    setNowPlaying(item);
    // Before requestPlay, so the engine starts at the top rather than wherever the
    // previous track had got to.
    markSeekTarget(post.clipStartSec ?? 0);
    requestPlay(item.postId);
  };

  const shareable = post ? toShareablePost(post) : null;
  return (
    <SongRow
      shown={{
        source: 'livil',
        title: shareable?.title ?? null,
        artist: shareable?.artistName ?? null,
        artUrl: shareable?.coverArtUrl ?? null,
        loading: post === undefined,
      }}
      action={playing ? 'pause' : 'play'}
      onPress={post ? onPress : undefined}
    />
  );
}

function SpotifySong({ trackId, label }: { trackId: string; label: string | null }) {
  // Comments sit under feed posts, so a hand-off from one counts as a feed open in the ops
  // play stats ('feed' | 'chat' | 'search' — spotify_opens_source_check).
  const openSpotify = useOpenInSpotify('feed');
  const meta = useSpotifyTrack(trackId);

  if (meta.status === 'unavailable') {
    return <Fallback label={label} />;
  }
  const track = meta.status === 'ready' ? meta.track : null;
  return (
    <SongRow
      shown={{
        source: 'spotify',
        title: track?.title ?? null,
        artist: track ? artistLine(track) : null,
        artUrl: track?.imageUrl ?? null,
        loading: meta.status === 'loading',
      }}
      action="spotify"
      onPress={() => { void openSpotify(trackId); }}
    />
  );
}

function SongRow({
  shown,
  action,
  onPress,
}: {
  shown: Shown;
  action: 'play' | 'pause' | 'spotify';
  onPress?: () => void;
}) {
  const where = shown.source === 'spotify' ? 'Spotify' : 'Livil';
  const a11y = action === 'pause'
    ? `Pause ${shown.title ?? 'the song'}`
    : `Play ${shown.title ?? 'the song'} on ${where}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID="comment-song-card"
    >
      {shown.artUrl ? (
        <Image source={{ uri: shown.artUrl }} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.artEmpty]}>
          {shown.loading
            ? <ActivityIndicator size="small" color={COLORS.purpleLight} />
            : <Icon name="musicNote" size={20} color={COLORS.textMuted} />}
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{shown.title ?? ' '}</Text>
        <Text style={styles.artist} numberOfLines={1}>{shown.artist ?? ' '}</Text>
        {shown.source === 'spotify' ? (
          <SpotifyLogo size="xs" withName style={styles.mark} />
        ) : (
          <View style={styles.mark} accessible accessibilityLabel="Livil">
            <View style={styles.livilMark}>
              <Logo size={30} color={COLORS.white} />
            </View>
          </View>
        )}
      </View>
      <View style={styles.action}>
        <Icon
          name={action === 'pause' ? 'pause' : 'play'}
          size={14}
          color={COLORS.purpleNeon}
          weight="fill"
        />
      </View>
    </Pressable>
  );
}

function Fallback({ label }: { label: string | null }) {
  if (!label) { return null; }
  return <Text style={styles.fallback} numberOfLines={2}>{label}</Text>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    maxWidth: 360,
    marginTop: 6,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  pressed: { opacity: 0.7 },
  art: { width: 56, height: 56, borderRadius: 4, backgroundColor: COLORS.card },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 13.5, fontWeight: '700' },
  artist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  mark: { marginTop: 4, alignSelf: 'flex-start' },
  // The pulse glyph is wide and short; in a box Spotify's xs logo's height, the two marks
  // sit at the same size.
  livilMark: { height: 21, justifyContent: 'center' },
  action: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
