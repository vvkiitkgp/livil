import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { haptics } from '../utils/haptics';
import { useToast } from '../contexts/ToastContext';
import { toggleLike, deletePost } from '../services/posts';
import { artistLine, useSpotifyAvailability, useSpotifyTrack } from '../services/spotify';
import { useOpenInSpotify } from '../hooks/useOpenInSpotify';
import { friendlyErrorMessage } from '../utils/errorMessages';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import PostReportModal from './PostReportModal';
import PostLikersSheet from './PostLikersSheet';
import LikedByLine from './LikedByLine';
import ConfirmActionModal from './ConfirmActionModal';
import DetailActionSheet, { type DetailAction } from './DetailActionSheet';
import AddBadge from './AddBadge';
import UsernameBadges from './UsernameBadges';
import ProgressiveImage from './ProgressiveImage';
import { Icon } from './Icon';
import { GradientBorder } from './GradientBorder';
import { Button } from './Button';
import { SpotifyLogo } from './SpotifyLogo';
import type { PostCardProps } from './PostCard';

/**
 * The feed card for a Spotify repost (ADR-0027).
 *
 * Laid out like a Livil repost card — banner, header, title, caption, artwork, action row —
 * so it reads as the same kind of thing. What differs, and why:
 *
 *  - Tapping play OPENS SPOTIFY. Livil pauses its own player first; the single-engine rule
 *    means a Spotify song never becomes Livil's now-playing, queue or lock-screen card.
 *  - The artwork is shown as Spotify supplies it: full square, small corner radius, nothing
 *    drawn on top (Spotify's design guidelines forbid cropping, overlays and controls on
 *    album art). So there is no centre play glyph and no rounded 18px crop.
 *  - No waveform (Spotify forbids analysing its audio), no clip, no play count, no share
 *    link (same as every repost), no add-to-queue / playlist / album.
 *  - The Repost pill opens the Spotify repost screen with this song LOCKED in.
 */
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

