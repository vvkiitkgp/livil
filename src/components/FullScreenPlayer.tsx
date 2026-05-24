import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SeekBar from './SeekBar';
import { usePlayback, type NowPlayingInfo, type RepeatMode } from '../contexts/PlaybackContext';
import { fetchTrackCollaborators, type TrackCollaboratorInfo } from '../services/tracks';
import { toggleLike } from '../services/posts';
import { COLORS } from '../theme/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TAB_BAR_H = Platform.OS === 'ios' ? 84 : 64;
const PLAYER_BOTTOM = Math.max(SCREEN_H * 0.1, TAB_BAR_H + 10);
const FLOAT_D = 60;

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

/** Polls position/duration at 4 Hz — isolated so only this view re-renders. */
function FullScreenSeekBar() {
  const { positionRef, durationRef, handlersRef } = usePlayback();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPosition(positionRef.current);
      setDuration(durationRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [positionRef, durationRef]);

  const handleSeekEnd = useCallback(
    (s: number) => { handlersRef.current?.seek(s); },
    [handlersRef],
  );

  return (
    <View style={seekSt.wrap}>
      <View style={seekSt.timeRow}>
        <Text style={seekSt.time}>{formatTime(position)}</Text>
        <Text style={seekSt.time}>{formatTime(duration)}</Text>
      </View>
      <SeekBar position={position} duration={duration} onSeekEnd={handleSeekEnd} />
    </View>
  );
}

const seekSt = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingBottom: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  time: { color: COLORS.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
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
 */
function CreditsWidget({ nowPlaying }: { nowPlaying: NowPlayingInfo }) {
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
      {/* Author — bigger circle */}
      <CollabAvatar uri={nowPlaying.authorAvatarUrl} name={nowPlaying.artistName} size={52} />

      {/* One row per role */}
      {groups.map(g => (
        <View key={g.role} style={cwSt.roleRow}>
          <Text style={cwSt.emoji}>{roleEmoji(g.role)}</Text>
          <View style={cwSt.avRow}>
            {g.members.slice(0, 3).map((m, i) => (
              <View key={m.userId ?? `c${i}`} style={i > 0 ? cwSt.overlap : undefined}>
                <CollabAvatar
                  uri={m.avatarUrl}
                  name={m.displayName ?? m.username ?? '?'}
                  size={28}
                />
              </View>
            ))}
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
    queueRef,
    shuffleEnabled,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
  } = usePlayback();

  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [fsPaused, setFsPaused] = useState(true);
  const [queueSnapshot, setQueueSnapshot] = useState<NowPlayingInfo[]>([]);
  const videoRef = useRef<VideoRef>(null);
  const initialSeekDone = useRef(false);

  // ── Open / close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFullScreenOpen) {
      Animated.spring(slideAnim, { toValue: 1, bounciness: 4, speed: 12, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }).start();
      panelAnim.setValue(0);
      setActiveTab(null);
    }
  }, [isFullScreenOpen, slideAnim, panelAnim]);

  // ── Video handoff ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nowPlaying || nowPlaying.mediaKind !== 'video') { return; }
    if (isFullScreenOpen) {
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
      unregisterHandlers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreenOpen]);

  // ── Queue snapshot (current + upcoming) ──────────────────────────────────
  useEffect(() => {
    if (!isFullScreenOpen) { return; }
    const all = queueRef.current;
    const idx = all.findIndex(q => q.postId === nowPlaying?.postId);
    setQueueSnapshot(idx >= 0 ? all.slice(idx) : all);
  }, [isFullScreenOpen, queueRef, nowPlaying?.postId]);

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

  // ── Swipe-down-to-close ───────────────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 500) { closeFullScreenPlayer(); }
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
  const panelScrollPad = PLAYER_BOTTOM + FLOAT_D + 24 + 44 + safeBottom + 16;
  const actionRowBottom = safeBottom + 8;
  const controlRowBottom = PLAYER_BOTTOM + (FLOAT_D - 44) / 2;
  const seekRowBottom = PLAYER_BOTTOM + FLOAT_D + 8;
  const containerTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const panelTranslateY = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  if (!nowPlaying) { return null; }

  // ── Queue item ────────────────────────────────────────────────────────────
  const renderQueueItem = ({ item }: ListRenderItemInfo<NowPlayingInfo>) => {
    const isCurrent = item.postId === nowPlaying.postId;
    return (
      <View style={[styles.queueItem, isCurrent && styles.queueItemActive]}>
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={styles.queueCover} />
        ) : (
          <View style={[styles.queueCover, styles.queueCoverFallback]} />
        )}
        <View style={styles.queueItemMeta}>
          <Text style={[styles.queueItemTitle, isCurrent && styles.queueItemTitleActive]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.queueItemArtist} numberOfLines={1}>{item.artistName}</Text>
        </View>
        {isCurrent && <View style={styles.queueActiveDot} />}
      </View>
    );
  };

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: containerTranslateY }] }]}
      pointerEvents={isFullScreenOpen ? 'box-none' : 'none'}
    >
      {/* ── Full-bleed media ── */}
      <View style={StyleSheet.absoluteFillObject}>
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

      {/* ── Dark scrims for text readability ── */}
      <View style={styles.scrimTop} pointerEvents="none" />
      <View style={styles.scrimBottom} pointerEvents="none" />

      {/* ── Overlaid content + swipe-to-close ── */}
      <GestureDetector gesture={panGesture}>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">

          {/* Header */}
          <View style={[styles.header, { top: safeTop, height: HEADER_H }]}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={closeFullScreenPlayer}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeBtnText}>⌄</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{nowPlaying.title}</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Credits widget — top-left, below header */}
          <View style={[styles.creditsPos, { top: safeTop + HEADER_H }]}>
            <CreditsWidget nowPlaying={nowPlaying} />
          </View>

          {/* Track title + artist + engagement stats — bottom overlay */}
          <View style={[styles.bottomInfo, { bottom: seekRowBottom + 56 }]}>
            <Text style={styles.trackTitle} numberOfLines={2}>{nowPlaying.title}</Text>
            <Text style={styles.artistName} numberOfLines={1}>{nowPlaying.artistName}</Text>
            <CompactStats nowPlaying={nowPlaying} />
          </View>

        </View>
      </GestureDetector>

      {/* ── Seek bar + time labels ── */}
      <View style={[styles.seekRow, { bottom: seekRowBottom }]} pointerEvents="box-none">
        <FullScreenSeekBar />
      </View>

      {/* ── Shuffle (left) + FloatingPlayer zone + Repeat (right) ── */}
      <View style={[styles.controlsRow, { bottom: controlRowBottom }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={toggleShuffle}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ShuffleIcon active={shuffleEnabled} />
        </TouchableOpacity>
        <View style={styles.controlCenter} />
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={cycleRepeatMode}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <RepeatIcon mode={repeatMode} />
        </TouchableOpacity>
      </View>

      {/* ── Content panel ── */}
      <Animated.View
        style={[styles.contentPanel, { top: panelTop, transform: [{ translateY: panelTranslateY }] }]}
        pointerEvents={activeTab ? 'box-none' : 'none'}
      >
        <TouchableOpacity style={styles.panelHandleArea} onPress={closePanel}>
          <View style={styles.panelHandleBar} />
        </TouchableOpacity>

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
          <FlatList
            data={queueSnapshot}
            keyExtractor={(item) => item.postId}
            renderItem={renderQueueItem}
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPad }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.placeholderText}>Queue is empty</Text>}
          />
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
    </Animated.View>
  );
}

