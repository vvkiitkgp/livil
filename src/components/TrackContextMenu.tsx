import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import type { NowPlayingInfo } from '../contexts/PlaybackContext';

export type TrackContextMenuProps = {
  visible: boolean;
  track: NowPlayingInfo | null;
  onClose: () => void;
  onPlayNext: (track: NowPlayingInfo) => void;
  onAddToQueue: (track: NowPlayingInfo) => void;
  onAddToPlaylist?: (track: NowPlayingInfo) => void;
  onGoToArtist?: (userId: string) => void;
  /** Opens the report modal for the post. Hidden when the viewer is the post owner. */
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
};

type MenuItem = {
  id: string;
  label: string;
  icon: string;
  destructive?: boolean;
};

const BASE_MENU_ITEMS: readonly MenuItem[] = [
  { id: 'play-next', label: 'Play Next', icon: '⏭' },
  { id: 'add-to-queue', label: 'Add to Queue', icon: '☰' },
  { id: 'add-to-playlist', label: 'Add to Playlist...', icon: '+' },
  { id: 'go-to-artist', label: 'Go to Artist', icon: '→' },
] as const;

export default function TrackContextMenu({
  visible,
  track,
  onClose,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onGoToArtist,
  onReportPost,
  onDeletePost,
  viewerId,
  postId,
  postAuthorId,
  disablePlaybackActions = false,
}: TrackContextMenuProps) {
  const insets = useSafeAreaInsets();

  // Compose the menu item list dynamically — ownership decides whether Report
  // (others' posts) or Delete (own posts) appears at the bottom. Playback
  // items are suppressed for tombstoned reposts where there's nothing to play.
  const isOwner = !!viewerId && !!postAuthorId && viewerId === postAuthorId;
  const items: MenuItem[] = disablePlaybackActions
    ? BASE_MENU_ITEMS.filter(i => i.id === 'go-to-artist')
    : [...BASE_MENU_ITEMS];
  if (postId && onReportPost && !isOwner) {
    items.push({ id: 'report-post', label: 'Report post', icon: '⚐' });
  }
  if (postId && onDeletePost && isOwner) {
    items.push({ id: 'delete-post', label: 'Delete post', icon: '✕', destructive: true });
  }

  const handlePress = useCallback((id: string) => {
    if (!track) { return; }
    // Report + Delete need the menu to stay open until the follow-up modal
    // takes over (the caller opens its own confirm/report modal in response).
    // Closing here first looks cleaner than fading the menu under the modal.
    onClose();
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
      case 'report-post':
        if (postId) { onReportPost?.(postId); }
        break;
      case 'delete-post':
        if (postId) { onDeletePost?.(postId); }
        break;
    }
  }, [track, onClose, onPlayNext, onAddToQueue, onAddToPlaylist, onGoToArtist, onReportPost, onDeletePost, postId]);

  if (!track) { return null; }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
              <View style={styles.handleBar} />

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
                    <Text style={[styles.menuIcon, item.destructive && styles.menuIconDestructive]}>
                      {item.icon}
                    </Text>
                    <Text style={[styles.menuLabel, item.destructive && styles.menuLabelDestructive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    // paddingBottom set dynamically via insets.bottom so the last menu item
    // clears the Android nav bar / iOS home indicator.
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
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
  },
  menuIconDestructive: {
    color: COLORS.error,
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
