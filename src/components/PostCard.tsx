import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from './MediaPlayer';
import ClipRangeSlider from './ClipRangeSlider';
import TrackContextMenu from './TrackContextMenu';
import type { FeedPost } from '../services/posts';
import { recordView, toggleLike } from '../services/posts';
import type { RootStackParamList } from '../navigation/types';
import AddBadge from './AddBadge';

export type PostCardProps = {
  post: FeedPost;
  /** Visibility from the parent FlatList — feeds MediaPlayer's debounced off-screen
   *  pause and drives the dedup'd view count after a brief dwell. */
  visible: boolean;
  /**
   * When false, playback is not auto-paused from FlatList viewability (Home feed).
   * Profile / single-column feeds should keep the default true.
   */
  pauseWhenOffScreen?: boolean;
};

function formatCount(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {return '0:00';}
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {return '';}
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) {return `${diffSec}s`;}
  const m = Math.floor(diffSec / 60);
  if (m < 60) {return `${m}m`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h`;}
  const d = Math.floor(h / 24);
  if (d < 7) {return `${d}d`;}
  const w = Math.floor(d / 7);
  if (w < 4) {return `${w}w`;}
  const mo = Math.floor(d / 30);
  if (mo < 12) {return `${mo}mo`;}
  return `${Math.floor(d / 365)}y`;
}

function avatarInitials(author: { displayName: string | null; username: string }): string {
  const name = author.displayName?.trim() || author.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {return '?';}
  if (parts.length === 1) {return parts[0]!.slice(0, 2).toUpperCase();}
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function pickMediaShape(track: FeedPost['track']): MediaShape | null {
  if (track.mediaKind === 'video') {
    if (!track.videoUrl) {return null;}
    return { kind: 'video', videoUrl: track.videoUrl };
  }
  if (!track.audioUrl) {return null;}
  return { kind: 'audio', audioUrl: track.audioUrl, coverUrl: track.coverArtUrl };
}

export default function PostCard({ post, visible, pauseWhenOffScreen = true }: PostCardProps) {
  const playback = usePlayback();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const playerRef = useRef<MediaPlayerHandle>(null);

  const openAuthor = useCallback((authorId: string) => {
    navigation.navigate('UserProfile', { userId: authorId });
  }, [navigation]);

  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [rate, setRate] = useState(1.0);

  // Prevents firing clip-end stop more than once per play session.
  const clipEndFiredRef = useRef(false);
  useEffect(() => {
    if (!paused) { clipEndFiredRef.current = false; }
  }, [paused]);

  // Engagement state (optimistic).
  const [liked, setLiked] = useState(post.viewerHasLiked);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [viewsCount, setViewsCount] = useState(post.viewsCount);
  const [viewRecorded, setViewRecorded] = useState(false);

  const [contextMenuVisible, setContextMenuVisible] = useState(false);

  const trackInfoForMenu = useMemo((): NowPlayingInfo => {
    const displayAuthor = (post.kind === 'repost' && post.originalAuthor) ? post.originalAuthor : post.author;
    return {
      postId: post.id,
      trackId: post.track.id,
      title: post.track.title,
      artistName: displayAuthor.displayName ?? displayAuthor.username,
      authorId: displayAuthor.id,
      authorUsername: displayAuthor.username,
      authorAvatarUrl: displayAuthor.avatarUrl,
      coverArtUrl: post.track.coverArtUrl,
      mediaKind: post.track.mediaKind,
      audioUrl: post.track.audioUrl ?? undefined,
      videoUrl: post.track.videoUrl ?? undefined,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      repostsCount: post.repostsCount,
      viewsCount: post.viewsCount,
      viewerHasLiked: post.viewerHasLiked,
      clipStartSec: post.clipStartSec,
      clipEndSec: post.clipEndSec,
      kind: post.kind,
      originalPostId: post.originalPostId,
      knownDurationSec: 0,
    };
  }, [post]);

  const media = pickMediaShape(post.track);

  // If the global active id changes to anything other than ours, pause ourselves.
  useEffect(() => {
    if (playback.activePostId !== post.id) {
      setPaused(true);
    }
  }, [playback.activePostId, post.id]);

  // Auto-start when the global queue navigation lands on this post.
  // Skip when FullScreenPlayer is open AND the track is video — FS has its own
  // <Video> for video tracks and PostCard registering handlers would overwrite
  // the FS handlers. For audio tracks, PostCard must still play since FS just
  // shows cover art and relies on PostCard's <Video> for audio output.
  useEffect(() => {
    if (playback.pendingPlayId === post.id) {
      const isVideoAndFsOpen = playback.isFullScreenOpen && post.track.mediaKind === 'video';
      if (!isVideoAndFsOpen) {
        setPaused(false);
      } else {
        console.log(`[LIVIL][PC] skipping auto-play: FS is open for video, postId=${post.id}`);
      }
      playback.clearPendingPlay();
    }
  // clearPendingPlay is stable (useCallback []); safe to use instead of full playback object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.pendingPlayId, post.id, playback.clearPendingPlay, playback.isFullScreenOpen, post.track.mediaKind]);

  // Register / update handlers whenever paused state changes.
  // Use stable method refs (not the full `playback` object) to prevent a render
  // loop: calling setNowPlaying changes nowPlaying → changes playback → re-runs
  // this effect → calls setNowPlaying again → ∞
  useEffect(() => {
    if (!paused) {
      // For reposts, show the original creator's info in the full-screen player,
      // not the reposter's.
      const displayAuthor = (post.kind === 'repost' && post.originalAuthor)
        ? post.originalAuthor
        : post.author;
      playback.setNowPlaying({
        postId: post.id,
        trackId: post.track.id,
        title: post.track.title,
        artistName: displayAuthor.displayName ?? displayAuthor.username,
        authorId: displayAuthor.id,
        authorUsername: displayAuthor.username,
        authorAvatarUrl: displayAuthor.avatarUrl,
        coverArtUrl: post.track.coverArtUrl,
        mediaKind: post.track.mediaKind,
        videoUrl: post.track.videoUrl ?? undefined,
        // Snapshot at play-start — not in deps to avoid resetting positionRef on like/unlike.
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        repostsCount: post.repostsCount,
        viewsCount: post.viewsCount,
        viewerHasLiked: post.viewerHasLiked,
        clipStartSec: post.clipStartSec,
        clipEndSec: post.clipEndSec,
        kind: post.kind,
        originalPostId: post.originalPostId,
        knownDurationSec: duration,
      });
      console.log(`[LIVIL][PC] registering handlers for postId=${post.id}`);
      playback.registerHandlers({
        play: () => { console.log(`[LIVIL][PC] handler PLAY postId=${post.id}`); setPaused(false); },
        pause: () => { console.log(`[LIVIL][PC] handler PAUSE postId=${post.id}`); setPaused(true); },
        seek: (s: number) => {
          console.log(`[LIVIL][PC] handler SEEK to=${s.toFixed(1)}s`);
          setSeekTo(s);
          setTimeout(() => setSeekTo(null), 0);
        },
        setRate: (r: number) => setRate(r),
      });
      // Seek the MediaPlayer to the correct start position. setNowPlaying (above)
      // resets positionRef to clipStart or 0, but the ExoPlayer instance may still
      // be at a stale position from a previous play session (e.g. the user seeked
      // to 29.7s, paused, played another track, then auto-advanced back).
      // Use playerRef.current?.seek() directly — setSeekTo(0) + setTimeout(null)
      // gets swallowed by React 19 batching and the effect never fires.
      const startPos = playback.positionRef.current;
      console.log(`[LIVIL][PC] seeking to startPos=${startPos.toFixed(1)}s`);
      playerRef.current?.seek(Math.max(0, startPos));
    }
    // Do not clear nowPlaying on pause — the mini-player stays visible.
  // Primitive deps only; object deps (post.author) replaced with their primitive
  // fields so a new post object reference alone does not re-trigger the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paused,
    post.id,
    post.kind,
    post.track.title,
    post.author.displayName,
    post.author.username,
    post.track.id,
    post.track.coverArtUrl,
    post.track.mediaKind,
    post.track.videoUrl,
    post.author.id,
    post.author.avatarUrl,
    post.originalAuthor?.id,
    post.originalAuthor?.username,
    post.originalAuthor?.displayName,
    post.originalAuthor?.avatarUrl,
    post.clipStartSec,
    post.clipEndSec,
    playback.setNowPlaying,    // stable useCallback []
    playback.registerHandlers, // stable useCallback []
  ]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      playback.unregisterHandlers();
      if (playback.isActive(post.id)) { playback.clearNowPlaying(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Record a view after the post has been visible for ~2s, once per session.
  useEffect(() => {
    if (!visible || viewRecorded) {return;}
    const t = setTimeout(() => {
      setViewRecorded(true);
      setViewsCount(v => v + 1);
      recordView(post.id).catch(() => {
        // Already-viewed conflict is fine; any other error we silently swallow
        // to avoid spamming the UI. The view count on next refresh will reflect truth.
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [visible, viewRecorded, post.id]);

  const handleTogglePaused = useCallback(() => {
    setPaused(prev => {
      const next = !prev;
      // Starting playback: jump to clip start so every play begins at the
      // post's chosen clip window, regardless of where the user last paused.
      if (!next) {
        const start = post.clipStartSec ?? 0;
        playerRef.current?.seek(start);
        setPosition(start);
        clipEndFiredRef.current = false;
      }
      return next;
    });
  }, [post.clipStartSec]);

  const handleProgress = useCallback((seconds: number) => {
    setPosition(seconds);
    // Only update the global position when this PostCard is the active player.
    // Without this guard, a pausing PostCard's final onProgress fires AFTER
    // setNowPlaying reset positionRef to 0 for the new track, overwriting it
    // with the old track's position — causing the new track to seek mid-song.
    if (playback.isActive(post.id)) {
      playback.updatePosition(seconds);
    }
    const cw = playback.clipWindowRef.current;
    // Only trigger clip-end advance when this PostCard is the active player.
    // Without this guard, a freshly-started PostCard whose first onProgress
    // fires before clipWindowRef resets can read stale clip bounds from the
    // PREVIOUS track and immediately call playNext(), double-advancing.
    if (cw && seconds >= cw.end && !clipEndFiredRef.current && playback.isActive(post.id)) {
      clipEndFiredRef.current = true;
      if (playback.repeatMode === 'one') {
        // Loop single: jump back to clip start and keep playing.
        playerRef.current?.seek(cw.start);
        setPosition(cw.start);
        // Re-arm after the seek settles so the next loop is detected correctly.
        setTimeout(() => { clipEndFiredRef.current = false; }, 300);
      } else {
        // off / all: advance the queue. playNext() wraps around in 'all' mode
        // and does nothing (stops) in 'off' mode once the queue is exhausted.
        setPaused(true);
        setPosition(cw.start);
        playback.playNext();
      }
    }
  }, [playback, post.id]);

  const handleLoaded = useCallback((seconds: number) => {
    setDuration(seconds);
    playback.updateDuration(seconds);
    // Seek to clip start when the media first loads. Use the native ref directly
    // to avoid the React state cycle (setSeekTo → effect → seek) which can fire
    // after the first video frame has already rendered at position 0.
    const cw = playback.clipWindowRef.current;
    if (cw && cw.start > 0) {
      playerRef.current?.seek(cw.start);
      setPosition(cw.start);
    }
  }, [playback]);

  const handleEnded = useCallback(() => {
    if (playback.repeatMode === 'one') {
      // Loop single, no active clip: restart from the beginning and keep playing.
      setPosition(0);
      setSeekTo(0);
      setTimeout(() => setSeekTo(null), 0);
    } else {
      // off / all: advance the queue. playNext() wraps in 'all' and stops in 'off'.
      setPaused(true);
      setPosition(0);
      playback.playNext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.repeatMode, playback.playNext]);

  // Seek handle on the PostCard's read-only slider — lets users scrub the song
  // without moving the clip boundary handles.
  const handlePostSeekEnd = useCallback((s: number) => {
    setPosition(s);
    setSeekTo(s);
    setTimeout(() => setSeekTo(null), 0);
  }, []);

  const handleToggleLike = useCallback(async () => {
    // Optimistic update — flip immediately, revert on failure.
    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    setLiked(nextLiked);
    setLikesCount(prevCount + (nextLiked ? 1 : -1));
    try {
      const serverLiked = await toggleLike(post.id);
      if (serverLiked !== nextLiked) {
        // Server disagreed (rare race) — trust the server.
        setLiked(serverLiked);
        setLikesCount(prevCount + (serverLiked ? 1 : 0));
      }
    } catch {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, post.id]);

  const headerAuthor = post.author;
  const isRepost = post.kind === 'repost' && post.originalAuthor != null;

  const initials = useMemo(() => avatarInitials(headerAuthor), [headerAuthor]);

  return (
    <View style={styles.card}>
      {/* Repost banner sits above everything when this post is a repost. */}
      {isRepost ? (
        <View style={styles.repostBanner}>
          <Text style={styles.repostBannerIcon}>↻</Text>
          <Text style={styles.repostBannerText} numberOfLines={1}>
            <Text
              style={styles.repostBannerName}
              onPress={() => openAuthor(headerAuthor.id)}
            >
              {headerAuthor.displayName ?? headerAuthor.username}
            </Text>
            {' reposted from '}
            <Text
              style={styles.repostBannerName}
              onPress={() => openAuthor(post.originalAuthor!.id)}
            >
              @{post.originalAuthor!.username}
            </Text>
          </Text>
        </View>
      ) : null}

      {/* Header: avatar + name + handle + time */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.authorTap}
          activeOpacity={0.7}
          onPress={() => openAuthor(headerAuthor.id)}
          accessibilityLabel={`Open @${headerAuthor.username}`}
        >
          <View style={styles.avatar}>
            {headerAuthor.avatarUrl ? (
              <Image source={{ uri: headerAuthor.avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {headerAuthor.displayName ?? headerAuthor.username}
              </Text>
              <AddBadge userId={headerAuthor.id} size="sm" />
              <Text style={styles.timeDot}> · </Text>
              <Text style={styles.timeText}>{relativeTime(post.createdAt)}</Text>
            </View>
            <Text style={styles.handleText} numberOfLines={1}>
              @{headerAuthor.username}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.repostBtn}
          activeOpacity={0.85}
          accessibilityLabel="Repost"
          onPress={() => {
            const targetId = post.kind === 'repost' ? post.originalPostId : post.id;
            if (targetId) {
              navigation.navigate('Repost', {
                originalPostId: targetId,
                seedClipStartSec: post.clipStartSec,
                seedClipEndSec: post.clipEndSec,
              });
            }
          }}
        >
          <Text style={styles.repostBtnIcon}>▤</Text>
          <Text style={styles.repostBtnLabel}>Repost</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => setContextMenuVisible(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="More options"
        >
          <Text style={styles.moreBtnText}>⋯</Text>
        </TouchableOpacity>
      </View>

      {/* Track title + caption */}
      <View style={styles.titleBlock}>
        <Text style={styles.trackTitle} numberOfLines={2}>
          {post.track.title}
        </Text>
        {isRepost ? (
          <View style={styles.creatorTag}>
            <Text style={styles.creatorTagLabel}>CREATOR</Text>
            <Text style={styles.creatorTagName} numberOfLines={1}>
              @{post.originalAuthor!.username}
            </Text>
          </View>
        ) : null}
      </View>
      {post.caption ? (
        <Text style={styles.caption} numberOfLines={4}>
          {post.caption}
        </Text>
      ) : null}

      {/* Media */}
      <View style={styles.mediaWrap}>
        {media ? (
          <MediaPlayer
            ref={playerRef}
            postId={post.id}
            media={media}
            paused={paused}
            rate={rate}
            onTogglePaused={handleTogglePaused}
            onProgress={handleProgress}
            onLoaded={handleLoaded}
            onEnded={handleEnded}
            seekTo={seekTo}
            visible={visible}
            pauseWhenOffScreen={pauseWhenOffScreen}
          />
        ) : (
          <View style={[styles.mediaWrap, styles.missingMedia]}>
            <Text style={styles.missingMediaText}>Media unavailable</Text>
          </View>
        )}
      </View>

      {/* Seek bar + time labels */}
      <View style={styles.seekRow}>
        <Text style={styles.seekTime}>{formatTime(position)}</Text>
        <View style={styles.seekBarWrap}>
          <ClipRangeSlider
            readOnly
            duration={duration}
            position={position}
            start={post.clipStartSec ?? 0}
            end={post.clipEndSec ?? duration}
            minClipSeconds={1}
            onSeekEnd={handlePostSeekEnd}
          />
        </View>
        <Text style={styles.seekTime}>{formatTime(duration)}</Text>
      </View>

      {/* Action row: play/pause + stats */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.playButton}
          activeOpacity={0.85}
          onPress={handleTogglePaused}
          accessibilityLabel={paused ? 'Play' : 'Pause'}
        >
          <Text style={styles.playButtonGlyph}>{paused ? '▶' : '❚❚'}</Text>
        </TouchableOpacity>

        <View style={styles.statsGroup}>
          <TouchableOpacity style={styles.statBtn} activeOpacity={0.7} onPress={handleToggleLike}>
            <Text style={[styles.statIcon, liked && styles.statIconLiked]}>{liked ? '♥' : '♡'}</Text>
            <Text style={[styles.statValue, liked && styles.statValueLiked]}>
              {formatCount(likesCount)}
            </Text>
          </TouchableOpacity>
          <View style={styles.statBtn}>
            <Text style={styles.statIcon}>↻</Text>
            <Text style={styles.statValue}>{formatCount(post.repostsCount)}</Text>
          </View>
          <View style={styles.statBtn}>
            <Text style={styles.statIcon}>💬</Text>
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </View>
          <View style={styles.statBtn}>
            <Text style={styles.statIcon}>◉</Text>
            <Text style={styles.statValue}>{formatCount(viewsCount)}</Text>
          </View>
        </View>
      </View>

      <TrackContextMenu
        visible={contextMenuVisible}
        track={trackInfoForMenu}
        onClose={() => setContextMenuVisible(false)}
        onPlayNext={playback.playTrackNext}
        onAddToQueue={playback.addToQueue}
        onGoToArtist={(userId) => {
          navigation.navigate('UserProfile', { userId });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
    marginHorizontal: 16,
  },
  repostBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  repostBannerIcon: {
    color: COLORS.purpleLight,
    fontSize: 13,
  },
  repostBannerText: {
    color: COLORS.textMuted,
    fontSize: 12,
    flex: 1,
  },
  repostBannerName: {
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authorTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: COLORS.purpleLight,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  timeDot: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  timeText: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  handleText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  repostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  repostBtnIcon: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 16,
  },
  repostBtnLabel: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtnText: {
    color: COLORS.textSecondary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  titleBlock: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  trackTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    flex: 1,
  },
  creatorTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.infoBg,
    borderWidth: 1,
    borderColor: COLORS.infoBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '60%',
  },
  creatorTagLabel: {
    color: COLORS.info,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  creatorTagName: {
    color: COLORS.info,
    fontSize: 11,
    fontWeight: '700',
  },
  caption: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  mediaWrap: {
    marginTop: 12,
  },
  missingMedia: {
    aspectRatio: 1,
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingMediaText: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  seekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 10,
  },
  seekBarWrap: {
    flex: 1,
  },
  seekTime: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 40,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 14,
  },
  playButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  playButtonGlyph: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 2,
  },
  statsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'space-around',
  },
  statBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  statIcon: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  statIconLiked: {
    color: '#FF4D6D',
  },
  statValue: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statValueLiked: {
    color: '#FF4D6D',
  },
});
