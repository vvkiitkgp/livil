import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import CoverFallback from './CoverFallback';
import { usePlayback } from '../contexts/PlaybackContext';
import { useRelationships } from '../contexts/RelationshipContext';
import { usePlayFullScreen } from '../hooks/usePlayFullScreen';
import { useOpenInSpotify } from '../hooks/useOpenInSpotify';
import { usePostLike } from '../hooks/usePostLike';
import type { RootStackParamList } from '../navigation/types';
import { feedPostToNowPlaying, type FeedPost } from '../services/posts';
import { useSpotifyTrack } from '../services/spotify';
import { haptics } from '../utils/haptics';
import { relativeTimeAgo } from '../utils/commentTime';
import { SPOTIFY_GREEN } from './spotifyLogoArtwork';
import { SpotifyLogo } from './SpotifyLogo';

// Same geometry as ProfileGridCard (Albums / Playlists): 2 columns, 16 px sides, 12 px gap,
// so every grid on a profile lines up.
const ART = Math.floor((Dimensions.get('window').width - 16 * 2 - 12) / 2);

// The two lines of text are ~35 pt tall. The slop takes the gap above them (empty, under the
// picture) and part of the gap to the next row, without reaching the picture itself.
const DETAILS_HIT_SLOP = { top: 8, bottom: 8 };

function formatCount(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * One post in a profile's grid (Reposts / Uploads, 2 per row) — the card behind the
 * list/grid switch.
 *
 * Two tap zones: the picture is the song, the details under it are the post, which opens on
 * its own page. For a repost that page is the only way from the grid to its own likes and
 * comments, because the player shows the ORIGINAL upload's.
 *
 * The picture carries the post's own likes. An upload's can also carry its song's TOTAL plays
 * (`plays`, from fetchTrackPlaysTotals); a repost's never does — under someone else's song,
 * that number reads as the song's plays, not the reposter's.
 *
 * Playing does what tapping a card's artwork does: plays the post from its clip and opens the
 * full-screen player (only opens it, when this post is already playing). The profile turns
 * its playable posts into the queue, as it does for the list.
 */
export default function PostGridCard({ post, plays }: { post: FeedPost; plays?: number | null }) {
  if (post.spotifyTrackId) {
    return <SpotifyGridCard post={post} spotifyTrackId={post.spotifyTrackId} />;
  }
  // The original upload was deleted (original_post_id set null): nothing left to play.
  if (post.kind === 'repost' && post.originalPostId === null) {
    return <RemovedOriginalCard />;
  }
  return <LivilGridCard post={post} plays={plays} />;
}

function useOpenPost(postId: string) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(() => {
    haptics.tap();
    navigation.navigate('PostDetail', { postId });
  }, [navigation, postId]);
}

function likesLabel(count: number): string {
  return `${count} ${count === 1 ? 'like' : 'likes'}`;
}

/** Read-only: it takes no touches, so a tap on it is a tap on the cover. */
function LikesChip({ count }: { count: number }) {
  return (
    <View style={styles.likesChip} pointerEvents="none">
      <Icon name="heart" size={15} color={COLORS.white} weight="fill" />
      <Text style={styles.likesText}>{formatCount(count)}</Text>
    </View>
  );
}

/** The post half of a card: its details, and an arrow that says they open. */
function PostDetailsLink({ label, onPress, children }: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={DETAILS_HIT_SLOP}
      style={({ pressed }) => [styles.details, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.detailsText}>{children}</View>
      <Icon name="disclosure" size={16} color={COLORS.textSecondary} />
    </Pressable>
  );
}

