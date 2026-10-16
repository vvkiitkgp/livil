import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Dimensions } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import CoverFallback from './CoverFallback';
import { usePlayback } from '../contexts/PlaybackContext';
import { usePlayFullScreen } from '../hooks/usePlayFullScreen';
import { useOpenInSpotify } from '../hooks/useOpenInSpotify';
import { feedPostToNowPlaying, type FeedPost } from '../services/posts';
import { useSpotifyTrack } from '../services/spotify';
import { haptics } from '../utils/haptics';
import { SPOTIFY_GREEN } from './spotifyLogoArtwork';

// Same geometry as ProfileGridCard (Albums / Playlists): 2 columns, 16 px sides, 12 px gap,
// so every grid on a profile lines up.
const ART = Math.floor((Dimensions.get('window').width - 16 * 2 - 12) / 2);

function formatCount(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {return '';}
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) {return 'just now';}
  const m = Math.floor(diffSec / 60);
  if (m < 60) {return `${m}m ago`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h ago`;}
  const d = Math.floor(h / 24);
  if (d < 7) {return `${d}d ago`;}
  const w = Math.floor(d / 7);
  if (w < 4) {return `${w}w ago`;}
  const mo = Math.floor(d / 30);
  if (mo < 12) {return `${mo}mo ago`;}
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * One post in a profile's grid (Reposts / Uploads, 2 per row) — the card behind the
 * list/grid switch.
 *
 * Picture, title, one line under it. An upload can carry its song's TOTAL plays on the
 * picture (`plays`, from fetchTrackPlaysTotals); a repost never does — under someone else's
 * song a number reads as that song's plays, not the reposter's.
 *
 * A tap does what tapping a card's artwork does: plays the post from its clip and opens the
 * full-screen player (only opens it, when this post is already playing). The profile turns
 * its playable posts into the queue, as it does for the list.
 */
export default function PostGridCard({ post, plays }: { post: FeedPost; plays?: number | null }) {
  if (post.spotifyTrackId) {
    return <SpotifyGridCard spotifyTrackId={post.spotifyTrackId} />;
  }
  // The original upload was deleted (original_post_id set null): nothing left to play.
  if (post.kind === 'repost' && post.originalPostId === null) {
    return <RemovedOriginalCard />;
  }
  return <LivilGridCard post={post} plays={plays} />;
}

function LivilGridCard({ post, plays }: { post: FeedPost; plays?: number | null }) {
  const playback = usePlayback();
  const openFullScreen = usePlayFullScreen();
  const isVideo = post.track.mediaKind === 'video';
  const picture = isVideo ? (post.track.thumbnailUrl ?? post.track.coverArtUrl) : post.track.coverArtUrl;
  const subtitle = post.kind === 'repost'
    ? (post.originalAuthor?.displayName ?? post.originalAuthor?.username ?? '')
    : relativeTime(post.createdAt);

  const handlePress = useCallback(() => {
    haptics.tap();
    if (playback.activePostId === post.id) {
      openFullScreen();
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    if (playback.nowPlaying?.postId === post.id && playback.handlersRef.current) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current.seek(clipStart);
      playback.handlersRef.current.play();
    } else {
      playback.setNowPlaying(feedPostToNowPlaying(post));
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
    openFullScreen();
  }, [playback, post, openFullScreen]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Play ${post.track.title}`}
    >
      <View style={styles.art}>
        {picture ? (
          <Image source={{ uri: picture }} style={styles.artImage} resizeMode="cover" />
        ) : (
          <CoverFallback />
        )}
        {isVideo ? (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.videoBadgeText}>VIDEO</Text>
          </View>
        ) : null}
        {plays != null && plays > 0 ? (
          <View
            style={styles.playsChip}
            pointerEvents="none"
            accessibilityLabel={`${plays} ${plays === 1 ? 'play' : 'plays'}`}
          >
            <Icon name="play" size={10} color={COLORS.white} />
            <Text style={styles.playsText}>{formatCount(plays)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>{post.track.title}</Text>
      {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
    </Pressable>
  );
}

/**
 * Spotify's design rules apply to its artwork here as on the feed card (SpotifyPostCard):
 * full square, small corners, nothing drawn on it. A tap hands the song to Spotify.
 */
function SpotifyGridCard({ spotifyTrackId }: { spotifyTrackId: string }) {
  const meta = useSpotifyTrack(spotifyTrackId);
  const openSpotify = useOpenInSpotify('feed');
  const track = meta.status === 'ready' ? meta.track : null;
  const title = track ? track.title : meta.status === 'loading' ? ' ' : 'Song unavailable';
  const artist = track ? track.artists.join(', ') : ' ';

  return (
    <Pressable
      onPress={() => { void openSpotify(spotifyTrackId); }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={track ? `Open ${track.title} in Spotify` : 'Open in Spotify'}
    >
      <View style={[styles.art, styles.spotifyArt]}>
        {track?.imageUrl ? (
          <Image source={{ uri: track.imageUrl }} style={styles.artImage} resizeMode="cover" />
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{artist}</Text>
      <View style={styles.spotifyLine}>
        <View style={styles.spotifyDot} />
        <Text style={styles.spotifyText}>Plays on Spotify</Text>
      </View>
    </Pressable>
  );
}

function RemovedOriginalCard() {
  return (
    <View style={styles.card} accessible accessibilityLabel="The original upload was deleted">
      <View style={[styles.art, styles.removedArt]}>
        <Icon name="tombstone" size={26} color={COLORS.textMuted} />
        <Text style={styles.removedArtText}>No longer available</Text>
      </View>
      <Text style={[styles.title, styles.removedTitle]} numberOfLines={1}>Removed upload</Text>
      <Text style={[styles.subtitle, styles.removedSubtitle]} numberOfLines={1}>The original was deleted</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: ART },
  pressed: { opacity: 0.85 },
  art: {
    width: ART,
    height: ART,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    marginBottom: 8,
  },
  artImage: { width: '100%', height: '100%' },
  // Spotify: corners no rounder than 4 (its guidelines), and no fill of ours behind the art.
  spotifyArt: { borderRadius: 4, backgroundColor: COLORS.card },
  videoBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  videoBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  playsChip: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 7,
    paddingRight: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  playsText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  spotifyLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  spotifyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SPOTIFY_GREEN },
  spotifyText: { color: COLORS.textSecondary, fontSize: 11 },
  removedArt: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
  },
  removedArtText: { color: COLORS.textSecondary, fontSize: 12 },
  removedTitle: { color: COLORS.textSecondary },
  removedSubtitle: { color: COLORS.textMuted },
});
