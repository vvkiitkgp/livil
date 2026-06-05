import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Platform,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ClipRangeSlider from './ClipRangeSlider';
import QueueList from './QueueList';
import { usePlayback, type NowPlayingInfo, type RepeatMode, type PlayerHandlers } from '../contexts/PlaybackContext';
import { fetchTrackCollaborators, type TrackCollaboratorInfo } from '../services/tracks';
import { toggleLike } from '../services/posts';
import {
  fetchUserPlaylists,
  isPostInPlaylist,
  addPostToPlaylist,
  type UserPlaylist,
} from '../services/playlists';
import { COLORS } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const FLOAT_D = 60;
// PLAYER_BOTTOM and CONVERGE_Y are intentionally NOT defined at module level.
// They depend on insets.bottom (the real Android nav bar height) which is only
// available inside the component via useSafeAreaInsets().  See playerBottom /
// convergeY computed at the top of FullScreenPlayer().

type TabId = 'lyrics' | 'queue' | 'info';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) { return '0:00'; }
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatCount(n: number): string {
  if (n < 1000) { return String(n); }
  if (n < 1_000_000) { return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`; }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function roleEmoji(role: string): string {
  const map: Record<string, string> = {
    'Vocals': '🎤', 'Lead Vocals': '🎤', 'Backing Vocals': '🎤',
    'Drums': '🥁',
    'Piano': '🎹', 'Keys': '🎹',
    'Guitar': '🎸', 'Bass': '🎸',
    'Production': '🎛️', 'Mixing': '🎚️', 'Mastering': '🎚️',
    'Songwriting': '✍️', 'Lyrics': '📝',
    'Featured': '⭐',
  };
  return map[role] ?? '🎵';
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Polls position/duration at 4 Hz and renders:
 * - A ClipRangeSlider when the current track has an active clip window
 *   (a repost with stored clip_start_sec / clip_end_sec). The user can drag the
 *   handles freely to listen to any range of the full track. Changes are stored in
 *   clipWindowRef so PostCard respects the new boundaries without a DB write.
 * - A plain SeekBar for uploads with no clip window.
 */
function FullScreenClipBar() {
  const { positionRef, durationRef, handlersRef, nowPlaying, clipWindowRef } = usePlayback();
  // Lazy-init from refs so handles appear at correct positions the moment the
  // full-screen player opens, without waiting for the first 250ms interval tick.
  const [position, setPosition] = useState(() => positionRef.current);
  const [duration, setDuration] = useState(() => durationRef.current);

  // Local clip state — drives ClipRangeSlider during drag without touching context.
  const [localStart, setLocalStart] = useState<number | null>(() => nowPlaying?.clipStartSec ?? null);
  const [localEnd,   setLocalEnd]   = useState<number | null>(() => nowPlaying?.clipEndSec   ?? null);

  // Track localStart in a ref so handleClipChangeEnd can detect which handle moved.
  const localStartRef = useRef(localStart);
  localStartRef.current = localStart;

  // Sync from nowPlaying whenever the track changes.
  useEffect(() => {
    const cs = nowPlaying?.clipStartSec ?? null;
    const ce = nowPlaying?.clipEndSec   ?? null;
    setLocalStart(cs);
    setLocalEnd(ce);
    clipWindowRef.current = (cs !== null && ce !== null) ? { start: cs, end: ce } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId]);

  useEffect(() => {
    const id = setInterval(() => {
      setPosition(positionRef.current);
      setDuration(durationRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [positionRef, durationRef]);

  // Stable callbacks so ClipRangeSlider's panResponder useMemo doesn't
  // recreate on every 250ms polling tick.
  const handleClipChange = useCallback((s: number, e: number) => {
    setLocalStart(s);
    setLocalEnd(e);
    clipWindowRef.current = { start: s, end: e };
  }, [clipWindowRef]);

  const handleClipChangeEnd = useCallback((s: number, e: number, handle: 'left' | 'right') => {
    setLocalStart(s);
    setLocalEnd(e);
    clipWindowRef.current = { start: s, end: e };
    // Only seek when the left (clip-start) handle was released — the playback
    // position should snap to the new start so the user hears the new clip edge.
    // Moving the right (clip-end) handle only changes the boundary; whatever was
    // already playing keeps going from its current position.
    // In both cases we never call play() — the caller's pause state is respected.
    if (handle === 'left') {
      handlersRef.current?.seek(s);
    }
  }, [clipWindowRef, handlersRef]);

  // Seek handle (blue circle): scrubs to the chosen position.
  // Never calls play() — if the song was paused, it stays paused after the scrub.
  const handleSeekEnd = useCallback((s: number) => {
    setPosition(s);
    handlersRef.current?.seek(s);
  }, [handlersRef]);

  const start = localStart ?? 0;
  const end = localEnd ?? duration;

  return (
    <View style={seekSt.wrap}>
      <View style={seekSt.timeRow}>
        <Text style={seekSt.time}>{formatTime(position)}</Text>
        <Text style={seekSt.time}>{formatTime(duration)}</Text>
      </View>
      {duration > 0 ? (
        <ClipRangeSlider
          duration={duration}
          position={position}
          start={start}
          end={end}
          minClipSeconds={2}
          onChange={handleClipChange}
          onChangeEnd={handleClipChangeEnd}
          onSeekEnd={handleSeekEnd}
        />
      ) : null}
    </View>
  );
}

const seekSt = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingBottom: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  time: { color: COLORS.white, fontSize: 12, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
});

/** Shuffle icon — two crossing arrows. */
function ShuffleIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.purpleLight : COLORS.textMuted;
  return (
    <View style={iconSt.wrap}>
      <View style={[iconSt.line, { backgroundColor: c }]} />
      <View style={[iconSt.line, { backgroundColor: c, marginTop: 7 }]} />
      <View style={[iconSt.arrowR, { borderLeftColor: c }]} />
      <View style={[iconSt.arrowL, { borderRightColor: c }]} />
      <View style={[iconSt.cross, { backgroundColor: c }]} />
      {active && <View style={iconSt.dot} />}
    </View>
  );
}

/** Repeat icon — ↻ with optional "1" badge. */
function RepeatIcon({ mode }: { mode: RepeatMode }) {
  const active = mode !== 'off';
  const c = active ? COLORS.purpleLight : COLORS.textMuted;
  return (
    <View style={iconSt.repeatWrap}>
      <Text style={[iconSt.repeatGlyph, { color: c }]}>↻</Text>
      {mode === 'one' && (
        <View style={iconSt.badge}>
          <Text style={iconSt.badgeText}>1</Text>
        </View>
      )}
      {active && <View style={[iconSt.dot, iconSt.repeatDot]} />}
    </View>
  );
}

const iconSt = StyleSheet.create({
  wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  line: { width: 18, height: 2, borderRadius: 1 },
  arrowR: {
    position: 'absolute', right: 8,
    borderTopWidth: 4, borderBottomWidth: 4, borderLeftWidth: 6,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
    top: 9,
  },
  arrowL: {
    position: 'absolute', left: 8,
    borderTopWidth: 4, borderBottomWidth: 4, borderRightWidth: 6,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
    bottom: 9,
  },
  cross: { position: 'absolute', width: 20, height: 2, borderRadius: 1, transform: [{ rotate: '-35deg' }] },
  dot: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.purple },
  repeatWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  repeatGlyph: { fontSize: 22, fontWeight: '300' },
  badge: {
    position: 'absolute', top: 7, right: 5,
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: 8, fontWeight: '800', lineHeight: 10 },
  repeatDot: { bottom: 5 },
});

/**
 * Left-side credits column shown on the main player view.
 * Big author avatar at top, then one row per collaborator role.
 * All avatars are tappable — calls onNavigateToUser(userId).
 */
function CreditsWidget({
  nowPlaying,
  onNavigateToUser,
}: {
  nowPlaying: NowPlayingInfo;
  onNavigateToUser: (userId: string) => void;
}) {
  const [groups, setGroups] = useState<{ role: string; members: TrackCollaboratorInfo[] }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTrackCollaborators(nowPlaying.trackId)
      .then(data => {
        if (cancelled) { return; }
        const map = new Map<string, TrackCollaboratorInfo[]>();
        for (const c of data) {
          if (!map.has(c.role)) { map.set(c.role, []); }
          map.get(c.role)!.push(c);
        }
        setGroups([...map.entries()].map(([role, members]) => ({ role, members })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nowPlaying.trackId]);

  return (
    <View style={cwSt.col}>
      {/* Author — bigger tappable circle */}
      <TouchableOpacity
        onPress={() => onNavigateToUser(nowPlaying.authorId)}
        activeOpacity={0.75}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <CollabAvatar uri={nowPlaying.authorAvatarUrl} name={nowPlaying.artistName} size={52} />
      </TouchableOpacity>

      {/* One row per role */}
      {groups.map(g => (
        <View key={g.role} style={cwSt.roleRow}>
          <Text style={cwSt.emoji}>{roleEmoji(g.role)}</Text>
          <View style={cwSt.avRow}>
            {g.members.slice(0, 3).map((m, i) =>
              m.userId ? (
                <TouchableOpacity
                  key={m.userId}
                  style={i > 0 ? cwSt.overlap : undefined}
                  onPress={() => onNavigateToUser(m.userId!)}
                  activeOpacity={0.75}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <CollabAvatar
                    uri={m.avatarUrl}
                    name={m.displayName ?? m.username ?? '?'}
                    size={28}
                  />
                </TouchableOpacity>
              ) : (
                // Custom-name collaborators have no profile to navigate to
                <View key={`c${i}`} style={i > 0 ? cwSt.overlap : undefined}>
                  <CollabAvatar
                    uri={m.avatarUrl}
                    name={m.displayName ?? m.username ?? '?'}
                    size={28}
                  />
                </View>
              ),
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const cwSt = StyleSheet.create({
  col: { width: 88, gap: 10, paddingTop: 2, alignItems: 'flex-start' },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  emoji: { fontSize: 16, width: 22, textAlign: 'center' },
  avRow: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -8 },
});

/** Small avatar circle used in collaborator rows. */
function CollabAvatar({ uri, name, size = 36 }: { uri: string | null; name: string; size?: number }) {
  return (
    <View style={[avSt.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={avSt.img} />
      ) : (
        <Text style={[avSt.initials, { fontSize: size * 0.35 }]}>
          {avatarInitials(name || '?')}
        </Text>
      )}
    </View>
  );
}

const avSt = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
  initials: { color: COLORS.purpleLight, fontWeight: '700' },
});

/** Info tab: artist + collaborators by role + engagement stats. */
function InfoContent({ nowPlaying }: { nowPlaying: NowPlayingInfo }) {
  const [collabs, setCollabs] = useState<TrackCollaboratorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(nowPlaying.viewerHasLiked);
  const [likesCount, setLikesCount] = useState(nowPlaying.likesCount);

  // Fetch collaborators for this track
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrackCollaborators(nowPlaying.trackId)
      .then(data => { if (!cancelled) { setCollabs(data); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setLoading(false); } });
    return () => { cancelled = true; };
  }, [nowPlaying.trackId]);

  // Reset like state if nowPlaying changes
  useEffect(() => {
    setLiked(nowPlaying.viewerHasLiked);
    setLikesCount(nowPlaying.likesCount);
  }, [nowPlaying.postId, nowPlaying.viewerHasLiked, nowPlaying.likesCount]);

  const handleToggleLike = useCallback(async () => {
    const prev = liked;
    const prevCount = likesCount;
    const next = !prev;
    setLiked(next);
    setLikesCount(prevCount + (next ? 1 : -1));
    try {
      const serverLiked = await toggleLike(nowPlaying.postId);
      if (serverLiked !== next) {
        setLiked(serverLiked);
        setLikesCount(prevCount + (serverLiked ? 1 : 0));
      }
    } catch {
      setLiked(prev);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, nowPlaying.postId]);

  // Group collaborators by role for display
  type RoleGroup = { role: string; members: TrackCollaboratorInfo[] };
  const groups: RoleGroup[] = [];
  for (const c of collabs) {
    const existing = groups.find(g => g.role === c.role);
    if (existing) { existing.members.push(c); }
    else { groups.push({ role: c.role, members: [c] }); }
  }

  return (
    <ScrollView
      style={infoSt.scroll}
      contentContainerStyle={infoSt.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Artist row ── */}
      <View style={infoSt.artistRow}>
        <CollabAvatar uri={nowPlaying.authorAvatarUrl} name={nowPlaying.artistName} size={52} />
        <View style={infoSt.artistMeta}>
          <Text style={infoSt.artistName} numberOfLines={1}>{nowPlaying.artistName}</Text>
          <Text style={infoSt.artistHandle} numberOfLines={1}>@{nowPlaying.authorUsername}</Text>
        </View>
      </View>

      {/* ── Collaborators ── */}
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.purpleLight} style={{ marginTop: 20 }} />
      ) : groups.length > 0 ? (
        <View style={infoSt.creditsBlock}>
          <Text style={infoSt.creditsLabel}>CREDITS</Text>
          {groups.map(g => (
            <View key={g.role} style={infoSt.roleRow}>
              <Text style={infoSt.roleEmoji}>{roleEmoji(g.role)}</Text>
              <View style={infoSt.avatarStack}>
                {g.members.map((m, i) => (
                  <View
                    key={m.userId ?? `custom-${i}`}
                    style={[infoSt.stackedAvatar, i > 0 && { marginLeft: -10 }]}
                  >
                    <CollabAvatar
                      uri={m.avatarUrl}
                      name={m.displayName ?? m.username ?? '?'}
                      size={36}
                    />
                  </View>
                ))}
              </View>
              <Text style={infoSt.roleName}>{g.role}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Engagement stats ── */}
      <View style={infoSt.statsRow}>
        <TouchableOpacity style={infoSt.statBtn} onPress={handleToggleLike} activeOpacity={0.7}>
          <Text style={[infoSt.statIcon, liked && infoSt.statIconLiked]}>
            {liked ? '♥' : '♡'}
          </Text>
          <Text style={[infoSt.statValue, liked && infoSt.statValueLiked]}>
            {formatCount(likesCount)}
          </Text>
        </TouchableOpacity>

        <View style={infoSt.statBtn}>
          <Text style={infoSt.statIcon}>💬</Text>
          <Text style={infoSt.statValue}>{formatCount(nowPlaying.commentsCount)}</Text>
        </View>

        <View style={infoSt.statBtn}>
          <Text style={infoSt.statIcon}>↻</Text>
          <Text style={infoSt.statValue}>{formatCount(nowPlaying.repostsCount)}</Text>
        </View>

        <View style={infoSt.statBtn}>
          <Text style={infoSt.statIcon}>▶</Text>
          <Text style={infoSt.statValue}>{formatCount(nowPlaying.viewsCount)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const infoSt = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  artistMeta: { flex: 1, minWidth: 0 },
  artistName: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  artistHandle: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },

  creditsBlock: { marginBottom: 24 },
  creditsLabel: {
    color: COLORS.textMuted, fontSize: 10, fontWeight: '900',
    letterSpacing: 1.5, marginBottom: 14,
  },
  roleRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, marginBottom: 12,
  },
  roleEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  stackedAvatar: { zIndex: 1 },
  roleName: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', flex: 1 },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingTop: 20, marginTop: 4,
  },
  statBtn: { alignItems: 'center', gap: 4 },
  statIcon: { color: COLORS.textSecondary, fontSize: 18 },
  statIconLiked: { color: '#FF4D6D' },
  statValue: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statValueLiked: { color: '#FF4D6D' },
});

// ─── Add-to-playlist modal ────────────────────────────────────────────────────

const MODAL_ACCENTS = ['#22D3EE', '#EC4899', '#F59E0B', '#00C853'];

function AddToPlaylistModal({
  visible,
  nowPlaying,
  onClose,
  onNavigateToCreate,
}: {
  visible: boolean;
  nowPlaying: NowPlayingInfo;
  onClose: () => void;
  onNavigateToCreate: () => void;
}) {
  const { setNowPlaying } = usePlayback();
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState(nowPlaying.viewerHasLiked);

  useEffect(() => {
    if (!visible) { return; }
    setLiked(nowPlaying.viewerHasLiked);
    let cancelled = false;

    fetchUserPlaylists()
      .then(async pls => {
        if (cancelled) { return; }
        setPlaylists(pls);
        const checks = await Promise.all(pls.map(p => isPostInPlaylist(p.id, nowPlaying.postId)));
        if (cancelled) { return; }
        setAddedIds(new Set(pls.filter((_, i) => checks[i]).map(p => p.id)));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, nowPlaying.postId]);

  const handleToggleLiked = useCallback(async () => {
    const next = !liked;
    setLiked(next);
    try {
      const serverLiked = await toggleLike(nowPlaying.postId);
      setLiked(serverLiked);
      // Sync back to PlaybackContext so CompactStats / heart icon updates
      setNowPlaying({ ...nowPlaying, viewerHasLiked: serverLiked });
    } catch {
      setLiked(!next);
    }
  }, [liked, nowPlaying, setNowPlaying]);

  const handleAddToPlaylist = useCallback(async (playlistId: string) => {
    if (addedIds.has(playlistId)) { return; }
    setAddedIds(prev => new Set([...prev, playlistId]));
    try {
      await addPostToPlaylist(playlistId, nowPlaying.postId);
    } catch {
      setAddedIds(prev => {
        const next = new Set(prev);
        next.delete(playlistId);
        return next;
      });
    }
  }, [addedIds, nowPlaying.postId]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={modalSt.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={modalSt.sheet}>
          <View style={modalSt.handle} />
          <Text style={modalSt.sheetTitle}>Add to playlist</Text>

          <ScrollView
            style={modalSt.list}
            contentContainerStyle={modalSt.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Liked Songs — always first */}
            <TouchableOpacity style={modalSt.row} onPress={handleToggleLiked} activeOpacity={0.7}>
              <View style={[modalSt.rowThumb, { backgroundColor: '#7C3AED' }]}>
                <Text style={modalSt.rowThumbEmoji}>♥</Text>
              </View>
              <View style={modalSt.rowMeta}>
                <Text style={modalSt.rowName}>Liked Songs</Text>
              </View>
              {liked && <Text style={modalSt.check}>✓</Text>}
            </TouchableOpacity>

            {/* Custom playlists */}
            {playlists.map((p, index) => {
              const added = addedIds.has(p.id);
              const accent = MODAL_ACCENTS[index % MODAL_ACCENTS.length]!;
              const initial = p.name.trim().charAt(0).toUpperCase() || '♪';
              return (
                <TouchableOpacity
                  key={p.id}
                  style={modalSt.row}
                  onPress={() => handleAddToPlaylist(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={[modalSt.rowThumb, { backgroundColor: accent, overflow: 'hidden' }]}>
                    {p.coverArtUrl ? (
                      <Image source={{ uri: p.coverArtUrl }} style={StyleSheet.absoluteFill} />
                    ) : (
                      <Text style={modalSt.rowThumbText}>{initial}</Text>
                    )}
                  </View>
                  <View style={modalSt.rowMeta}>
                    <Text style={modalSt.rowName}>{p.name}</Text>
                    <Text style={modalSt.rowSub}>{p.postCount} {p.postCount === 1 ? 'post' : 'posts'}</Text>
                  </View>
                  {added && <Text style={modalSt.check}>✓</Text>}
                </TouchableOpacity>
              );
            })}

            {/* New playlist */}
            <TouchableOpacity style={modalSt.row} onPress={onNavigateToCreate} activeOpacity={0.7}>
              <View style={[modalSt.rowThumb, { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }]}>
                <Text style={modalSt.newIcon}>+</Text>
              </View>
              <View style={modalSt.rowMeta}>
                <Text style={[modalSt.rowName, { color: COLORS.purpleLight }]}>New playlist</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalSt = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    paddingBottom: 36,
    height: SCREEN_H * 0.65,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  rowThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowThumbEmoji: { fontSize: 20 },
  rowThumbText: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  rowMeta: { flex: 1, minWidth: 0 },
  rowName: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  check: { color: COLORS.purpleLight, fontSize: 18, fontWeight: '700', flexShrink: 0 },

  newIcon: { color: COLORS.purpleLight, fontSize: 22, fontWeight: '300' },
});


// ─── Main component ───────────────────────────────────────────────────────────

export default function FullScreenPlayer() {
  const {
    nowPlaying,
    isFullScreenOpen,
    closeFullScreenPlayer,
    positionRef,
    handlersRef,
    registerHandlers,
    unregisterHandlers,
    updatePosition,
    updateDuration,
    clipWindowRef,
  } = usePlayback();

  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ── Player positioning (insets-aware) ─────────────────────────────────────
  // Computed here — not at module level — so insets.bottom (the real height of
  // the Android system nav bar / gesture strip on this specific device) is
  // baked in before driving layout and animations.
  const playerTabBarH  = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const playerBottom   = Math.max(SCREEN_H * 0.1, playerTabBarH + 56);
  const convergeY      = SCREEN_H / 2 - playerBottom - FLOAT_D / 2;

  const handleNavigateToUser = useCallback((userId: string) => {
    // Minimize full-screen player — floating player stays visible, music keeps playing.
    closeFullScreenPlayer();
    // dispatch(StackActions.push) always creates a fresh UserProfile screen even if
    // one already exists in the stack. navigate() would reuse the existing screen
    // (showing stale profile data). dispatch() works on the root navigation object
    // that useNavigation() returns from outside the Stack.Navigator tree — push()
    // would be undefined there, but dispatch() is available everywhere.
    navigation.dispatch(StackActions.push('UserProfile', { userId }));
  }, [closeFullScreenPlayer, navigation]);

  // Three independent native-driver values replace the old slideAnim/bounceAnim pair.
  // Keeping them separate avoids Animated.add() on interpolated values, which can
  // silently fall back to the JS driver on Android and break gesture detection.
  const posYAnim    = useRef(new Animated.Value(convergeY)).current;   // translateY
  const scaleAnim   = useRef(new Animated.Value(0.02)).current;         // scaleX / scaleY
  const opacityAnim = useRef(new Animated.Value(0)).current;            // opacity
  const panelAnim   = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [fsPaused, setFsPaused] = useState(true);
  const videoRef = useRef<VideoRef>(null);
  const initialSeekDone = useRef(false);
  // Saved PostCard handlers so we can restore them when the FS video player closes
  const savedHandlersRef = useRef<PlayerHandlers | null>(null);

  // ── Open / close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFullScreenOpen) {
      // Snap to the invisible starting dot at the floating player circle, then
      // spring outward to full screen — looks like it's bursting from the circle.
      posYAnim.setValue(convergeY);
      scaleAnim.setValue(0.02);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(posYAnim,  { toValue: 0, bounciness: 8, speed: 12, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, bounciness: 8, speed: 12, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
    } else {
      panelAnim.setValue(0);
      setActiveTab(null);
      // Phase 1 (80 ms): quick bounce up.
      // Phase 2 (350 ms): converge — Y moves toward the floating player, scale shrinks to dot.
      Animated.sequence([
        Animated.timing(posYAnim, {
          toValue: -25, duration: 80,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(posYAnim, {
            toValue: convergeY, duration: 350,
            easing: Easing.in(Easing.quad), useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.02, duration: 350,
            easing: Easing.in(Easing.quad), useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0, duration: 200, useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
  }, [isFullScreenOpen, posYAnim, scaleAnim, opacityAnim, panelAnim]);

  // ── Video handoff ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nowPlaying || nowPlaying.mediaKind !== 'video') { return; }
    if (isFullScreenOpen) {
      // Save the PostCard's handlers before overwriting them so we can restore
      // them when the FS closes — otherwise handlersRef ends up null and the
      // floating player can no longer control playback.
      savedHandlersRef.current = handlersRef.current;
      initialSeekDone.current = false;
      handlersRef.current?.pause();
      setFsPaused(false);
      registerHandlers({
        play: () => setFsPaused(false),
        pause: () => setFsPaused(true),
        seek: (s: number) => { positionRef.current = s; videoRef.current?.seek(s); },
        setRate: () => {},
      });
    } else {
      setFsPaused(true);
      if (savedHandlersRef.current) {
        // Restore the PostCard's handlers and resume its player so the floating
        // player can control playback again after the FS is dismissed.
        const handlers = savedHandlersRef.current;
        savedHandlersRef.current = null;
        registerHandlers(handlers);
        handlers.play();
      } else {
        unregisterHandlers();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreenOpen]);

  // ── Panel helpers ─────────────────────────────────────────────────────────
  const openTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    Animated.spring(panelAnim, { toValue: 1, bounciness: 4, speed: 12, useNativeDriver: true }).start();
  }, [panelAnim]);

  const closePanel = useCallback(() => {
    Animated.timing(panelAnim, { toValue: 0, duration: 220, useNativeDriver: true })
      .start(() => setActiveTab(null));
  }, [panelAnim]);

  const handleTabPress = useCallback((tab: TabId) => {
    if (activeTab === tab) { closePanel(); } else { openTab(tab); }
  }, [activeTab, openTab, closePanel]);

  // ── Swipe-down-to-close (disabled while panel is open so only the panel closes) ─
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(activeTab === null)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 500) { closeFullScreenPlayer(); }
    });

  // ── Swipe-down the panel handle to dismiss the panel ─────────────────────
  const panelDismissGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 60 || e.velocityY > 400) { closePanel(); }
    });

  // ── Video callbacks ───────────────────────────────────────────────────────
  const handleVideoLoad = useCallback((data: OnLoadData) => {
    updateDuration(data.duration ?? 0);
    if (!initialSeekDone.current) {
      initialSeekDone.current = true;
      const pos = positionRef.current;
      if (pos > 0) { videoRef.current?.seek(pos); }
    }
  }, [updateDuration, positionRef]);

  const handleVideoProgress = useCallback(
    (data: OnProgressData) => { updatePosition(data.currentTime ?? 0); },
    [updatePosition],
  );

  // ── Layout ────────────────────────────────────────────────────────────────
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  const HEADER_H = 52;
  const panelTop = safeTop + HEADER_H;
  const panelHeight = SCREEN_H - panelTop;
  const panelScrollPad = playerBottom + FLOAT_D + 24 + 44 + safeBottom + 16;
  const actionRowBottom = safeBottom + 44;
  const seekRowBottom = playerBottom + FLOAT_D + 24;
  const panelTranslateY = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  if (!nowPlaying) { return null; }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: opacityAnim,
          transform: [
            { translateY: posYAnim },
            { scaleX: scaleAnim },
            { scaleY: scaleAnim },
          ],
        },
      ]}
      pointerEvents={isFullScreenOpen ? 'box-none' : 'none'}
    >
      {/* ── Full-bleed media ── */}
      <View style={StyleSheet.absoluteFill}>
        {nowPlaying.mediaKind === 'video' && nowPlaying.videoUrl ? (
          <Video
            ref={videoRef}
            source={{ uri: nowPlaying.videoUrl }}
            style={styles.video}
            resizeMode="cover"
            paused={fsPaused}
            onLoad={handleVideoLoad}
            onProgress={handleVideoProgress}
            onEnd={() => setFsPaused(true)}
            progressUpdateInterval={250}
            playInBackground={false}
            playWhenInactive={false}
            ignoreSilentSwitch="ignore"
            muted={false}
            volume={1.0}
            {...(Platform.OS === 'android' ? { disableFocus: fsPaused } : {})}
          />
        ) : nowPlaying.coverArtUrl ? (
          <Image source={{ uri: nowPlaying.coverArtUrl }} style={styles.albumArt} resizeMode="cover" />
        ) : (
          <View style={styles.albumArtFallback}>
            <View style={styles.fallbackBlobA} />
            <View style={styles.fallbackBlobB} />
          </View>
        )}
      </View>

      {/* Scrims removed — no background overlay on video */}

      {/* ── Swipe-to-close gesture — background hit zone only, no children ── */}
      {/* Interactive elements (header, credits, stats) are siblings rendered AFTER
          this so they sit on top and receive taps before the gesture view does.
          box-only ensures the gesture fires on empty areas but never blocks buttons. */}
      <GestureDetector gesture={panGesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only" />
      </GestureDetector>

      {/* ── Header (outside GestureDetector — reliable taps on all Android devices) ── */}
      <View style={[styles.header, { top: safeTop, height: HEADER_H }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={closeFullScreenPlayer}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.closeBtnText}>⌄</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{nowPlaying.title}</Text>
        <TouchableOpacity
          style={styles.repostBtn}
          activeOpacity={0.85}
          accessibilityLabel="Repost"
          onPress={() => {
            const targetId = nowPlaying.kind === 'repost'
              ? nowPlaying.originalPostId
              : nowPlaying.postId;
            if (targetId) {
              // Prefer the live clip window (the user may have just dragged
              // the handles in this player); fall back to the snapshot the
              // post was loaded with.
              const live = clipWindowRef.current;
              const seedStart = live ? live.start : nowPlaying.clipStartSec;
              const seedEnd = live ? live.end : nowPlaying.clipEndSec;
              closeFullScreenPlayer();
              navigation.navigate('Repost', {
                originalPostId: targetId,
                seedClipStartSec: seedStart,
                seedClipEndSec: seedEnd,
              });
            }
          }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Text style={styles.repostBtnIcon}>▤</Text>
          <Text style={styles.repostBtnLabel}>Repost</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowPlaylistModal(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ── Credits widget (outside GestureDetector) ── */}
      <View style={[styles.creditsPos, { top: safeTop + HEADER_H }]} pointerEvents="box-none">
        <CreditsWidget nowPlaying={nowPlaying} onNavigateToUser={handleNavigateToUser} />
      </View>

      {/* ── Track title + artist + engagement stats ── */}
      <View style={[styles.bottomInfo, { bottom: seekRowBottom + 56 }]} pointerEvents="box-none">
        <Text style={styles.trackTitle} numberOfLines={2}>{nowPlaying.title}</Text>
        <Text style={styles.artistName} numberOfLines={1}>{nowPlaying.artistName}</Text>
        <CompactStats nowPlaying={nowPlaying} />
      </View>

      {/* ── Seek bar + time labels ── */}
      <View style={[styles.seekRow, { bottom: seekRowBottom }]} pointerEvents="box-none">
        <FullScreenClipBar />
      </View>

      {/* Shuffle + Repeat live in the FloatingPlayer pill when fullscreen is open */}

      {/* ── Content panel ── */}
      <Animated.View
        style={[styles.contentPanel, { top: panelTop, transform: [{ translateY: panelTranslateY }] }]}
        pointerEvents={activeTab ? 'box-none' : 'none'}
      >
        <GestureDetector gesture={panelDismissGesture}>
          <TouchableOpacity style={styles.panelHandleArea} onPress={closePanel}>
            <View style={styles.panelHandleBar} />
          </TouchableOpacity>
        </GestureDetector>

        <View style={styles.panelTabs}>
          {(['lyrics', 'queue', 'info'] as TabId[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.panelTab, activeTab === tab && styles.panelTabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.panelTabText, activeTab === tab && styles.panelTabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'lyrics' && (
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPad }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.placeholderText}>Lyrics coming soon</Text>
          </ScrollView>
        )}
        {activeTab === 'queue' && (
          <View style={styles.panelScroll}>
            <QueueList paddingBottom={panelScrollPad} />
          </View>
        )}
        {activeTab === 'info' && (
          <View style={[styles.panelScroll, { paddingHorizontal: 0, paddingTop: 0 }]}>
            <InfoContent nowPlaying={nowPlaying} />
          </View>
        )}
      </Animated.View>

      {/* ── Action buttons ── */}
      <View style={[styles.actionRow, { bottom: actionRowBottom }]} pointerEvents="box-none">
        {(['lyrics', 'queue', 'info'] as TabId[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.actionBtn, activeTab === tab && styles.actionBtnActive]}
            onPress={() => handleTabPress(tab)}
            activeOpacity={0.75}
          >
            <Text style={[styles.actionBtnText, activeTab === tab && styles.actionBtnTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Add to playlist modal ── */}
      {showPlaylistModal && (
        <AddToPlaylistModal
          visible={showPlaylistModal}
          nowPlaying={nowPlaying}
          onClose={() => setShowPlaylistModal(false)}
          onNavigateToCreate={() => {
            setShowPlaylistModal(false);
            // Wait for the native Modal dismiss animation to finish before
            // navigating — dispatching while the modal is animating drops
            // the action. Also close the full-screen player so it doesn't
            // sit on top of the CreatePlaylist screen.
            InteractionManager.runAfterInteractions(() => {
              closeFullScreenPlayer();
              navigation.dispatch(StackActions.push('CreatePlaylist', {
                initialPost: {
                  postId: nowPlaying.postId,
                  title: nowPlaying.title,
                  artistName: nowPlaying.artistName,
                  coverArtUrl: nowPlaying.coverArtUrl,
                },
              }));
            });
          }}
        />
      )}
    </Animated.View>
  );
}

// ─── Compact stats strip (separate component to keep re-renders isolated) ────

function CompactStats({ nowPlaying }: { nowPlaying: NowPlayingInfo }) {
  const { setNowPlaying } = usePlayback();
  const [liked, setLiked] = useState(nowPlaying.viewerHasLiked);
  const [count, setCount] = useState(nowPlaying.likesCount);

  useEffect(() => {
    setLiked(nowPlaying.viewerHasLiked);
    setCount(nowPlaying.likesCount);
  }, [nowPlaying.postId, nowPlaying.viewerHasLiked, nowPlaying.likesCount]);

  const handleLike = useCallback(async () => {
    const prev = liked;
    const prevCount = count;
    const next = !prev;
    setLiked(next);
    setCount(prevCount + (next ? 1 : -1));
    try {
      const serverLiked = await toggleLike(nowPlaying.postId);
      const finalCount = prevCount + (serverLiked ? 1 : 0);
      setLiked(serverLiked);
      setCount(finalCount);
      // Write back to PlaybackContext so the add-to-playlist modal reads the
      // correct liked state when it opens after a like/unlike here.
      setNowPlaying({ ...nowPlaying, viewerHasLiked: serverLiked, likesCount: finalCount });
    } catch {
      setLiked(prev);
      setCount(prevCount);
    }
  }, [liked, count, nowPlaying, setNowPlaying]);

  return (
    <View style={csSt.row}>
      <TouchableOpacity style={csSt.item} onPress={handleLike} activeOpacity={0.7}>
        <Text style={[csSt.icon, liked && csSt.iconLiked]}>{liked ? '♥' : '♡'}</Text>
        <Text style={[csSt.val, liked && csSt.valLiked]}>{formatCount(count)}</Text>
      </TouchableOpacity>
      <View style={csSt.item}>
        <Text style={csSt.icon}>💬</Text>
        <Text style={csSt.val}>{formatCount(nowPlaying.commentsCount)}</Text>
      </View>
      <View style={csSt.item}>
        <Text style={csSt.icon}>↻</Text>
        <Text style={csSt.val}>{formatCount(nowPlaying.repostsCount)}</Text>
      </View>
      <View style={csSt.item}>
        <Text style={csSt.icon}>▶</Text>
        <Text style={csSt.val}>{formatCount(nowPlaying.viewsCount)}</Text>
      </View>
    </View>
  );
}

const csSt = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  icon: { color: COLORS.white, fontSize: 16, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  iconLiked: { color: '#FF4D6D' },
  val: { color: COLORS.white, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  valLiked: { color: '#FF4D6D' },
});

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },

  // Full-bleed media fills entire container
  albumArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  albumArtFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.card, overflow: 'hidden' },
  fallbackBlobA: {
    position: 'absolute', width: SCREEN_W * 0.8, height: SCREEN_W * 0.8,
    borderRadius: SCREEN_W * 0.4, backgroundColor: COLORS.purple, opacity: 0.4,
    top: -SCREEN_W * 0.2, left: -SCREEN_W * 0.1,
  },
  fallbackBlobB: {
    position: 'absolute', width: SCREEN_W * 0.6, height: SCREEN_W * 0.6,
    borderRadius: SCREEN_W * 0.3, backgroundColor: '#EC4899', opacity: 0.3,
    bottom: -SCREEN_W * 0.15, right: -SCREEN_W * 0.1,
  },
  video: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },

  // Gradient scrims — dark top and bottom bands so text is readable over media
  scrimTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 260,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  scrimBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 340,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },

  // Header overlay — absolutely positioned at top
  header: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: {
    color: COLORS.white, fontSize: 28, fontWeight: '300', lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  headerTitle: {
    flex: 1, color: COLORS.white, fontSize: 13, fontWeight: '600',
    letterSpacing: 0.3, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  addBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: {
    color: COLORS.white, fontSize: 28, fontWeight: '300', lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  repostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    fontSize: 12,
    lineHeight: 14,
  },
  repostBtnLabel: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Credits column — top-left below header
  creditsPos: { position: 'absolute', left: 20, paddingTop: 8 },

  // Bottom overlay — track title + artist + stats
  bottomInfo: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24 },
  trackTitle: {
    color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  artistName: {
    color: COLORS.white, fontSize: 15, fontWeight: '500', marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },

  seekRow: { position: 'absolute', left: 0, right: 0 },


  contentPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: COLORS.border,
  },
  panelHandleArea: { alignItems: 'center', paddingVertical: 12 },
  panelHandleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  panelTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 20, gap: 4,
  },
  panelTab: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  panelTabActive: { borderBottomColor: COLORS.purple },
  panelTabText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  panelTabTextActive: { color: COLORS.purpleLight },
  panelScroll: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },

  placeholderText: { color: COLORS.textMuted, fontSize: 14, lineHeight: 22 },

  actionRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 12, paddingHorizontal: 24,
  },
  actionBtn: {
    flex: 1, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnActive: {
    backgroundColor: COLORS.purpleDim, borderColor: COLORS.purple,
    shadowColor: COLORS.purple, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  actionBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  actionBtnTextActive: { color: COLORS.purpleLight },
});
