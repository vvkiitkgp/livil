import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import CoverFallback from './CoverFallback';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';
import { ACTION_ICON_SIZE, SHARE_ICON_SIZE, postCardStyles as styles } from './PostCard';

export type UploadPreviewAuthor = {
  name: string;
  username: string | null;
  avatarUrl: string | null;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function formatTime(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) { return '0:00'; }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The upload's "this is how your post will look" card: PostCard's layout, drawn from the
 * files and fields on the upload screen instead of a published post.
 *
 * NOT a PostCard. A real card plays through the global engine (GlobalAudioPlayer), which
 * would put an unpublished song on the lock screen, in "listening now" for friends, and in
 * play counts. This one only looks the part — its styles ARE PostCard's (`postCardStyles`),
 * so the two cannot drift — and plays through the upload screen's own standalone preview
 * player.
 *
 * The counters read 0 and the Repost / Share / ⋯ controls are drawn but inert: they are
 * what the post will carry, not things to do to a post that does not exist yet. A song's
 * player can sit in the media slot (`mediaSlot`), so the card plays in place like a feed
 * post; a video keeps its thumbnail, as in the feed.
 */
export default function UploadPreviewCard({
  author,
  title,
  caption,
  mediaKind,
  imageUri,
  durationSec,
  playing = false,
  mediaSlot,
  onOpen,
}: {
  author: UploadPreviewAuthor;
  title: string;
  caption: string;
  mediaKind: 'audio' | 'video';
  /** The cover (audio) or the feed thumbnail (video). */
  imageUri: string | null;
  durationSec: number | null;
  /** Shows pause on the card's play button while the preview plays. */
  playing?: boolean;
  /** Replaces the static picture — the song's own player, which handles its own taps. */
  mediaSlot?: React.ReactNode;
  /** The play button (and the picture, when there is no `mediaSlot`). */
  onOpen: () => void;
}) {
  const isVideo = mediaKind === 'video';
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.authorTap}>
          <View style={styles.avatar}>
            {author.avatarUrl ? (
              <Image source={{ uri: author.avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{initialsOf(author.name)}</Text>
            )}
          </View>
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>{author.name}</Text>
            </View>
            <View style={styles.handleRow}>
              {author.username ? (
                <>
                  <Text style={styles.handleText} numberOfLines={1}>@{author.username}</Text>
                  <Text style={styles.timeDot}>·</Text>
                </>
              ) : null}
              <Text style={styles.timeText}>just now</Text>
            </View>
          </View>
        </View>
        <View style={styles.repostBtn} importantForAccessibility="no-hide-descendants">
          <GradientBorder borderRadius={999} />
          <Icon name="repost" size={14} color={COLORS.purpleNeon} />
          <Text style={styles.repostBtnLabel}>Repost</Text>
        </View>
        <View style={styles.moreBtn} importantForAccessibility="no-hide-descendants">
          <Icon name="overflow" size={18} color={COLORS.textSecondary} />
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.trackTitle} numberOfLines={2}>{title.trim() || 'Untitled'}</Text>
      </View>
      {caption.trim() ? (
        <Text style={styles.caption} numberOfLines={4}>{caption.trim()}</Text>
      ) : null}

      {mediaSlot ? (
        <View style={styles.mediaWrap}>{mediaSlot}</View>
      ) : (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onOpen}
        style={styles.mediaWrap}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause the preview' : 'Play the preview'}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={isVideo ? styles.videoThumb : styles.audioCover}
            resizeMode="cover"
          />
        ) : (
          <CoverFallback />
        )}
        {isVideo ? (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.videoBadgeText}>VIDEO</Text>
          </View>
        ) : null}
        {playing ? null : (
          <View pointerEvents="none" style={styles.videoCenterGlyphWrap}>
            <View style={styles.videoCenterGlyph}>
              <Icon name="play" size={24} color="#fff" />
            </View>
          </View>
        )}
      </TouchableOpacity>
      )}

      <View style={styles.durationBlock}>
        <Text style={styles.seekTime}>{formatTime(durationSec)}</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.playButton}
          activeOpacity={0.85}
          onPress={onOpen}
          accessibilityLabel={playing ? 'Pause the preview' : 'Play the preview'}
        >
          <GradientBorder borderRadius={23} />
          <Icon name={playing ? 'pause' : 'play'} size={16} color={COLORS.purpleNeon} />
        </TouchableOpacity>
        <View style={styles.statsGroup} importantForAccessibility="no-hide-descendants">
          <View style={styles.statBtn}>
            <View style={styles.likeHit}>
              <Icon name="heart" size={ACTION_ICON_SIZE} color={COLORS.white} />
            </View>
            <Text style={styles.statValue}>0</Text>
          </View>
          <View style={styles.statBtn}>
            <Icon name="comment" size={ACTION_ICON_SIZE} color={COLORS.white} />
            <Text style={styles.statValue}>0</Text>
          </View>
          <View style={styles.statBtn}>
            <Icon name="repost" size={ACTION_ICON_SIZE} color={COLORS.white} />
            <Text style={styles.statValue}>0</Text>
          </View>
          <View style={styles.statBtn}>
            <View style={styles.shareIconBox}>
              <Icon name="share" size={SHARE_ICON_SIZE} color={COLORS.white} />
            </View>
            <Text style={[styles.statValue, styles.countGap]}>0</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