// ─── Compact stats strip (separate component to keep re-renders isolated) ────

function CompactStats({ nowPlaying }: { nowPlaying: NowPlayingInfo }) {
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
      if (serverLiked !== next) {
        setLiked(serverLiked);
        setCount(prevCount + (serverLiked ? 1 : 0));
      }
    } catch {
      setLiked(prev);
      setCount(prevCount);
    }
  }, [liked, count, nowPlaying.postId]);

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
    paddingTop: 10,
    paddingBottom: 4,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  icon: { color: COLORS.textSecondary, fontSize: 16 },
  iconLiked: { color: '#FF4D6D' },
  val: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  valLiked: { color: '#FF4D6D' },
});

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },

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
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  headerTitle: {
    flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600',
    letterSpacing: 0.3, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  headerSpacer: { width: 44 },

  // Credits column — top-left below header
  creditsPos: { position: 'absolute', left: 20, paddingTop: 8 },

  // Bottom overlay — track title + artist + stats
  bottomInfo: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24 },
  trackTitle: {
    color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  artistName: {
    color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '500', marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },

  seekRow: { position: 'absolute', left: 0, right: 0 },

  controlsRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
  },
  controlBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  controlCenter: { flex: 1 },

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

  queueItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4, gap: 12, borderRadius: 10,
  },
  queueItemActive: { backgroundColor: COLORS.purpleDim },
  queueCover: { width: 44, height: 44, borderRadius: 8, backgroundColor: COLORS.card },
  queueCoverFallback: { backgroundColor: COLORS.purpleDim },
  queueItemMeta: { flex: 1, minWidth: 0 },
  queueItemTitle: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  queueItemTitleActive: { color: COLORS.purpleLight },
  queueItemArtist: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  queueActiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple },

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
  actionBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  actionBtnTextActive: { color: COLORS.purpleLight },
});
