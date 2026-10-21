import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';
import SheetModal, { SheetScrollView } from './SheetModal';
import { useRunAfterDismiss } from '../hooks/useRunAfterDismiss';
import type { NowPlayingInfo } from '../contexts/PlaybackContext';

export type TrackContextMenuProps = {
  visible: boolean;
  track: NowPlayingInfo | null;
  onClose: () => void;
  onPlayNext: (track: NowPlayingInfo) => void;
  onAddToQueue: (track: NowPlayingInfo) => void;
  onAddToPlaylist?: (track: NowPlayingInfo) => void;
  onGoToArtist?: (userId: string) => void;
  /**
   * "Repost/Story a clip of the song". Passed by the feed card (its header pill moved here, 2026-10-21) —
   * the caller decides who may repost, so this menu does not need to know the rule.
   */
  onRepost?: () => void;
  /** Opens the report modal for the post. Hidden when the viewer is the post owner. */
  /** Share this post. Passed only for shareable posts (uploads) — the caller
   *  decides, so this menu does not need to know the rule. */
  onSharePost?: () => void;
  onReportPost?: (postId: string) => void;
  /** Hard-deletes the post after confirmation. Only shown when the viewer is the post owner. */
  onDeletePost?: (postId: string) => void;
  /** ID of the currently signed-in user, used to decide ownership. Falsy = no ownership decisions. */
  viewerId?: string;
  /** ID of the post backing this menu — needed for report + delete. */
  postId?: string;
  /** Authoring user of the post — used to decide owner vs. non-owner. */
  postAuthorId?: string;
  /**
   * Hides Play Next / Add to Queue / Add to Playlist. Used for tombstoned
   * reposts where the original was deleted — there's nothing playable so
   * queueing it would be misleading.
   */
  disablePlaybackActions?: boolean;
  /**
   * Creator-only album actions. The parent fetches the current album membership
   * (typically via `fetchAlbumForTrack`) and passes it in; the menu decides
   * which action to show. All three callbacks open the appropriate UI in the
   * parent (album picker sheet for Add/Move, confirm modal for Remove) since
   * those need to outlive this Modal closing.
   */
  currentAlbumTitle?: string | null;
  onAddToAlbum?: (track: NowPlayingInfo) => void;
  onMoveToAlbum?: (track: NowPlayingInfo) => void;
  onRemoveFromAlbum?: (track: NowPlayingInfo) => void;
};

type MenuItem = {
  id: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
};

const BASE_MENU_ITEMS: readonly MenuItem[] = [
  { id: 'play-next', label: 'Play Next', icon: 'skipForward' },
  { id: 'add-to-queue', label: 'Add to Queue', icon: 'queue' },
  { id: 'add-to-playlist', label: 'Add to Playlist...', icon: 'add' },
  { id: 'go-to-artist', label: 'Go to Artist', icon: 'arrowRight' },
] as const;

