import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from './MediaPlayer';
import ClipRangeSlider from './ClipRangeSlider';
import TrackContextMenu from './TrackContextMenu';
import type { FeedPost } from '../services/posts';
import { toggleLike, deletePost } from '../services/posts';
import { trackPlayProgress } from '../utils/playTracker';
import { friendlyErrorMessage } from '../utils/errorMessages';
import PostReportModal from './PostReportModal';
import ConfirmActionModal from './ConfirmActionModal';
import { supabase } from '../../lib/supabase';
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
  /** Tap the comments stat to open the CommentsSheet for this post. */
  onCommentsPress?: (postId: string) => void;
  /**
   * Called after the owner successfully deletes their post. The feed screen
   * should drop the post from its local list so the card unmounts.
   */
  onDeleted?: (postId: string) => void;
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

export default function PostCard({ post, visible, pauseWhenOffScreen = true, onCommentsPress, onDeleted }: PostCardProps) {
  const playback = usePlayback();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
  const playerRef = useRef<MediaPlayerHandle>(null);

  // Viewer id is needed to decide owner vs non-owner for the ⋯ menu actions
  // (Delete shows only for owner, Report only for non-owner). Resolved once
  // on mount; doesn't change during the card's lifetime.
  const [viewerId, setViewerId] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) { setViewerId(data?.user?.id ?? ''); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Modal state for the post-level actions launched from the ⋯ menu.
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Queue actions silently mutate userQueueRef — there's no visible feedback
  // unless the user opens the QueueList in FullScreenPlayer. Wrap them with
  // a toast so the user actually knows the action took effect.
  const handlePlayNext = useCallback((track: NowPlayingInfo) => {
    playback.playTrackNext(track);
    showToast('Plays next', { kind: 'success' });
  }, [playback, showToast]);

  const handleAddToQueue = useCallback((track: NowPlayingInfo) => {
    playback.addToQueue(track);
    showToast('Added to queue', { kind: 'success' });
  }, [playback, showToast]);

  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deletePost(post.id);
      setConfirmDelete(false);
      showToast('Post deleted', { kind: 'success' });
      // If this card was currently driving playback, stop it cleanly so a
      // ghost player doesn't keep going after the post vanishes.
      if (playback.isActive(post.id)) {
        playback.pauseAll();
        playback.clearNowPlaying();
      }
      onDeleted?.(post.id);
    } catch (e) {
      showToast(friendlyErrorMessage(e, "Couldn't delete the post."), { kind: 'error' });
    } finally {
      setDeleting(false);
    }
  }, [post.id, playback, showToast, onDeleted]);

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
      thumbnailUrl: post.track.thumbnailUrl,
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

  const isVideo = post.track.mediaKind === 'video';
  const isThisActive = playback.activePostId === post.id;
  const media = isVideo ? null : pickMediaShape(post.track);

  // If the global active id changes to anything other than ours, pause ourselves.
  // For video posts the local `paused` state is unused at render time (the play
  // button glyph reads from isThisActive instead), but we still reset it to
  // keep the audio fall-back paths consistent.
  useEffect(() => {
    if (playback.activePostId !== post.id) {
      setPaused(true);
    }
  }, [playback.activePostId, post.id]);

  // Auto-start when the global queue navigation lands on this post (audio only).
  // Video posts in the feed never auto-play — the user taps the play button or
  // thumbnail to start. The pendingPlayId still gets cleared so the engine
  // doesn't re-dispatch.
  useEffect(() => {
    if (playback.pendingPlayId === post.id) {
      if (!isVideo) {
        setPaused(false);
      }
      playback.clearPendingPlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.pendingPlayId, post.id, playback.clearPendingPlay, isVideo]);

  // Register / update handlers whenever paused state changes.
  // Use stable method refs (not the full `playback` object) to prevent a render
  // loop: calling setNowPlaying changes nowPlaying → changes playback → re-runs
  // this effect → calls setNowPlaying again → ∞
  //
  // VIDEO POSTS: handler registration lives entirely in FullScreenPlayer (its
  // <Video> is the sole video player; PostCard renders only a thumbnail). The
  // effect below is for audio playback only.
  useEffect(() => {
    if (isVideo) { return; }
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
        thumbnailUrl: post.track.thumbnailUrl,
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
    isVideo, // early-returns for video posts
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

  // Play counting is now driven by actual audio playback in `handleProgress`
  // via `trackPlayProgress` (see src/utils/playTracker.ts). Visibility alone
  // doesn't count — the user has to be playing the song for >= 3 cumulative
  // seconds in a single play instance. Loops/replays each start a new instance.

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
      // Feed the play tracker only when this card is actually driving audio.
      // Inactive cards' final stale onProgress shouldn't count toward plays.
      trackPlayProgress(post.id, seconds);
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
  // For audio posts, scrub locally via setSeekTo (MediaPlayer picks it up).
  // For video posts, route through the global seek so FS's <Video> moves.
  const handlePostSeekEnd = useCallback((s: number) => {
    if (isVideo) {
      playback.markSeekTarget(s);
      playback.handlersRef.current?.seek(s);
      return;
    }
    setPosition(s);
    setSeekTo(s);
    setTimeout(() => setSeekTo(null), 0);
  }, [isVideo, playback]);

  // ── Video-only state + handlers ────────────────────────────────────────────
  // For video posts the position/duration shown on PostCard's seek bar mirrors
  // FullScreenPlayer's <Video> via positionRef/durationRef. Poll at 10 Hz only
  // while this card is the active video — keeps N-1 PostCards in the FlatList
  // from running idle intervals.
  useEffect(() => {
    if (!isVideo) { return; }
    if (!isThisActive) {
      // Not the active video — show "0:00 / clipEnd" until tapped.
      setPosition(0);
      setDuration(0);
      return;
    }
    const id = setInterval(() => {
      setPosition(playback.positionRef.current);
      setDuration(playback.durationRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [isVideo, isThisActive, playback.positionRef, playback.durationRef]);

  // Build the NowPlayingInfo for this post — shared between play-button and
  // thumbnail-tap so we don't duplicate field-list maintenance.
  const buildNowPlayingForThis = useCallback((): NowPlayingInfo => {
    const displayAuthor = (post.kind === 'repost' && post.originalAuthor)
      ? post.originalAuthor
      : post.author;
    return {
      postId: post.id,
      trackId: post.track.id,
      title: post.track.title,
      artistName: displayAuthor.displayName ?? displayAuthor.username,
      authorId: displayAuthor.id,
      authorUsername: displayAuthor.username,
      authorAvatarUrl: displayAuthor.avatarUrl,
      coverArtUrl: post.track.coverArtUrl,
      thumbnailUrl: post.track.thumbnailUrl,
      mediaKind: post.track.mediaKind,
      videoUrl: post.track.videoUrl ?? undefined,
      audioUrl: post.track.audioUrl ?? undefined,
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

  // Action-row play/pause button (bottom of the card):
  //   - Currently playing this post → pause via the global handler.
  //   - Otherwise → ALWAYS restart from clipStart (per UX spec, tap-play
  //     means "play from the top"). FS does NOT open.
  // Two start paths depending on whether FS already owns this post's video:
  //   • Owned: handlersRef points at FS — seek + play directly.
  //   • Not owned: set nowPlaying + requestPlay; FS handoff effect will
  //     take ownership, mount the <Video>, set fsPaused=false, and onLoad
  //     seeks to positionRef (which we pre-set to clipStart).
  const handleVideoTogglePlay = useCallback(() => {
    if (isThisActive) {
      playback.handlersRef.current?.pause();
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    const owned = playback.fsOwnerPostIdRef.current === post.id;
    if (owned) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current?.seek(clipStart);
      playback.handlersRef.current?.play();
    } else {
      playback.setNowPlaying(buildNowPlayingForThis());
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
  }, [isThisActive, post.id, post.clipStartSec, buildNowPlayingForThis, playback]);

  // Center play button (overlay on the thumbnail) AND thumbnail tap:
  // open FullScreenPlayer. Also restarts from clipStart per UX spec — the
  // user pressing play on the post means "play this from the top".
  const handleVideoOpenFs = useCallback(() => {
    const clipStart = post.clipStartSec ?? 0;
    const owned = playback.fsOwnerPostIdRef.current === post.id;
    if (owned && isThisActive) {
      // Already playing this in FS — just maximize.
      playback.openFullScreenPlayer();
      return;
    }
    if (owned) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current?.seek(clipStart);
      playback.handlersRef.current?.play();
    } else {
      playback.setNowPlaying(buildNowPlayingForThis());
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
    playback.openFullScreenPlayer();
  }, [post.id, post.clipStartSec, isThisActive, buildNowPlayingForThis, playback]);

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

  // Orphaned repost: the original upload was deleted (FK ON DELETE SET NULL
  // nulled out original_post_id). Reposts survive with their own engagement
  // intact, but we render a tombstone instead of playable media so the
  // reposter — and anyone seeing it — knows the source is gone.
  const isOrphanedRepost = post.kind === 'repost' && post.originalPostId === null;

  const initials = useMemo(() => avatarInitials(headerAuthor), [headerAuthor]);

  if (isOrphanedRepost) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.authorTap}
            activeOpacity={0.7}
            onPress={() => openAuthor(headerAuthor.id)}
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
                <Text style={styles.timeDot}> · </Text>
                <Text style={styles.timeText}>{relativeTime(post.createdAt)}</Text>
              </View>
              <Text style={styles.handleText} numberOfLines={1}>
                @{headerAuthor.username}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={() => setContextMenuVisible(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.moreBtnText}>⋯</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tombstoneBody}>
          <Text style={styles.tombstoneGlyph}>𝍃</Text>
          <Text style={styles.tombstoneTitle}>Original post no longer available</Text>
          <Text style={styles.tombstoneBodyText}>
            The author removed this post. Your repost stays, but the track isn't playable from here.
          </Text>
        </View>

        <View style={styles.tombstoneStatsRow}>
          <TouchableOpacity style={styles.statBtn} activeOpacity={0.7} onPress={handleToggleLike}>
            <Text style={[styles.statIcon, liked && styles.statIconLiked]}>{liked ? '♥' : '♡'}</Text>
            <Text style={[styles.statValue, liked && styles.statValueLiked]}>
              {formatCount(likesCount)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statBtn}
            activeOpacity={0.7}
            onPress={() => onCommentsPress?.(post.id)}
            disabled={!onCommentsPress}
          >
            <Text style={styles.statIcon}>💬</Text>
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </TouchableOpacity>
        </View>

        <TrackContextMenu
          visible={contextMenuVisible}
          track={trackInfoForMenu}
          onClose={() => setContextMenuVisible(false)}
          onPlayNext={handlePlayNext}
          onAddToQueue={handleAddToQueue}
          onGoToArtist={(uid) => navigation.navigate('UserProfile', { userId: uid })}
          viewerId={viewerId}
          postId={post.id}
          postAuthorId={post.author.id}
          onReportPost={() => setReportOpen(true)}
          onDeletePost={() => setConfirmDelete(true)}
          disablePlaybackActions
        />

        <PostReportModal
          visible={reportOpen}
          postId={reportOpen ? post.id : null}
          onClose={() => setReportOpen(false)}
        />

        <ConfirmActionModal
          visible={confirmDelete}
          title="Remove repost?"
          message="This permanently removes your repost and any comments and likes on it. This cannot be undone."
          confirmLabel="Remove"
          tone="destructive"
          busy={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      </View>
    );
  }

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
        {isVideo ? (
          // Video posts: static thumbnail only. The real <Video> lives in
          // FullScreenPlayer (single-player model) so feed playback and FS
          // playback can never desync. Tap anywhere on the thumbnail (or
          // the centered play glyph) → opens FS. The bottom action-row
          // play button (rendered below) plays audio in place without
          // opening FS.
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleVideoOpenFs}
            style={styles.mediaWrap}
            accessibilityLabel="Open full-screen player"
          >
            {post.track.thumbnailUrl ? (
              <Image
                source={{ uri: post.track.thumbnailUrl }}
                style={styles.videoThumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.videoThumb, styles.videoThumbPlaceholder]}>
                <Text style={styles.videoThumbGlyph}>▶</Text>
              </View>
            )}
            <View style={styles.videoBadge} pointerEvents="none">
              <Text style={styles.videoBadgeText}>VIDEO</Text>
            </View>
            {/* Centered play glyph — visual cue matching audio's MediaPlayer
                overlay. Shown only when this post is not currently playing,
                so during playback the user sees the thumbnail without it. */}
            {!isThisActive ? (
              <View pointerEvents="none" style={styles.videoCenterGlyphWrap}>
                <View style={styles.videoCenterGlyph}>
                  <Text style={styles.videoCenterGlyphText}>▶</Text>
                </View>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : media ? (
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
          onPress={isVideo ? handleVideoTogglePlay : handleTogglePaused}
          accessibilityLabel={(isVideo ? !isThisActive : paused) ? 'Play' : 'Pause'}
        >
          <Text style={styles.playButtonGlyph}>
            {(isVideo ? !isThisActive : paused) ? '▶' : '❚❚'}
          </Text>
        </TouchableOpacity>

        <View style={styles.statsGroup}>
          <TouchableOpacity style={styles.statBtn} activeOpacity={0.7} onPress={handleToggleLike}>
            <Text style={[styles.statIcon, liked && styles.statIconLiked]}>{liked ? '♥' : '♡'}</Text>
            <Text style={[styles.statValue, liked && styles.statValueLiked]}>
              {formatCount(likesCount)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statBtn}
            activeOpacity={0.7}
            onPress={() => onCommentsPress?.(post.id)}
            disabled={!onCommentsPress}
          >
            <Text style={styles.statIcon}>💬</Text>
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </TouchableOpacity>
          {/* Reposts: only meaningful on upload posts. Reposts of reposts aren't
              allowed (createRepost throws), so a repost's repostsCount is always
              0 — don't show it. Plays/views are intentionally removed here per
              product decision; the cumulative track plays live in FullScreenPlayer. */}
          {post.kind === 'upload' ? (
            <View style={styles.statBtn}>
              {/* Same glyph as the Repost button (line 436) for visual consistency. */}
              <Text style={styles.statIcon}>▤</Text>
              <Text style={styles.statValue}>{formatCount(post.repostsCount)}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <TrackContextMenu
        visible={contextMenuVisible}
        track={trackInfoForMenu}
        onClose={() => setContextMenuVisible(false)}
        onPlayNext={handlePlayNext}
        onAddToQueue={handleAddToQueue}
        onGoToArtist={(userId) => {
          navigation.navigate('UserProfile', { userId });
        }}
        viewerId={viewerId}
        postId={post.id}
        postAuthorId={post.author.id}
        onReportPost={() => setReportOpen(true)}
        onDeletePost={() => setConfirmDelete(true)}
      />

      <PostReportModal
        visible={reportOpen}
        postId={reportOpen ? post.id : null}
        onClose={() => setReportOpen(false)}
      />

      <ConfirmActionModal
        visible={confirmDelete}
        title="Delete this post?"
        message={
          post.kind === 'upload'
            ? "Your comments, likes, plays, and any playlist entries for this post will be permanently removed. Other people's reposts of it will stay, but the original will show as no longer available — they'll know it was removed. This cannot be undone."
            : 'This permanently removes your repost and any comments and likes on it. This cannot be undone.'
        }
        confirmLabel="Delete"
        tone="destructive"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(false)}
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
  videoThumb: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: 18,
    backgroundColor: COLORS.card,
  },
  videoThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoThumbGlyph: {
    color: COLORS.textMuted,
    fontSize: 56,
    opacity: 0.6,
  },
  videoBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  videoBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  // Center play-glyph overlay — matches MediaPlayer's style so audio + video
  // posts share the same visual affordance for "tap to play / open".
  videoCenterGlyphWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoCenterGlyph: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  videoCenterGlyphText: {
    color: '#fff',
    fontSize: 24,
    marginLeft: 4,
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
  tombstoneBody: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 12,
    alignItems: 'center',
  },
  tombstoneGlyph: {
    color: COLORS.textMuted,
    fontSize: 36,
    marginBottom: 10,
  },
  tombstoneTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  tombstoneBodyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  tombstoneStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 18,
    paddingBottom: 14,
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