function formatCount(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {return '?';}
  if (parts.length === 1) {return parts[0]!.slice(0, 2).toUpperCase();}
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function SpotifyPostCard({ post, onCommentsPress, onDeleted }: PostCardProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
  const spotifyId = post.spotifyTrackId ?? '';
  const meta = useSpotifyTrack(spotifyId || null);
  // The Repost pill creates a new Spotify repost, so it follows the switch. Likes,
  // comments and "Play on Spotify" stay available on posts that already exist.
  const { reposts: repostsOn } = useSpotifyAvailability();

  const [viewerId, setViewerId] = useState('');
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) { setViewerId(data?.user?.id ?? ''); }
    });
    return () => { cancelled = true; };
  }, []);
  const isOwner = !!viewerId && viewerId === post.author.id;

  const [liked, setLiked] = useState(post.viewerHasLiked);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const author = post.author;
  const authorName = author.displayName ?? author.username;

  const openAuthor = useCallback(() => {
    navigation.navigate('UserProfile', { userId: author.id });
  }, [navigation, author.id]);

  const openSpotify = useOpenInSpotify('feed');
  const handleOpen = useCallback(() => openSpotify(spotifyId), [openSpotify, spotifyId]);

  const handleRepost = useCallback(() => {
    if (!spotifyId) {return;}
    navigation.navigate('SpotifyRepost', {
      spotifyTrackId: spotifyId,
      locked: true,
      fromUsername: author.username,
    });
  }, [navigation, spotifyId, author.username]);

  const handleToggleLike = useCallback(async () => {
    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    if (nextLiked) { haptics.toggleOn(); }
    setLiked(nextLiked);
    setLikesCount(prevCount + (nextLiked ? 1 : -1));
    try {
      const serverLiked = await toggleLike(post.id);
      if (serverLiked !== nextLiked) {
        setLiked(serverLiked);
        setLikesCount(prevCount + (serverLiked ? 1 : 0));
      }
    } catch {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, post.id]);

  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deletePost(post.id);
      setConfirmDelete(false);
      showToast('Repost deleted', { kind: 'success' });
      onDeleted?.(post.id);
    } catch (e) {
      showToast(friendlyErrorMessage(e, "Couldn't delete the repost."), { kind: 'error' });
    } finally {
      setDeleting(false);
    }
  }, [post.id, showToast, onDeleted]);

  const menuActions = useMemo<DetailAction[]>(() => {
    const actions: DetailAction[] = [
      { key: 'open', label: 'Open in Spotify', icon: 'externalLink', onPress: () => { void handleOpen(); } },
    ];
    if (isOwner) {
      actions.push({ key: 'delete', label: 'Delete repost', icon: 'trash', destructive: true, onPress: () => setConfirmDelete(true) });
    } else if (viewerId) {
      actions.push({ key: 'report', label: 'Report post', icon: 'flag', onPress: () => setReportOpen(true) });
    }
    return actions;
  }, [handleOpen, isOwner, viewerId]);

  const track = meta.track;
  const title = meta.status === 'ready' ? track!.title : meta.status === 'loading' ? ' ' : 'Song unavailable';
  const artist = meta.status === 'ready' ? artistLine(track) : meta.status === 'loading' ? ' ' : 'Open it in Spotify to see it';

  return (
    <View style={styles.card}>
      <View style={styles.repostBanner}>
        <Icon name="repost" size={13} color={COLORS.purpleLight} />
        <Text style={styles.repostBannerText} numberOfLines={1}>
          <Text style={styles.repostBannerName} onPress={openAuthor}>{authorName}</Text>
          {' reposted'}
        </Text>
        <View style={styles.fromTag} accessibilityLabel="From Spotify">
          <Text style={styles.fromTagLabel}>FROM</Text>
          <SpotifyLogo size="xs" withName />
        </View>
      </View>

      <View style={styles.header}>
        <TouchableOpacity style={styles.authorTap} activeOpacity={0.7} onPress={openAuthor} accessibilityLabel={`Open @${author.username}`}>
          <View style={styles.avatar}>
            <ProgressiveImage
              source={{ uri: author.avatarUrl }}
              style={styles.avatarImg}
              placeholder={<Text style={styles.avatarText}>{initialsOf(authorName)}</Text>}
            />
          </View>
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>{authorName}</Text>
              <UsernameBadges userId={author.id} size={15} />
              <AddBadge userId={author.id} size="sm" />
            </View>
            <View style={styles.handleRow}>
              <Text style={styles.handleText} numberOfLines={1}>@{author.username}</Text>
              <Text style={styles.timeDot}>·</Text>
              <Text style={styles.timeText}>{relativeTime(post.createdAt)}</Text>
            </View>
          </View>
        </TouchableOpacity>
        {repostsOn ? (
          <TouchableOpacity style={styles.repostBtn} activeOpacity={0.85} accessibilityLabel="Repost" onPress={handleRepost}>
            <GradientBorder borderRadius={999} />
            <Icon name="repost" size={14} color={COLORS.purpleNeon} />
            <Text style={styles.repostBtnLabel}>Repost</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.moreBtn} onPress={() => setMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="More options">
          <Icon name="overflow" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.trackTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.artist} numberOfLines={1}>{artist}</Text>
      {post.caption ? <Text style={styles.caption} numberOfLines={4}>{post.caption}</Text> : null}

      {/* Artwork exactly as Spotify supplies it — nothing drawn on top. Tapping it opens the
          song, like tapping a Livil cover plays it. */}
      <TouchableOpacity activeOpacity={0.9} onPress={() => { void handleOpen(); }} accessibilityRole="button" accessibilityLabel={`Play ${meta.track?.title ?? 'this song'} on Spotify`} style={styles.artWrap}>
        {track?.imageUrl ? (
          <Image source={{ uri: track.imageUrl }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={[styles.art, styles.artEmpty]}>
            {meta.status === 'loading' ? (
              <ActivityIndicator color={COLORS.purpleLight} />
            ) : (
              <Icon name="musicNote" size={40} color={COLORS.textMuted} />
            )}
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.actionRow}>
        <Button
          label="Play on Spotify"
          variant="secondary"
          size="md"
          leading={<SpotifyLogo size="xs" />}
          onPress={() => { void handleOpen(); }}
          accessibilityLabel="Play on Spotify"
          haptic="none"
        />
        <View style={styles.statsGroup}>
          <View style={styles.statBtn}>
            <TouchableOpacity activeOpacity={0.7} onPress={handleToggleLike} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
              <Icon name="heart" size={16} color={liked ? '#FF4D6D' : COLORS.textSecondary} weight={liked ? 'fill' : 'regular'} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} onPress={() => setLikersOpen(true)} disabled={likesCount === 0} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Text style={[styles.statValue, liked && styles.statValueLiked]}>{formatCount(likesCount)}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.statBtn} activeOpacity={0.7} onPress={() => onCommentsPress?.(post.id)} disabled={!onCommentsPress} accessibilityLabel="Comments">
            <Icon name="comment" size={16} color={COLORS.textSecondary} />
            <Text style={styles.statValue}>{formatCount(post.commentsCount)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <LikedByLine postId={post.id} likesCount={likesCount} viewerHasLiked={liked} onPress={() => setLikersOpen(true)} />

      <DetailActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      <PostReportModal visible={reportOpen} postId={reportOpen ? post.id : null} onClose={() => setReportOpen(false)} />
      <PostLikersSheet visible={likersOpen} postId={likersOpen ? post.id : null} onClose={() => setLikersOpen(false)} />
      <ConfirmActionModal
        visible={confirmDelete}
        title="Delete this repost?"
        message="This permanently removes your repost and any comments and likes on it. The song stays on Spotify. This cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

// Card, banner, header and stats styles mirror PostCard's on purpose: a Spotify repost and a
// Livil repost should read as the same kind of post in the feed.
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
    backgroundColor: COLORS.card,
    marginTop: -14,
    marginHorizontal: -14,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopLeftRadius: 19,
    borderTopRightRadius: 19,
  },
  repostBannerText: { color: COLORS.textMuted, fontSize: 12, flex: 1 },
  repostBannerName: { color: COLORS.textSecondary, fontWeight: '700' },
  fromTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fromTagLabel: { color: COLORS.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  authorTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
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
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  headerText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  displayName: { color: COLORS.white, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  handleText: { color: COLORS.textMuted, fontSize: 12, flexShrink: 1 },
  timeDot: { color: COLORS.textMuted, fontSize: 12 },
  timeText: { color: COLORS.textMuted, fontSize: 12 },
  repostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  repostBtnLabel: { color: COLORS.purpleNeon, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  moreBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center' },
  trackTitle: { color: COLORS.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.3, marginTop: 12 },
  artist: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  caption: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  artWrap: { marginTop: 12 },
  // Spotify's mobile guideline: artwork corners rounded no more than 4px.
  art: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: COLORS.card },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 14 },
  statsGroup: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'space-around' },
  statBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 6 },
  statValue: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statValueLiked: { color: '#FF4D6D' },
});

export default React.memo(SpotifyPostCard);