export default function TrackContextMenu({
  visible,
  track,
  onClose,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onGoToArtist,
  onRepost,
  onSharePost,
  onReportPost,
  onDeletePost,
  viewerId,
  postId,
  postAuthorId,
  disablePlaybackActions = false,
  currentAlbumTitle,
  onAddToAlbum,
  onMoveToAlbum,
  onRemoveFromAlbum,
}: TrackContextMenuProps) {
  const insets = useSafeAreaInsets();
  const { runAfterDismiss, onDismiss } = useRunAfterDismiss();

  // Compose the menu item list dynamically — ownership decides whether Report
  // (others' posts) or Delete (own posts) appears at the bottom. Playback
  // items are suppressed for tombstoned reposts where there's nothing to play.
  const isOwner = !!viewerId && !!postAuthorId && viewerId === postAuthorId;
  const items: MenuItem[] = disablePlaybackActions
    ? BASE_MENU_ITEMS.filter(i => i.id === 'go-to-artist')
    : [...BASE_MENU_ITEMS];
  // Share sits at the top of the discretionary items, above the creator-only ones:
  // it applies to everyone and is the most likely reason to open this menu. Present
  // only when the caller passes a handler, which it does for uploads only.
  if (onRepost) {
    // Owner's words (2026-10-21): a Livil repost is a CLIP, and can go to a story — unlike a
    // Spotify repost, whose own menu (SpotifyPostCard) keeps "Repost this song".
    items.push({ id: 'repost', label: 'Repost/Story a clip of the song', icon: 'repost' });
  }
  if (onSharePost) {
    items.push({ id: 'share-post', label: 'Share', icon: 'share' });
  }
  // Creator-only album actions. The DB invariant (one album per track) is
  // enforced by `album_tracks_one_album_per_track` — so the UI shows EITHER
  // Add OR Move + Remove, never all three.
  if (isOwner) {
    if (currentAlbumTitle && onMoveToAlbum) {
      items.push({ id: 'move-to-album', label: 'Move to another album', icon: 'disc' });
    } else if (!currentAlbumTitle && onAddToAlbum) {
      items.push({ id: 'add-to-album', label: 'Add to album', icon: 'disc' });
    }
    if (currentAlbumTitle && onRemoveFromAlbum) {
      items.push({ id: 'remove-from-album', label: 'Remove from album', icon: 'minusCircle' });
    }
  }
  if (postId && onReportPost && !isOwner) {
    items.push({ id: 'report-post', label: 'Report post', icon: 'flag' });
  }
  if (postId && onDeletePost && isOwner) {
    items.push({ id: 'delete-post', label: 'Delete post', icon: 'close', destructive: true });
  }

  const handlePress = useCallback((id: string) => {
    if (!track) { return; }
    // Close first, then act once the menu has CLOSED. Several actions open a modal of the
    // caller's (share, report, delete confirm, album picker), and iOS refuses to present
    // one while this sheet is still on screen sliding away — the new one opens into
    // nothing. Android has no such refusal and runs it on the next tick. See
    // useRunAfterDismiss.
    onClose();
    runAfterDismiss(() => {
      switch (id) {
        case 'play-next':
          onPlayNext(track);
          break;
        case 'add-to-queue':
          onAddToQueue(track);
          break;
        case 'add-to-playlist':
          onAddToPlaylist?.(track);
          break;
        case 'go-to-artist':
          onGoToArtist?.(track.authorId);
          break;
        case 'add-to-album':
          onAddToAlbum?.(track);
          break;
        case 'move-to-album':
          onMoveToAlbum?.(track);
          break;
        case 'remove-from-album':
          onRemoveFromAlbum?.(track);
          break;
        case 'repost':
          onRepost?.();
          break;
        case 'share-post':
          onSharePost?.();
          break;
        case 'report-post':
          if (postId) { onReportPost?.(postId); }
          break;
        case 'delete-post':
          if (postId) { onDeletePost?.(postId); }
          break;
      }
    });
  }, [track, onClose, runAfterDismiss, onPlayNext, onAddToQueue, onAddToPlaylist, onGoToArtist, onRepost, onSharePost, onReportPost, onDeletePost, onAddToAlbum, onMoveToAlbum, onRemoveFromAlbum, postId]);

  if (!track) { return null; }

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      fit
      style={styles.sheet}
      header={
        <View style={styles.header}>
          <View style={styles.trackPreview}>
            {track.coverArtUrl ? (
              <Image source={{ uri: track.coverArtUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]} />
            )}
            <View style={styles.trackMeta}>
              <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
              <Text style={styles.trackArtist} numberOfLines={1}>{track.artistName}</Text>
            </View>
          </View>

          <View style={styles.divider} />
        </View>
      }
    >
      <SheetScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 16 + insets.bottom }]}
      >
        {items.map((item) => {
          if (item.id === 'add-to-playlist' && !onAddToPlaylist) { return null; }
          if (item.id === 'go-to-artist' && !onGoToArtist) { return null; }
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.menuItem}
              onPress={() => handlePress(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.menuIcon}>
                <Icon
                  name={item.icon}
                  size={18}
                  color={item.destructive ? COLORS.error : COLORS.white}
                />
              </View>
              <Text style={[styles.menuLabel, item.destructive && styles.menuLabelDestructive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  // The surface only — height, grabber, backdrop and drag come from SheetModal.
  sheet: { backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 20, paddingTop: 8 },
  // Shrinks to fit under the sheet's height cap, where it scrolls.
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 20 },
  trackPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: COLORS.card,
  },
  coverFallback: {
    backgroundColor: COLORS.purpleDim,
  },
  trackMeta: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  trackArtist: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuIcon: {
    color: COLORS.white,
    fontSize: 18,
    width: 24,
    textAlign: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '500',
  },
  menuLabelDestructive: {
    color: COLORS.error,
  },
});