function LivilGridCard({ post, plays }: { post: FeedPost; plays?: number | null }) {
  const playback = usePlayback();
  const openFullScreen = usePlayFullScreen();
  const openPost = useOpenPost(post.id);
  // The shared tally, so a like on the post's page shows here on the way back.
  const { likesCount } = usePostLike(post);
  const isVideo = post.track.mediaKind === 'video';
  const picture = isVideo ? (post.track.thumbnailUrl ?? post.track.coverArtUrl) : post.track.coverArtUrl;
  const isRepost = post.kind === 'repost';
  const subtitle = isRepost
    ? (post.originalAuthor?.displayName ?? post.originalAuthor?.username ?? '')
    : relativeTimeAgo(post.createdAt);
  const shownPlays = !isRepost && plays != null && plays > 0 ? plays : 0;

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
    <View style={styles.card}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel={[
          `Play ${post.track.title}`,
          shownPlays > 0 && `${shownPlays} ${shownPlays === 1 ? 'play' : 'plays'}`,
          likesCount > 0 && likesLabel(likesCount),
        ].filter(Boolean).join(', ')}
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
          {shownPlays > 0 ? (
            <View style={styles.playsChip} pointerEvents="none">
              <Icon name="play" size={10} color={COLORS.white} />
              <Text style={styles.playsText}>{formatCount(shownPlays)}</Text>
            </View>
          ) : null}
          {likesCount > 0 ? <LikesChip count={likesCount} /> : null}
        </View>
      </Pressable>
      <PostDetailsLink label={`Open the post for ${post.track.title}`} onPress={openPost}>
        <Text style={styles.title} numberOfLines={1}>{post.track.title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </PostDetailsLink>
    </View>
  );
}

/**
 * Spotify's design rules apply to its artwork here as on the feed card (SpotifyPostCard):
 * full square, small corners, nothing drawn on it — except the likes, the owner's deliberate
 * exception to "artwork unaltered" (ADR-0027). A tap on the artwork hands the song to Spotify;
 * a tap on the details opens the post.
 */
function SpotifyGridCard({ post, spotifyTrackId }: { post: FeedPost; spotifyTrackId: string }) {
  const meta = useSpotifyTrack(spotifyTrackId);
  const openSpotify = useOpenInSpotify('feed');
  const openPost = useOpenPost(post.id);
  const { likesCount } = usePostLike(post);
  // Someone else's grid: the hand-off is followed by the "come back and like or comment"
  // card (spotifyReturnNudge). Your own grid is not.
  const { meId } = useRelationships();
  const nudge = meId && meId !== post.author.id
    ? { spotifyTrackId, postId: post.id, authorName: post.author.displayName ?? post.author.username }
    : undefined;
  const track = meta.status === 'ready' ? meta.track : null;
  const title = track ? track.title : meta.status === 'loading' ? ' ' : "Song didn't load";
  const artist = track ? track.artists.join(', ') : ' ';

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => { void openSpotify(spotifyTrackId, nudge); }}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel={`${track ? `Open ${track.title} in Spotify` : 'Open in Spotify'}${likesCount > 0 ? `, ${likesLabel(likesCount)}` : ''}`}
      >
        <View style={[styles.art, styles.spotifyArt, meta.status === 'unavailable' && styles.spotifyArtFallback]}>
          {track?.imageUrl ? (
            <Image source={{ uri: track.imageUrl }} style={styles.artImage} resizeMode="cover" />
          ) : meta.status === 'unavailable' ? (
            // The lookup failed: the Spotify mark says where a tap goes (as on SpotifyPostCard),
            // on near-black because Spotify Green may only sit on black or white.
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <SpotifyLogo size="lg" />
            </View>
          ) : null}
          {likesCount > 0 ? <LikesChip count={likesCount} /> : null}
        </View>
      </Pressable>
      <PostDetailsLink label={`Open the post${track ? ` for ${track.title}` : ''}`} onPress={openPost}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{artist}</Text>
        <View style={styles.spotifyLine}>
          <View style={styles.spotifyDot} />
          <Text style={styles.spotifyText} numberOfLines={1}>Plays on Spotify</Text>
        </View>
      </PostDetailsLink>
    </View>
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

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={[styles.art, styles.skeletonArt]} />
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={[styles.skeletonLine, styles.skeletonSubtitle]} />
    </View>
  );
}

/** The grid's counterpart to PostCardSkeleton: two rows of cards, while the next page loads. */
export function PostGridSkeleton() {
  return (
    <>
      {[0, 1].map(row => (
        <View key={row} style={styles.skeletonRow}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ))}
    </>
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
  spotifyArtFallback: { backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
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
  likesChip: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  likesText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailsText: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  spotifyLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  spotifyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SPOTIFY_GREEN },
  spotifyText: { color: COLORS.textSecondary, fontSize: 11, flexShrink: 1 },
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
  // Same spacing as the profile's grid rows, so the real cards land where these sat.
  skeletonRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  skeletonArt: { backgroundColor: COLORS.border },
  skeletonLine: { borderRadius: 6, backgroundColor: COLORS.border },
  skeletonTitle: { width: '72%', height: 12, marginTop: 3 },
  skeletonSubtitle: { width: '46%', height: 10, marginTop: 8 },
});
