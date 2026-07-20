import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
import ClipRangeSlider from './ClipRangeSlider';
import TrackContextMenu from './TrackContextMenu';
import AddToAlbumSheet from './AddToAlbumSheet';
import type { FeedPost } from '../services/posts';
import { toggleLike, deletePost } from '../services/posts';
import { fetchAlbumForTrack, removeTrackFromAlbum, addTrackToAlbum, type AlbumForTrack } from '../services/albums';
import { friendlyErrorMessage } from '../utils/errorMessages';
import PostReportModal from './PostReportModal';
import PostLikersSheet from './PostLikersSheet';
import LikedByLine from './LikedByLine';
import ConfirmActionModal from './ConfirmActionModal';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import AddBadge from './AddBadge';
import { Icon } from './Icon';
import { GradientBorder } from './GradientBorder';
import ProgressiveImage from './ProgressiveImage';

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

export default function PostCard({ post, visible, pauseWhenOffScreen = true, onCommentsPress, onDeleted }: PostCardProps) {
  const playback = usePlayback();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();

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

  // Position + duration for the read-only seek bar. Polled from the global
  // playback refs while this post is the current track (see effect below).
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  // Engagement state (optimistic).
  const [liked, setLiked] = useState(post.viewerHasLiked);
  const [likesCount, setLikesCount] = useState(post.likesCount);

  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [currentAlbum, setCurrentAlbum] = useState<AlbumForTrack | null>(null);
  const [albumSheetOpen, setAlbumSheetOpen] = useState(false);
  const [confirmRemoveAlbum, setConfirmRemoveAlbum] = useState(false);
  const isOwnerOfPost = !!viewerId && viewerId === post.author.id;

  // Fetch current album membership when the context menu is about to open, so
  // the menu can choose between "Add to album" and "Move/Remove" deterministically.
  useEffect(() => {
    if (!contextMenuVisible || !isOwnerOfPost) { return; }
    let cancelled = false;
    fetchAlbumForTrack(post.track.id)
      .then(a => { if (!cancelled) { setCurrentAlbum(a); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [contextMenuVisible, isOwnerOfPost, post.track.id]);

  const handleAddOrMoveAlbum = useCallback(() => {
    setAlbumSheetOpen(true);
  }, []);
  const handleRemoveAlbum = useCallback(() => {
    setConfirmRemoveAlbum(true);
  }, []);
  const confirmRemoveAlbumNow = useCallback(async () => {
    setConfirmRemoveAlbum(false);
    try {
      await removeTrackFromAlbum(post.track.id);
      setCurrentAlbum(null);
    } catch {
      // TODO: surface toast
    }
  }, [post.track.id]);
  const [likersOpen, setLikersOpen] = useState(false);

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
      knownDurationSec: post.track.durationSeconds ?? 0,
    };
  }, [post]);

  const isVideo = post.track.mediaKind === 'video';
  const isThisActive = playback.activePostId === post.id;
  // True when this post is the loaded track (playing OR paused). At most one
  // card is the current track, so only that card polls the position refs.
  const isCurrentTrack = playback.nowPlaying?.postId === post.id;

  // Auto-advance landed on this post. Playback itself is handled globally
  // (GlobalAudioPlayer for audio, FullScreenPlayer for video) off the queue —
  // PostCard no longer drives it — so we just clear the pending flag.
  useEffect(() => {
    if (playback.pendingPlayId === post.id) {
      playback.clearPendingPlay();
    }
  }, [playback.pendingPlayId, post.id, playback.clearPendingPlay]);

  // Play counting is driven by actual audio/video playback in the global
  // players (GlobalAudioPlayer.handleProgress / FullScreenPlayer) via
  // trackPlayProgress — not from the feed card.

  // The position/duration on PostCard's seek bar mirror the global playback
  // refs (driven by GlobalAudioPlayer for audio, FullScreenPlayer for video).
  // Poll only while this card is the current track — at most one card is, so
  // the other cards in the FlatList run no idle intervals.
  useEffect(() => {
    if (!isCurrentTrack) {
      // Not the current track — fall back to the track's known duration (from
      // DB) so the read-only seek bar can place the clip markers and park the
      // progress handle at clip-start. Without a duration the slider math
      // collapses every fraction to 1.0 and the handle pins to the far right.
      setPosition(0);
      setDuration(post.track.durationSeconds ?? 0);
      return;
    }
    setPosition(playback.positionRef.current);
    setDuration(playback.durationRef.current);
    const id = setInterval(() => {
      setPosition(playback.positionRef.current);
      setDuration(playback.durationRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [isCurrentTrack, post.track.durationSeconds, playback.positionRef, playback.durationRef]);

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
      knownDurationSec: post.track.durationSeconds ?? 0,
    };
  }, [post]);

  // Action-row play/pause button (bottom of the card). Video posts now route
  // through GlobalAudioPlayer exactly like audio — it is the single engine for
  // every post's audio (it decodes a video's audioless picture-track for sound;
  // FullScreenPlayer just shows muted frames). So there is no FS "ownership" to
  // branch on; this is identical to handleAudioTogglePlay.
  //   - playing this post → pause via the global handler.
  //   - loaded but paused → seek to clipStart + play (re-issuing setNowPlaying
  //     wouldn't restart GAP since postId is unchanged).
  //   - otherwise → setNowPlaying + requestPlay; GAP picks it up.
  const handleVideoTogglePlay = useCallback(() => {
    if (isThisActive) {
      playback.handlersRef.current?.pause();
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    const isCurrent = playback.nowPlaying?.postId === post.id;
    if (isCurrent && playback.handlersRef.current) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current.seek(clipStart);
      playback.handlersRef.current.play();
    } else {
      playback.setNowPlaying(buildNowPlayingForThis());
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
  }, [isThisActive, post.id, post.clipStartSec, buildNowPlayingForThis, playback]);

  // Center play button (overlay on the thumbnail) AND thumbnail tap: start (or
  // resume) playback and open FullScreenPlayer, which mounts the muted video
  // frame for this track (rule 2: opening FS shows the picture).
  const handleVideoOpenFs = useCallback(() => {
    if (isThisActive) {
      // Already playing this track — just maximize.
      playback.openFullScreenPlayer();
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    const isCurrent = playback.nowPlaying?.postId === post.id;
    if (isCurrent && playback.handlersRef.current) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current.seek(clipStart);
      playback.handlersRef.current.play();
    } else {
      playback.setNowPlaying(buildNowPlayingForThis());
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
    playback.openFullScreenPlayer();
  }, [post.id, post.clipStartSec, isThisActive, buildNowPlayingForThis, playback]);

  // Audio play/pause (action-row button + cover tap). Drives the GLOBAL audio
  // player, never an inline <Video>, so playback is independent of whether this
  // card is on screen.
  //   - playing this post  → pause via the global handler.
  //   - paused, but this is the loaded track → resume/restart from clipStart
  //     through the existing handlers (re-issuing setNowPlaying wouldn't restart
  //     GlobalAudioPlayer since postId/audioUrl are unchanged).
  //   - otherwise → setNowPlaying (with audioUrl) + requestPlay; GlobalAudioPlayer
  //     picks it up and becomes the source.
  const handleAudioTogglePlay = useCallback(() => {
    if (isThisActive) {
      playback.handlersRef.current?.pause();
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    const isCurrent = playback.nowPlaying?.postId === post.id;
    if (isCurrent && playback.handlersRef.current) {
      playback.markSeekTarget(clipStart);
      playback.handlersRef.current.seek(clipStart);
      playback.handlersRef.current.play();
    } else {
      playback.setNowPlaying(buildNowPlayingForThis());
      playback.markSeekTarget(clipStart);
      playback.requestPlay(post.id);
    }
  }, [isThisActive, post.id, post.clipStartSec, buildNowPlayingForThis, playback]);

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
              <ProgressiveImage
                source={{ uri: headerAuthor.avatarUrl }}
                style={styles.avatarImg}
                placeholder={<Text style={styles.avatarText}>{initials}</Text>}
              />
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
            <Icon name="overflow" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.tombstoneBody}>
          <View style={styles.tombstoneIconWrap}>
            <Icon name="tombstone" size={36} color={COLORS.textMuted} />
          </View>
          <Text style={styles.tombstoneTitle}>Original post no longer available</Text>
          <Text style={styles.tombstoneBodyText}>
            The author removed this post. Your repost stays, but the track isn't playable from here.
          </Text>
        </View>

        <View style={styles.tombstoneStatsRow}>
          <View style={styles.statBtn}>
            <TouchableOpacity activeOpacity={0.7} onPress={handleToggleLike} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Icon name="heart" size={16} color={liked ? '#FF4D6D' : COLORS.textSecondary} weight={liked ? 'fill' : 'regular'} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setLikersOpen(true)}
              disabled={likesCount === 0}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={[styles.statValue, liked && styles.statValueLiked]}>
                {formatCount(likesCount)}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.statBtn}
            activeOpacity={0.7}
            onPress={() => onCommentsPress?.(post.id)}
            disabled={!onCommentsPress}
          >
            <Icon name="comment" size={16} color={COLORS.textSecondary} />
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </TouchableOpacity>
        </View>

        <LikedByLine
          postId={post.id}
          likesCount={likesCount}
          viewerHasLiked={liked}
          onPress={() => setLikersOpen(true)}
        />

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
          currentAlbumTitle={currentAlbum?.title ?? null}
          onAddToAlbum={isOwnerOfPost ? handleAddOrMoveAlbum : undefined}
          onMoveToAlbum={isOwnerOfPost ? handleAddOrMoveAlbum : undefined}
          onRemoveFromAlbum={isOwnerOfPost ? handleRemoveAlbum : undefined}
          disablePlaybackActions
        />

        <PostReportModal
          visible={reportOpen}
          postId={reportOpen ? post.id : null}
          onClose={() => setReportOpen(false)}
        />

        <PostLikersSheet
          visible={likersOpen}
          postId={likersOpen ? post.id : null}
          onClose={() => setLikersOpen(false)}
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
          <Icon name="repost" size={13} color={COLORS.purpleLight} />
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
            <ProgressiveImage
              source={{ uri: headerAuthor.avatarUrl }}
              style={styles.avatarImg}
              placeholder={<Text style={styles.avatarText}>{initials}</Text>}
            />
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
          <GradientBorder borderRadius={999} />
          <Icon name="repost" size={14} color={COLORS.purpleNeon} />
          <Text style={styles.repostBtnLabel}>Repost</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => setContextMenuVisible(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="More options"
        >
          <Icon name="overflow" size={18} color={COLORS.textSecondary} />
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
            <ProgressiveImage
              source={{ uri: post.track.thumbnailUrl }}
              style={styles.videoThumb}
              resizeMode="cover"
              placeholder={
                <View style={styles.videoThumbIconWrap}>
                  <Icon name="play" size={56} color={COLORS.textMuted} />
                </View>
              }
            />
            <View style={styles.videoBadge} pointerEvents="none">
              <Text style={styles.videoBadgeText}>VIDEO</Text>
            </View>
            {/* Centered play glyph — visual cue matching audio's MediaPlayer
                overlay. Shown only when this post is not currently playing,
                so during playback the user sees the thumbnail without it. */}
            {!isThisActive ? (
              <View pointerEvents="none" style={styles.videoCenterGlyphWrap}>
                <View style={styles.videoCenterGlyph}>
                  <Icon name="play" size={24} color="#fff" />
                </View>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (post.track.audioUrl || post.track.coverArtUrl) ? (
          // Audio posts: cover art + a center play glyph, mirroring the video
          // thumbnail. Tap toggles play/pause through the GLOBAL audio player —
          // there is no inline <Video> here, so playback is fully decoupled
          // from this card being on screen.
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleAudioTogglePlay}
            style={styles.mediaWrap}
            accessibilityLabel={isThisActive ? 'Pause' : 'Play'}
          >
            <ProgressiveImage
              source={{ uri: post.track.coverArtUrl }}
              style={styles.audioCover}
              resizeMode="cover"
              placeholder={
                <>
                  <View style={styles.fallbackBlobA} pointerEvents="none" />
                  <View style={styles.fallbackBlobB} pointerEvents="none" />
                </>
              }
            />
            {isThisActive && playback.isBuffering ? (
              <View pointerEvents="none" style={styles.videoCenterGlyphWrap}>
                <ActivityIndicator size="large" color={COLORS.purpleLight} />
              </View>
            ) : !isThisActive ? (
              <View pointerEvents="none" style={styles.videoCenterGlyphWrap}>
                <View style={styles.videoCenterGlyph}>
                  <Icon name="play" size={24} color="#fff" />
                </View>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (
          <View style={[styles.mediaWrap, styles.missingMedia]}>
            <Text style={styles.missingMediaText}>Media unavailable</Text>
          </View>
        )}
      </View>

      {/* Clip-window indicator — shows only the clip start/end markers (no
          progress fill, no seek thumb). Labels are the clip boundaries, not
          the live playback position. */}
      <View style={styles.seekRow}>
        <Text style={styles.seekTime}>{formatTime(post.clipStartSec ?? 0)}</Text>
        <View style={styles.seekBarWrap}>
          <ClipRangeSlider
            readOnly
            hideProgress
            duration={duration}
            position={position}
            start={post.clipStartSec ?? 0}
            end={post.clipEndSec ?? duration}
            minClipSeconds={1}
          />
        </View>
        <Text style={styles.seekTime}>{formatTime(post.clipEndSec ?? duration)}</Text>
      </View>

      {/* Action row: play/pause + stats */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.playButton}
          activeOpacity={0.85}
          onPress={isVideo ? handleVideoTogglePlay : handleAudioTogglePlay}
          accessibilityLabel={!isThisActive ? 'Play' : 'Pause'}
        >
          <GradientBorder borderRadius={23} />
          <Icon name={!isThisActive ? 'play' : 'pause'} size={16} color={COLORS.purpleNeon} />
        </TouchableOpacity>

        <View style={styles.statsGroup}>
          <View style={styles.statBtn}>
            <TouchableOpacity activeOpacity={0.7} onPress={handleToggleLike} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Icon name="heart" size={16} color={liked ? '#FF4D6D' : COLORS.textSecondary} weight={liked ? 'fill' : 'regular'} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setLikersOpen(true)}
              disabled={likesCount === 0}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={[styles.statValue, liked && styles.statValueLiked]}>
                {formatCount(likesCount)}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.statBtn}
            activeOpacity={0.7}
            onPress={() => onCommentsPress?.(post.id)}
            disabled={!onCommentsPress}
          >
            <Icon name="comment" size={16} color={COLORS.textSecondary} />
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </TouchableOpacity>
          {/* Reposts: only meaningful on upload posts. Reposts of reposts aren't
              allowed (createRepost throws), so a repost's repostsCount is always
              0 — don't show it. Plays/views are intentionally removed here per
              product decision; the cumulative track plays live in FullScreenPlayer. */}
          {post.kind === 'upload' ? (
            <View style={styles.statBtn}>
              {/* Same glyph as the Repost button (line 436) for visual consistency. */}
              <Icon name="repost" size={16} color={COLORS.textSecondary} />
              <Text style={styles.statValue}>{formatCount(post.repostsCount)}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <LikedByLine
        postId={post.id}
        likesCount={likesCount}
        viewerHasLiked={liked}
        onPress={() => setLikersOpen(true)}
      />

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
        currentAlbumTitle={currentAlbum?.title ?? null}
        onAddToAlbum={isOwnerOfPost ? handleAddOrMoveAlbum : undefined}
        onMoveToAlbum={isOwnerOfPost ? handleAddOrMoveAlbum : undefined}
        onRemoveFromAlbum={isOwnerOfPost ? handleRemoveAlbum : undefined}
      />

      {/* Album-management sheets owned by PostCard so they outlive the
          TrackContextMenu modal closing. The sheet handles Add and Move with
          the same UX — picking from the list moves the track regardless of
          where it was, because `move = remove + add` and we do it in two
          steps via addTrackToAlbum (which rejects on uniqueness collision —
          so we always remove first when moving). */}
      <AddToAlbumSheet
        visible={albumSheetOpen}
        mode="pick"
        onClose={() => setAlbumSheetOpen(false)}
        onPicked={async album => {
          try {
            if (currentAlbum) { await removeTrackFromAlbum(post.track.id); }
            await addTrackToAlbum(album.id, post.track.id);
            setCurrentAlbum({ albumId: album.id, title: album.title, coverArtUrl: album.coverArtUrl });
          } catch {
            // TODO: surface toast
          }
        }}
      />

      <ConfirmActionModal
        visible={confirmRemoveAlbum}
        title="Remove from album?"
        message={`This track will leave "${currentAlbum?.title ?? 'the album'}". It stays on your profile.`}
        confirmLabel="Remove from album"
        tone="destructive"
        glyph="⊖"
        onCancel={() => setConfirmRemoveAlbum(false)}
        onConfirm={confirmRemoveAlbumNow}
      />

      <PostReportModal
        visible={reportOpen}
        postId={reportOpen ? post.id : null}
        onClose={() => setReportOpen(false)}
      />

      <PostLikersSheet
        visible={likersOpen}
        postId={likersOpen ? post.id : null}
        onClose={() => setLikersOpen(false)}
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
  },
  repostBtnLabel: {
    color: COLORS.purpleNeon,
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
  audioCover: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: 18,
    backgroundColor: COLORS.card,
  },
  fallbackBlobA: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: COLORS.purple,
    opacity: 0.45,
    top: -60,
    left: -40,
  },
  fallbackBlobB: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#EC4899',
    opacity: 0.35,
    bottom: -50,
    right: -20,
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
    alignItems: 'center',
    justifyContent: 'center',
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
  tombstoneIconWrap: {
    marginBottom: 10,
  },
  videoThumbIconWrap: {
    opacity: 0.6,
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
