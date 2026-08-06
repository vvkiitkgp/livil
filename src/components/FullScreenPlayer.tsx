import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AppState,
  BackHandler,
} from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ArtGlow from './ArtGlow';
import { useImageAspect } from '../hooks/useImageAspect';
import { haptics } from '../utils/haptics';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
  withRepeat,
  cancelAnimation,
  Easing as REasing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ClipRangeSlider from './ClipRangeSlider';
import CollabAvatar from './CollabAvatar';
import QueueList from './QueueList';
import { resolveAuthorDisplay } from '../utils/authorDisplay';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import { fetchTrackCollaborators, type TrackCollaboratorInfo } from '../services/tracks';
import { fetchAlbumForTrack, type AlbumForTrack } from '../services/albums';
import { toggleLike, fetchPostMetrics, fetchTrackPlaysTotal } from '../services/posts';
import CommentsSheet from './CommentsSheet';
import PostLikersSheet from './PostLikersSheet';
import {
  fetchUserPlaylists,
  isPostInPlaylist,
  addPostToPlaylist,
  type UserPlaylist,
} from '../services/playlists';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon, type IconName } from './Icon';
import type { RootStackParamList } from '../navigation/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const FLOAT_D = 60;
// First-render estimate for the bottom title/artist/stats block, replaced by the
// real onLayout height. Only used to size the audio cover-art gap, so a slightly
// wrong guess costs at most one silent re-layout on the very first frame.
const BOTTOM_INFO_EST_H = 92;
// Corner rounding of the lifted cover-art card.
const ART_RADIUS = 22;
/**
 * Set once the user taps into clean view. Module scope, NOT persisted: the hint
 * is session-scoped, so it retires for this app run and returns on the next cold
 * start (the module is re-evaluated). At module scope rather than in a ref so a
 * component remount cannot re-arm it mid-session.
 */
let zoomHintLearnedThisSession = false;
/**
 * Delay before the hint shows — just long enough to clear the open burst so the
 * pill doesn't ride the scale-up animation.
 */
const ZOOM_HINT_DELAY = 500;
// Breathing room between the cover art and the header / title block.
const ART_GAP_TOP = 12;
const ART_GAP_BOTTOM = 16;
const ART_SIDE_PAD = 24;
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

type EffectivePost = {
  postId: string;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewerHasLiked: boolean;
  /** True when the player surface is targeting an original post for a repost. */
  isOriginal: boolean;
};

/**
 * In FullScreenPlayer, engagement (likes + comments + reposts) always targets
 * the music's canonical post. When the playing item is a repost, that's the
 * original upload — not the repost. The original* fields on NowPlayingInfo
 * are hydrated on mount via `fetchPostMetrics`.
 */
function getEffectivePost(nowPlaying: NowPlayingInfo): EffectivePost {
  if (nowPlaying.kind === 'repost' && nowPlaying.originalPostId) {
    return {
      postId: nowPlaying.originalPostId,
      likesCount: nowPlaying.originalLikesCount ?? nowPlaying.likesCount,
      commentsCount: nowPlaying.originalCommentsCount ?? nowPlaying.commentsCount,
      repostsCount: nowPlaying.originalRepostsCount ?? nowPlaying.repostsCount,
      viewerHasLiked: nowPlaying.originalViewerHasLiked ?? nowPlaying.viewerHasLiked,
      isOriginal: true,
    };
  }
  return {
    postId: nowPlaying.postId,
    likesCount: nowPlaying.likesCount,
    commentsCount: nowPlaying.commentsCount,
    repostsCount: nowPlaying.repostsCount,
    viewerHasLiked: nowPlaying.viewerHasLiked,
    isOriginal: false,
  };
}

function formatCount(n: number): string {
  if (n < 1000) { return String(n); }
  if (n < 1_000_000) { return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`; }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function roleIcon(role: string): IconName {
  const map: Record<string, IconName> = {
    'Vocals': 'mic', 'Lead Vocals': 'mic', 'Backing Vocals': 'mic',
    'Drums': 'drum',
    'Piano': 'piano', 'Keys': 'piano',
    'Guitar': 'guitar', 'Bass': 'guitar',
    'Production': 'faders', 'Mixing': 'faders', 'Mastering': 'faders',
    'Songwriting': 'pencilLine', 'Lyrics': 'note',
    'Featured': 'star',
  };
  // Every AI_ROLES entry, without restating the list: one glyph for the group, because the
  // point of the mark is "a tool did this".
  if (role.startsWith('AI ')) {return 'ai';}
  // A typed-in role — 'Tabla', 'Additional production' — has no glyph of its own, and
  // inventing a wrong one would say more than nothing does.
  return map[role] ?? 'musicNote';
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
  const {
    positionRef, durationRef, handlersRef, nowPlaying, clipWindowRef, markSeekTarget,
    bumpClipVersion,
  } = usePlayback();
  // Lazy-init from refs so handles appear at correct positions the moment the
  // full-screen player opens, without waiting for the first polling tick.
  const [position, setPosition] = useState(() => positionRef.current);
  const [duration, setDuration] = useState(() => durationRef.current);

  // Last known good duration. durationRef briefly drops to 0 between tracks
  // (before the new video's onLoad fires) — without this fallback the bar
  // would collapse and the layout would jump every track change.
  const lastDurationRef = useRef(duration);
  if (duration > 0) { lastDurationRef.current = duration; }
  const displayDuration = duration > 0 ? duration : lastDurationRef.current;

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

  // Poll positionRef/durationRef at 10 Hz. Tighter than 250 ms so the thumb
  // looks smoother, but plain — no rAF interpolation (jittery onProgress
  // samples cause the projection to snap back, visible as flicker).
  const lastLoggedDurRef = useRef(-1);
  useEffect(() => {
    const id = setInterval(() => {
      const p = positionRef.current;
      const d = durationRef.current;
      setPosition(p);
      setDuration(d);
      // Only log duration transitions (0 ↔ non-zero). The 1-Hz heartbeat is
      // pulled — too noisy for normal playback investigation.
      const dWentLive = d > 0 && lastLoggedDurRef.current <= 0;
      const dWentDead = d <= 0 && lastLoggedDurRef.current > 0;
      if (dWentLive || dWentDead) {
        console.log(`[LIVIL][BAR] duration transition ${lastLoggedDurRef.current.toFixed(2)} -> ${d.toFixed(2)} (pos=${p.toFixed(2)})`);
      }
      lastLoggedDurRef.current = d;
    }, 100);
    return () => clearInterval(id);
  }, [positionRef, durationRef]);

  // Stable callbacks so ClipRangeSlider's panResponder useMemo doesn't
  // recreate on every polling tick.
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
      markSeekTarget(s);
      handlersRef.current?.seek(s);
    }
    // Push the new clip window to native so the lock-screen clip-relative timeline
    // (duration / scrubber) updates for the current track. Bump on RELEASE only —
    // the in-app slider already tracks the drag live; the notification isn't
    // visible while editing in-app, and per-tick pushes would thrash the session.
    bumpClipVersion();
  }, [clipWindowRef, handlersRef, markSeekTarget, bumpClipVersion]);

  // Seek handle (blue circle): scrubs to the chosen position.
  // Never calls play() — if the song was paused, it stays paused after the scrub.
  // markSeekTarget pre-commits positionRef and arms the guard so stale onProgress
  // samples from the native player don't rubber-band the bar back to the
  // pre-seek position before the seek lands.
  const handleSeekEnd = useCallback((s: number) => {
    markSeekTarget(s);
    setPosition(s);
    handlersRef.current?.seek(s);
  }, [handlersRef, markSeekTarget]);

  const start = localStart ?? 0;
  const end = localEnd ?? displayDuration;

  return (
    <View style={seekSt.wrap}>
      <View style={seekSt.timeRow}>
        <Text style={seekSt.time}>{formatTime(position)}</Text>
        <Text style={seekSt.time}>{formatTime(displayDuration)}</Text>
      </View>
      <ClipRangeSlider
        duration={displayDuration > 0 ? displayDuration : 1}
        position={position}
        start={start}
        end={end}
        minClipSeconds={2}
        edgeInset={20}
        onChange={handleClipChange}
        onChangeEnd={handleClipChangeEnd}
        onSeekEnd={handleSeekEnd}
      />
    </View>
  );
}

const seekSt = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingBottom: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  time: { color: COLORS.white, fontSize: 12, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
});

/**
 * One-line credit under the song title: a stack of faces + "X · with A & B".
 * Tapping it opens the Info panel, which carries the full role-by-role
 * breakdown — this line is the teaser, not the whole story.
 *
 * Replaces the old left-side CreditsWidget column, which drew the same people
 * over the artwork.
 */
function CreditLine({
  nowPlaying,
  onPress,
}: {
  nowPlaying: NowPlayingInfo;
  onPress: () => void;
}) {
  const [collabs, setCollabs] = useState<TrackCollaboratorInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Clear on track change so the previous song's collaborators can't sit
    // under the new title for the length of the fetch.
    setCollabs([]);
    fetchTrackCollaborators(nowPlaying.trackId)
      .then(data => { if (!cancelled) { setCollabs(data); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nowPlaying.trackId]);

  const author = resolveAuthorDisplay({ displayName: nowPlaying.artistName });

  // One person can hold several roles (singer AND producer) and the uploader is
  // usually credited on their own track — dedupe both, or the line reads
  // "Vvk · with Vvk & Vvk".
  //
  // Dropped entirely (face AND the "& N others" count):
  //  • DELETED accounts — `(user_id null, custom_name null)` resolves to the
  //    "[deleted]" placeholder, which has no business in a credit line.
  //  • Nameless rows — a live collaborator whose profile join missed; the name
  //    is '' and a blank chip is worse than an absent one.
  const others = useMemo(() => {
    const seen = new Set<string>([nowPlaying.authorId]);
    const out: TrackCollaboratorInfo[] = [];
    for (const c of collabs) {
      if (c.display.isDeleted || !c.display.name.trim()) { continue; }
      const key = c.userId ?? `name:${c.display.name.trim().toLowerCase()}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      out.push(c);
    }
    return out;
  }, [collabs, nowPlaying.authorId]);

  // 1 → "Ravi" · 2 → "Ravi & Arjun" · 3+ → "Ravi & 4 others"
  const withNames =
    others.length === 0 ? null
    : others.length === 1 ? others[0]!.display.name
    : others.length === 2 ? `${others[0]!.display.name} & ${others[1]!.display.name}`
    : `${others[0]!.display.name} & ${others.length - 1} others`;

  const faces = [
    { key: 'author', uri: nowPlaying.authorAvatarUrl, display: author },
    ...others.slice(0, 2).map((c, i) => ({
      key: c.userId ?? `c${i}`,
      uri: c.avatarUrl,
      display: c.display,
    })),
  ];

  return (
    <TouchableOpacity
      style={clSt.row}
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={
        withNames
          ? `${author.name}, with ${withNames}. Open info.`
          : `${author.name}. Open info.`
      }
    >
      {/* Rendered REVERSED inside a row-reverse stack. Visual order is unchanged
          (uploader leftmost), but siblings paint in child order — so reversing
          makes each face sit ON TOP of the one to its right, with the uploader
          highest. Doing it this way instead of zIndex keeps the paint order a
          property of the layout, which Android honours without elevation (which
          would paint a grey smudge behind each circle). */}
      <View style={clSt.stack}>
        {faces.slice().reverse().map((f, i, arr) => (
          <View key={f.key} style={i < arr.length - 1 ? clSt.overlap : undefined}>
            <CollabAvatar uri={f.uri} display={f.display} size={26} />
          </View>
        ))}
      </View>
      <Text style={clSt.text} numberOfLines={1}>
        {author.name}
        {withNames ? (
          <>
            <Text style={clSt.muted}> · with </Text>
            {withNames}
          </>
        ) : null}
      </Text>
    </TouchableOpacity>
  );
}

const clSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  // row-reverse + a reversed children array — see the comment at the call site.
  stack: { flexDirection: 'row-reverse', alignItems: 'center' },
  // Applied to every face except the visually-leftmost (the uploader), so each
  // circle tucks 10dp under its left-hand neighbour.
  overlap: { marginLeft: -10 },
  text: {
    flex: 1, color: COLORS.white, fontSize: 13, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  muted: { color: COLORS.textSecondary, fontWeight: '600' },
});

/** Info tab: artist + collaborators by role + engagement stats. */
function InfoContent({
  nowPlaying,
  onCommentsPress,
  onLikesPress,
  trackPlaysTotal,
}: {
  nowPlaying: NowPlayingInfo;
  onCommentsPress: () => void;
  onLikesPress: (postId: string) => void;
  trackPlaysTotal: number;
}) {
  const { setNowPlaying, closeFullScreenPlayer } = usePlayback();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const effective = getEffectivePost(nowPlaying);
  const [collabs, setCollabs] = useState<TrackCollaboratorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [album, setAlbum] = useState<AlbumForTrack | null>(null);
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

  // Fetch album membership for the "Go to album" row in the Info card. Falls
  // back to null (row hidden) when the track is not in any album, or on error.
  useEffect(() => {
    let cancelled = false;
    setAlbum(null);
    fetchAlbumForTrack(nowPlaying.trackId)
      .then(data => { if (!cancelled) { setAlbum(data); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nowPlaying.trackId]);

  // Reset like state if the effective post changes (resolves to original for reposts).
  useEffect(() => {
    setLiked(effective.viewerHasLiked);
    setLikesCount(effective.likesCount);
  }, [effective.postId, effective.viewerHasLiked, effective.likesCount]);

  const handleToggleLike = useCallback(async () => {
    const prev = liked;
    const prevCount = likesCount;
    const next = !prev;
    if (next) { haptics.toggleOn(); }
    setLiked(next);
    setLikesCount(prevCount + (next ? 1 : -1));
    try {
      const serverLiked = await toggleLike(effective.postId);
      const finalCount = prevCount + (serverLiked ? 1 : 0);
      if (serverLiked !== next) {
        setLiked(serverLiked);
        setLikesCount(finalCount);
      }
      // Write back to PlaybackContext so CompactStats (and any other consumer
      // of nowPlaying.likesCount / viewerHasLiked) stays in sync.
      if (effective.isOriginal) {
        setNowPlaying({
          ...nowPlaying,
          originalViewerHasLiked: serverLiked,
          originalLikesCount: finalCount,
        });
      } else {
        setNowPlaying({ ...nowPlaying, viewerHasLiked: serverLiked, likesCount: finalCount });
      }
    } catch {
      setLiked(prev);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, effective.postId, effective.isOriginal, nowPlaying, setNowPlaying]);


  return (
    <ScrollView
      style={infoSt.scroll}
      contentContainerStyle={infoSt.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Artist row — tap minimizes the player then pushes UserProfile. ── */}
      <TouchableOpacity
        style={infoSt.artistRow}
        activeOpacity={0.75}
        onPress={() => {
          closeFullScreenPlayer();
          navigation.dispatch(StackActions.push('UserProfile', { userId: nowPlaying.authorId }));
        }}
      >
        <CollabAvatar
          uri={nowPlaying.authorAvatarUrl}
          display={resolveAuthorDisplay({ displayName: nowPlaying.artistName })}
          size={52}
        />
        <View style={infoSt.artistMeta}>
          <Text style={infoSt.artistName} numberOfLines={1}>{nowPlaying.artistName}</Text>
          <Text style={infoSt.artistHandle} numberOfLines={1}>@{nowPlaying.authorUsername}</Text>
        </View>
      </TouchableOpacity>

      {/* ── Album row (hidden when track is not in any album) ── */}
      {album ? (
        <TouchableOpacity
          style={infoSt.albumRow}
          activeOpacity={0.75}
          onPress={() => {
            // Minimize the full-screen player back to the floating pill before
            // pushing so the destination screen is what the user sees and
            // playback continues uninterrupted. Matches handleNavigateToUser.
            closeFullScreenPlayer();
            navigation.dispatch(StackActions.push('AlbumDetail', { albumId: album.albumId, albumTitle: album.title }));
          }}
        >
          <View style={infoSt.albumDisc}>
            <Icon name="disc" size={16} color={COLORS.white} />
          </View>
          <View style={infoSt.albumMeta}>
            <Text style={infoSt.albumLabel}>ALBUM</Text>
            <Text style={infoSt.albumTitle} numberOfLines={1}>{album.title}</Text>
          </View>
          <Icon name="forward" size={18} color={COLORS.purpleLight} />
        </TouchableOpacity>
      ) : null}

      {/* ── Collaborators ── */}
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.purpleLight} style={{ marginTop: 20 }} />
      ) : collabs.length > 0 ? (
        <View style={infoSt.creditsBlock}>
          <Text style={infoSt.creditsLabel}>CREDITS</Text>
          {/* One row per credit, not per role. Grouping by role collapsed the people into
              an anonymous avatar stack — a credit is somebody's NAME, and a list of faces
              with a job title next to them is not a credit list. */}
          {collabs.map((c, i) => {
            const tappable = Boolean(c.userId) && !c.display.isDeleted;
            return (
              <TouchableOpacity
                key={c.userId ?? `custom-${i}`}
                style={infoSt.roleRow}
                activeOpacity={tappable ? 0.75 : 1}
                disabled={!tappable}
                onPress={() => {
                  closeFullScreenPlayer();
                  navigation.dispatch(StackActions.push('UserProfile', { userId: c.userId! }));
                }}
              >
                <View style={infoSt.roleEmoji}>
                  <Icon name={roleIcon(c.role)} size={24} color={COLORS.textSecondary} />
                </View>
                <CollabAvatar
                  uri={c.avatarUrl}
                  display={c.display}
                  size={36}
                  pending={c.status === 'pending'}
                />
                <View style={infoSt.roleNameCol}>
                  <Text style={infoSt.collabName} numberOfLines={1}>{c.display.name}</Text>
                  <Text style={infoSt.roleName} numberOfLines={1}>{c.role}</Text>
                </View>
                {/* A clock, not the words "awaiting confirmation": the row already carries
                    a name and a role, and a third line of amber text turned every
                    unanswered credit into the loudest thing on the screen. */}
                {c.status === 'pending' ? (
                  <Icon name="pending" size={16} color={COLORS.warning} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {/* ── Engagement stats ──
          Interactive (like + comments) on the left.
          Passive info pill on the right shows plays (cumulative track plays
          across every post using this track) and reposts (how many times the
          original was reposted). Both are read-only — grouping them in a
          pill makes their non-interactive nature obvious. */}
      <View style={infoSt.statsRow}>
        <View style={infoSt.activeGroup}>
          <View style={infoSt.statBtn}>
            <TouchableOpacity onPress={handleToggleLike} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Icon name="heart" size={18} color={liked ? '#FF4D6D' : COLORS.textSecondary} weight={liked ? 'fill' : 'regular'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onLikesPress(effective.postId)}
              activeOpacity={0.7}
              disabled={likesCount === 0}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={[infoSt.statValue, liked && infoSt.statValueLiked]}>
                {formatCount(likesCount)}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={infoSt.statBtn} onPress={onCommentsPress} activeOpacity={0.7}>
            <Icon name="comment" size={18} color={COLORS.textSecondary} />
            <Text style={infoSt.statValue}>{formatCount(effective.commentsCount)}</Text>
          </TouchableOpacity>
        </View>

        <View style={infoSt.passivePill}>
          <View style={infoSt.passiveItem}>
            <Icon name="play" size={13} color={COLORS.textMuted} />
            <Text style={infoSt.passiveValue}>{formatCount(trackPlaysTotal)}</Text>
          </View>
          <View style={infoSt.passiveDivider} />
          <View style={infoSt.passiveItem}>
            {/* Matches the Repost button glyph in PostCard for consistency. */}
            <Icon name="repost" size={13} color={COLORS.textMuted} />
            <Text style={infoSt.passiveValue}>{formatCount(effective.repostsCount)}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const infoSt = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  albumRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 14, marginBottom: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.4)',
  },
  albumDisc: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.purple, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  albumMeta: { flex: 1, minWidth: 0 },
  albumLabel: { color: COLORS.purpleLight, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  albumTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700', marginTop: 1 },
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
  roleEmoji: { width: 32, alignItems: 'center' },
  roleNameCol: { flex: 1 },
  collabName: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  roleName: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingTop: 20, marginTop: 4,
  },
  activeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  statBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statValueLiked: { color: '#FF4D6D' },
  passivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passiveItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  passiveDivider: { width: 1, height: 14, backgroundColor: COLORS.border, marginHorizontal: 10 },
  passiveValue: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
    if (next) { haptics.toggleOn(); }
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
              <View style={[modalSt.rowThumb, { backgroundColor: COLORS.purple }]}>
                <Icon name="heart" size={20} color={COLORS.white} weight="fill" />
              </View>
              <View style={modalSt.rowMeta}>
                <Text style={modalSt.rowName}>Liked Songs</Text>
              </View>
              {liked && <Icon name="check" size={18} color={COLORS.purpleLight} />}
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
                  {added && <Icon name="check" size={18} color={COLORS.purpleLight} />}
                </TouchableOpacity>
              );
            })}

            {/* New playlist */}
            <TouchableOpacity style={modalSt.row} onPress={onNavigateToCreate} activeOpacity={0.7}>
              <View style={[modalSt.rowThumb, { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }]}>
                <Icon name="add" size={22} color={COLORS.purpleLight} />
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
  rowThumbText: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  rowMeta: { flex: 1, minWidth: 0 },
  rowName: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

});


// ─── Main component ───────────────────────────────────────────────────────────

export default function FullScreenPlayer() {
  // FullScreenPlayer no longer drives playback — GlobalAudioPlayer is the single
  // audio engine + MediaSession owner for every post (audio AND video). This
  // component now renders a MUTED, foreground-only <Video> that mirrors the
  // engine's picture and seeks itself to follow GAP's position. So it needs only
  // read-side context: nowPlaying, the position ref to chase, the FS-open /
  // foreground / engine flags that gate the frame, and the buffering spinner.
  const {
    nowPlaying,
    setNowPlaying,
    bumpCommentsCount,
    activePostId,
    isFullScreenOpen,
    closeFullScreenPlayer,
    isImmersive,
    setImmersive,
    toggleImmersive,
    positionRef,
    clipWindowRef,
    engineDriving,
    isBuffering,
    setVideoFrameBuffering,
    seekNonce,
  } = usePlayback();

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [likersPostId, setLikersPostId] = useState<string | null>(null);
  // Cumulative track plays — sum of views_count across every post (uploads +
  // reposts) using this track. PostCard no longer displays the per-post views,
  // so this is the only surface that shows plays at all.
  const [trackPlaysTotal, setTrackPlaysTotal] = useState<number>(0);

  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ── Player positioning (insets-aware) ─────────────────────────────────────
  // Computed here — not at module level — so insets.bottom (the real height of
  // the Android system nav bar / gesture strip on this specific device) is
  // baked in before driving layout and animations.
  const playerTabBarH  = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const playerBottom   = Math.max(SCREEN_H * 0.1, playerTabBarH + 56);
  const convergeY      = SCREEN_H / 2 - playerBottom - FLOAT_D / 2;

  // True only while the app is in the foreground. Gates the muted video frame:
  // the frame must never be mounted while backgrounded (GlobalAudioPlayer owns
  // background audio + the lock-screen MediaSession; a second hidden decoder
  // here would just waste battery and risk fighting it for the surface).
  const [appForeground, setAppForeground] = useState(true);

  // Rule 3 — when the app is backgrounded or the screen locks while a VIDEO is
  // open full-screen, auto-minimize the player. The audio keeps playing through
  // GlobalAudioPlayer + the MediaSession, and on return the user sees the
  // floating cover; re-opening FS brings the video back (rule 2). This is
  // YouTube Music's "video demotes to cover on background" behaviour.
  // We flip appForeground only on 'active' / 'background' — NOT 'inactive',
  // which also fires for transient Control-Center / notification-shade pulls and
  // would otherwise tear the frame down and back up with a black flash.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setAppForeground(true);
      } else if (state === 'background') {
        setAppForeground(false);
        if (isFullScreenOpen && nowPlaying?.mediaKind === 'video') {
          closeFullScreenPlayer();
        }
      }
    });
    return () => sub.remove();
  }, [isFullScreenOpen, nowPlaying?.mediaKind, closeFullScreenPlayer]);

  // NOTE: the player surface no longer navigates to a profile directly — the
  // credit line under the title opens the Info panel, whose artist and
  // collaborator rows own that navigation (they push UserProfile themselves).

  // The card is drawn at the artwork's OWN proportions, so we need its intrinsic
  // size. `null` until known — the render holds off rather than laying out a
  // guessed rectangle that pops to the real shape a frame later.
  const artAR = useImageAspect(
    nowPlaying ? (nowPlaying.coverArtUrl ?? nowPlaying.thumbnailUrl) : null,
  );

  // NOTE: lock-screen / notification / headset play-pause sync used to live here.
  // It now belongs to GlobalAudioPlayer (the single MediaSession owner) — its
  // onPlaybackStateChanged drives reportPaused/resumePlay for every post. The
  // muted frame below carries no notification controls, so it never receives
  // those events and must not try to mirror them.

  // Three independent native-driver values replace the old slideAnim/bounceAnim pair.
  // Keeping them separate avoids Animated.add() on interpolated values, which can
  // silently fall back to the JS driver on Android and break gesture detection.
  const posYAnim    = useRef(new Animated.Value(convergeY)).current;   // translateY
  const scaleAnim   = useRef(new Animated.Value(0.02)).current;         // scaleX / scaleY
  const opacityAnim = useRef(new Animated.Value(0)).current;            // opacity
  const panelAnim   = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  // Measured height of the bottom title/artist/stats block. Audio cover art is
  // centered in the gap ABOVE it, so the gap can only be computed once we know
  // how tall that block actually rendered (a 2-line title makes it taller).
  const [bottomInfoH, setBottomInfoH] = useState(BOTTOM_INFO_EST_H);
  // Buffering spinner for the video frame. ExoPlayer/AVPlayer fire onBuffer
  // while loading and onReadyForDisplay once the first frame is decodable.
  const [fsBuffering, setFsBuffering] = useState(false);
  const videoRef = useRef<VideoRef>(null);
  // Throttle drift-correcting frame seeks. The frame chases GlobalAudioPlayer's
  // positionRef; we re-seek only when it drifts past a threshold and only once
  // every ~600 ms so a seek doesn't fire on every onProgress tick.
  const frameSeekCooldownRef = useRef(0);
  // True while we're holding the audio for this buffering frame. Read inside
  // handleFrameProgress (a stable callback) to suppress drift-correction seeks
  // while gated: the audio clock is frozen, so chasing it would only yank the
  // picture back into an unbuffered region and trigger another stall.
  const videoGateRef = useRef(false);

  // ── Clean-view / pinch-zoom (video only) ──────────────────────────────────
  // The muted frame loads the full track and renders resizeMode="cover" by
  // default (the beautiful full-height look). To let the user pinch OUT to full
  // width we switch the base to resizeMode="contain" once the aspect ratio is
  // known (from onLoad) and apply a Reanimated scale transform: contain+scale
  // (coverScale) is pixel-identical to cover, so the default look is unchanged.
  // In clean view the user pinches scale ∈ [1 (contain/full-width), coverScale
  // (cover/full-height)] and pans within the cropped bounds. ALL of this is
  // compositing-only — it never touches positionRef, seek, drift, or the buffer
  // gate (those stay JS-thread, see handleFrameLoad/handleFrameProgress).
  const zoomScale  = useSharedValue(1);     // current render scale (contain base)
  const panX       = useSharedValue(0);
  const panY       = useSharedValue(0);
  const savedScale = useSharedValue(1);     // scale at gesture start
  const savedPanX  = useSharedValue(0);
  const savedPanY  = useSharedValue(0);
  const coverScaleSV = useSharedValue(1);   // cover-equivalent scale (zoom-in max)
  const dispWSV    = useSharedValue(SCREEN_W); // contain-fitted width  @ scale 1
  const dispHSV    = useSharedValue(SCREEN_H); // contain-fitted height @ scale 1
  // UI-thread mirrors of React state so the (stable, built-once) gesture tree
  // reads the latest value inside its worklets WITHOUT being rebuilt on toggle
  // (rebuilding mid-pinch would drop the active gesture).
  const immersiveSV = useSharedValue(false);
  const panelOpenSV = useSharedValue(false);
  const isVideoSV   = useSharedValue(false);
  // resizeMode stays "cover" until the aspect ratio is known, then flips to
  // "contain" the same instant zoomScale becomes coverScale — no letterbox flash.
  const [aspectKnown, setAspectKnown] = useState(false);

  useEffect(() => { immersiveSV.value = isImmersive; }, [isImmersive, immersiveSV]);
  useEffect(() => { panelOpenSV.value = activeTab !== null; }, [activeTab, panelOpenSV]);
  useEffect(() => {
    isVideoSV.value = nowPlaying?.mediaKind === 'video';
  }, [nowPlaying?.mediaKind, isVideoSV]);

  // Reset all zoom/clean-view state on every track change. Force-exits clean view
  // (so a video→audio advance can't strand the user in a controls-hidden view)
  // and clears the stale aspect ratio so the new track re-derives coverScale on
  // its onLoad — back to cover until then, never a wrong-aspect pop.
  useEffect(() => {
    setImmersive(false);
    setAspectKnown(false);
    zoomScale.value = 1; panX.value = 0; panY.value = 0;
    savedScale.value = 1; savedPanX.value = 0; savedPanY.value = 0;
    coverScaleSV.value = 1; dispWSV.value = SCREEN_W; dispHSV.value = SCREEN_H;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId]);

  // Controls hide/show (RN Animated, native driver — consistent with panelAnim).
  // 1 = controls shown, 0 = clean view. Header + credits slide up, the bottom
  // info / seek / action rows slide down, all fade out.
  const controlsAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(controlsAnim, {
      toValue: isImmersive ? 0 : 1,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [isImmersive, controlsAnim]);

  // ── "Tap and pinch" hint ──────────────────────────────────────────────────
  // Zoom is discoverable only by accident: pinch does nothing until clean view
  // is on, and clean view is itself an undocumented tap. So every time a VIDEO
  // opens full-screen, a pill flashes at the centre naming both. Audio has no
  // zoom, so it never shows there.
  //
  // SESSION-SCOPED: entering clean view retires it for the rest of this app run
  // and the next cold start offers it again — see zoomHintLearnedThisSession.
  const [zoomHintOn, setZoomHintOn] = useState(false);
  const zoomHintAnim = useRef(new Animated.Value(0)).current;

  // At most ONE showing per open — the pill greets you, it doesn't loop. Reset
  // on open/close and on a track change, so the next video gets its own.
  const zoomHintShownThisOpenRef = useRef(false);
  useEffect(() => {
    zoomHintShownThisOpenRef.current = false;
  }, [isFullScreenOpen, nowPlaying?.postId]);

  // Delayed past the open burst so the pill doesn't ride the scale-up animation.
  useEffect(() => {
    if (zoomHintLearnedThisSession) { return; }
    if (!isFullScreenOpen || nowPlaying?.mediaKind !== 'video') { return; }
    if (zoomHintShownThisOpenRef.current) { return; }
    const t = setTimeout(() => {
      zoomHintShownThisOpenRef.current = true;
      setZoomHintOn(true);
    }, ZOOM_HINT_DELAY);
    return () => clearTimeout(t);
  }, [isFullScreenOpen, nowPlaying?.mediaKind, nowPlaying?.postId]);

  // Found clean view → they know. Pull the pill down now and stay quiet for the
  // rest of this run.
  useEffect(() => {
    if (!isImmersive) { return; }
    zoomHintLearnedThisSession = true;
    setZoomHintOn(false);
    zoomHintAnim.setValue(0);
  }, [isImmersive, zoomHintAnim]);

  useEffect(() => {
    if (!zoomHintOn) { return; }
    const anim = Animated.sequence([
      Animated.timing(zoomHintAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1000),
      Animated.timing(zoomHintAnim, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) { setZoomHintOn(false); } });
    return () => anim.stop();
  }, [zoomHintOn, zoomHintAnim]);

  // Animated style for the muted video wrapper (Reanimated, UI thread).
  const videoZoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { scale: zoomScale.value },
    ],
  }));

  // ── Cover-art float (audio, while playing) ────────────────────────────────
  // A slow rise-and-settle, 0 → 1 → 0 forever. Deliberately long and shallow: at
  // this size anything faster or bigger stops reading as "floating" and starts
  // reading as a glitch. Runs entirely on the UI thread, so it keeps its cadence
  // while JS is busy with a feed fetch or an artwork decode.
  const artFloat = useSharedValue(0);
  // Playing == the engine is actively on THIS post (activePostId is null when
  // paused). Gated on the player being open so a backgrounded/minimized player
  // isn't animating a view nobody can see.
  const artFloating =
    isFullScreenOpen &&
    nowPlaying?.mediaKind !== 'video' &&
    activePostId === nowPlaying?.postId;
  useEffect(() => {
    if (artFloating) {
      artFloat.value = withRepeat(
        withTiming(1, { duration: 2000, easing: REasing.inOut(REasing.quad) }),
        -1,   // forever
        true, // reverse — the way back down is the same curve, so no snap
      );
    } else {
      // Cancel BEFORE retargeting: withRepeat keeps driving the value otherwise,
      // and the settle would be overwritten on the next frame.
      cancelAnimation(artFloat);
      artFloat.value = withTiming(0, { duration: 420, easing: REasing.out(REasing.quad) });
    }
  }, [artFloating, artFloat]);

  const artFloatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -7 * artFloat.value },
      { scale: 1 + 0.018 * artFloat.value },
    ],
  }));

  // ── Original-post metrics hydration (reposts only) ────────────────────────
  // When the currently playing item is a repost, the player surface shows the
  // original post's likes + comments + reposts — fetch those once per
  // (original) post id.
  useEffect(() => {
    if (!nowPlaying) { return; }
    if (nowPlaying.kind !== 'repost' || !nowPlaying.originalPostId) { return; }
    if (nowPlaying.originalCommentsCount !== undefined) { return; }
    const originalId = nowPlaying.originalPostId;
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchPostMetrics(originalId);
        if (cancelled) { return; }
        setNowPlaying({
          ...nowPlaying,
          originalLikesCount: m.likesCount,
          originalCommentsCount: m.commentsCount,
          originalRepostsCount: m.repostsCount,
          originalViewerHasLiked: m.viewerHasLiked,
        });
      } catch {
        // swallow — falls back to repost counts shown.
      }
    })();
    return () => { cancelled = true; };
  }, [nowPlaying, setNowPlaying]);

  // ── Track plays total ─────────────────────────────────────────────────────
  // Re-fetch whenever the playing track changes. Single-shot per track — the
  // count is small and we don't need live updates here.
  useEffect(() => {
    if (!nowPlaying?.trackId) {
      setTrackPlaysTotal(0);
      return;
    }
    const trackId = nowPlaying.trackId;
    let cancelled = false;
    (async () => {
      try {
        const total = await fetchTrackPlaysTotal(trackId);
        if (!cancelled) { setTrackPlaysTotal(total); }
      } catch {
        if (!cancelled) { setTrackPlaysTotal(0); }
      }
    })();
    return () => { cancelled = true; };
  }, [nowPlaying?.trackId]);

  // ── Open / close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFullScreenOpen) {
      // Start at the invisible dot at the floating-player circle, then spring
      // outward to full screen with a clear, graceful bounce (slower speed than
      // before so the overshoot reads as a pop bursting from the circle, not a snap).
      posYAnim.setValue(convergeY);
      scaleAnim.setValue(0.02);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(posYAnim,  { toValue: 0, speed: 10, bounciness: 12, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, speed: 10, bounciness: 12, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      panelAnim.setValue(0);
      setActiveTab(null);
      // Reset zoom/pan to the default full-height framing (masked by the converge
      // animation) so re-opening the same track never starts mid-zoom.
      zoomScale.value = coverScaleSV.value;
      panX.value = 0; panY.value = 0;
      savedScale.value = coverScaleSV.value;
      savedPanX.value = 0; savedPanY.value = 0;
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
  // Animated values + zoom shared values are stable refs; convergeY only matters
  // at the open/close edge, which is keyed by isFullScreenOpen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreenOpen, posYAnim, scaleAnim, opacityAnim, panelAnim]);

  // ── No ownership / handler registration ───────────────────────────────────
  // The old two-engine model registered PlayerHandlers here and "took ownership"
  // of a video so FS could keep its audio alive when minimized. That whole dance
  // is gone: GlobalAudioPlayer is the single engine and registers the handlers
  // for every post (audio AND video). FS just shows muted frames that chase the
  // engine's position — nothing to own, pause, or hand back. When the frame
  // unmounts (minimize / background / track→audio) the engine never even
  // notices, so audio is gap-free by construction.

  // ── Audio↔video buffer gate ────────────────────────────────────────────────
  // The muted frame and GlobalAudioPlayer decode the SAME file (a video post has
  // no separate audio-only rendition), so they compete for bandwidth and the
  // heavy video stream loses: it stalls while the lighter audio plays on, and the
  // drift-seek chase then thrashes the picture — the spinner-flicker / frozen-
  // video bug. Fix: while the frame is mounted, gate the audio on the frame's
  // readiness. Raise it on mount / each new video (audio waits for the first
  // frames); onBuffer / onReadyForDisplay below lower and re-raise it on stalls.
  // When the frame is NOT mounted (audio post, minimized, backgrounded, jam) the
  // gate is released so audio plays freely — GAP owns background audio alone.
  const frameMounted =
    nowPlaying?.mediaKind === 'video' &&
    !!nowPlaying?.videoUrl &&
    isFullScreenOpen &&
    appForeground &&
    !engineDriving;
  useEffect(() => {
    if (frameMounted) {
      setFsBuffering(true);
      setVideoFrameBuffering(true);
      videoGateRef.current = true;
    } else {
      setVideoFrameBuffering(false);
      videoGateRef.current = false;
    }
  }, [frameMounted, nowPlaying?.postId, setVideoFrameBuffering]);

  // Safety watchdog — the gate is only raised at track start (to sync the first
  // frame); if that first frame doesn't arrive within a few seconds (slow decode
  // / poor connection) release it so the audio starts rather than waiting on a
  // picture that may never come. Short cap because the gate no longer re-raises
  // mid-song, so this only ever governs the opening moment.
  useEffect(() => {
    if (!fsBuffering || !frameMounted) { return; }
    const id = setTimeout(() => {
      if (!videoGateRef.current) { return; }
      console.log('[LIVIL][FS] buffer-gate watchdog → releasing audio (first frame slow)');
      setVideoFrameBuffering(false);
      videoGateRef.current = false;
    }, 6000);
    return () => clearTimeout(id);
  }, [fsBuffering, frameMounted, setVideoFrameBuffering]);

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
    // Covers the Lyrics/Queue/Info row AND the credit line under the title,
    // which routes through here to open Info. `select` because the panel is a
    // view change, not a committed action.
    haptics.select();
    if (activeTab === tab) { closePanel(); } else { openTab(tab); }
  }, [activeTab, openTab, closePanel]);

  // ── Android back ──────────────────────────────────────────────────────────
  // This player is an OVERLAY, not a navigation screen — nothing in the stack
  // represents it, so an unhandled back went straight to the navigator, found it
  // already at the root, and dropped the user out of the app. Back must peel one
  // layer at a time instead: innermost sheet → content panel → the player.
  //
  // Only registered while open, so a closed player never eats a back press. The
  // sheet/modal cases are belt-and-braces: RN's <Modal> owns a Dialog that
  // normally consumes the key event before it reaches any BackHandler — but if
  // one ever renders inline instead, back would otherwise close the whole player
  // out from under it.
  useEffect(() => {
    if (!isFullScreenOpen) { return; }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPlaylistModal) { setShowPlaylistModal(false); return true; }
      if (likersPostId !== null) { setLikersPostId(null); return true; }
      if (commentsOpen) { setCommentsOpen(false); return true; }
      if (activeTab !== null) { closePanel(); return true; }
      closeFullScreenPlayer();
      return true;
    });
    return () => sub.remove();
  }, [
    isFullScreenOpen, showPlaylistModal, likersPostId, commentsOpen,
    activeTab, closePanel, closeFullScreenPlayer,
  ]);

  // ── Media-background gesture tree (built ONCE — stable identity) ───────────
  // Race( tap , Simultaneous(pinch, pan) ):
  //  • tap  — toggles clean view (video only, no panel open). A WORKLET (never
  //           runOnJS) so it doesn't poison the worklet pinch/pan in the same
  //           composition; hops to JS via runOnJS only in the callback.
  //  • pinch— zoom ∈ [1 (full width), coverScale (full height)] (clean view only).
  //  • pan  — ONE Pan does double duty, branching on immersiveSV: in clean view it
  //           pans the zoomed picture (clamped to the cropped bounds); otherwise it
  //           is the legacy swipe-down-to-close (disabled while a panel is open).
  // Gating is read from shared values INSIDE the worklets so toggling clean view
  // never rebuilds the tree (a rebuild mid-pinch would cancel the active gesture).
  const mediaGesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd(() => {
        'worklet';
        if (isVideoSV.value && !panelOpenSV.value) {
          runOnJS(toggleImmersive)();
        }
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        'worklet';
        if (!immersiveSV.value) { return; }
        savedScale.value = zoomScale.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (!immersiveSV.value) { return; }
        let s = savedScale.value * e.scale;
        if (s < 1) { s = 1; }
        if (s > coverScaleSV.value) { s = coverScaleSV.value; }
        zoomScale.value = s;
        // Pull pan back inside the bounds for the new (possibly smaller) scale.
        const maxX = Math.max(0, (dispWSV.value * s - SCREEN_W) / 2);
        const maxY = Math.max(0, (dispHSV.value * s - SCREEN_H) / 2);
        if (panX.value >  maxX) { panX.value =  maxX; }
        if (panX.value < -maxX) { panX.value = -maxX; }
        if (panY.value >  maxY) { panY.value =  maxY; }
        if (panY.value < -maxY) { panY.value = -maxY; }
      })
      .onEnd(() => {
        'worklet';
        if (!immersiveSV.value) { return; }
        savedScale.value = zoomScale.value;
        savedPanX.value = panX.value;
        savedPanY.value = panY.value;
      });

    const pan = Gesture.Pan()
      .minDistance(10)
      .onStart(() => {
        'worklet';
        savedPanX.value = panX.value;
        savedPanY.value = panY.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (!immersiveSV.value) { return; } // non-clean: close is decided onEnd
        const s = zoomScale.value;
        const maxX = Math.max(0, (dispWSV.value * s - SCREEN_W) / 2);
        const maxY = Math.max(0, (dispHSV.value * s - SCREEN_H) / 2);
        let nx = savedPanX.value + e.translationX;
        let ny = savedPanY.value + e.translationY;
        if (nx >  maxX) { nx =  maxX; }
        if (nx < -maxX) { nx = -maxX; }
        if (ny >  maxY) { ny =  maxY; }
        if (ny < -maxY) { ny = -maxY; }
        panX.value = nx;
        panY.value = ny;
      })
      .onEnd((e) => {
        'worklet';
        if (immersiveSV.value) {
          savedPanX.value = panX.value;
          savedPanY.value = panY.value;
        } else if (!panelOpenSV.value && (e.translationY > 120 || e.velocityY > 500)) {
          // Legacy swipe-down-to-close (only when no panel is open).
          runOnJS(closeFullScreenPlayer)();
        }
      });

    return Gesture.Race(tap, Gesture.Simultaneous(pinch, pan));
  // Shared values + these callbacks are all stable, so the tree is built once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleImmersive, closeFullScreenPlayer]);

  // ── Swipe-down the panel handle to dismiss the panel ─────────────────────
  const panelDismissGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 60 || e.velocityY > 400) { closePanel(); }
    });

  // ── Muted-frame sync callbacks ────────────────────────────────────────────
  // The frame is a SLAVE to GlobalAudioPlayer. It never drives positionRef,
  // duration, the play tracker, the queue, or clip-end — GAP owns all of that.
  // It only seeks ITSELF to match the engine's position so the picture lines up.

  // On load, jump the frame to wherever the engine currently is. STAYS a JS
  // callback (videoRef.seek is JS-thread only); shared-value writes from JS are
  // legal and used here to drive the zoom transform.
  const handleFrameLoad = useCallback((data: OnLoadData) => {
    const pos = positionRef.current;
    console.log(`[LIVIL][FS] frame onLoad → seek to engine pos ${pos.toFixed(1)}s`);
    if (pos > 0) { videoRef.current?.seek(pos); }

    // Derive the cover-equivalent scale + contain-fitted size from the video's
    // natural (already display-oriented on both platforms — DO NOT swap by
    // orientation) dimensions. Until this runs, resizeMode stays "cover".
    const nw = data.naturalSize?.width ?? 0;
    const nh = data.naturalSize?.height ?? 0;
    if (nw > 0 && nh > 0) {
      const vAR = nw / nh;
      const screenAR = SCREEN_W / SCREEN_H;
      // contain-fitted dimensions within the screen @ scale 1
      const dispW = vAR > screenAR ? SCREEN_W : SCREEN_H * vAR;
      const dispH = vAR > screenAR ? SCREEN_W / vAR : SCREEN_H;
      // scale that takes the contain fit up to a full cover (clamped for safety)
      const cover = Math.min(Math.max(vAR > screenAR ? vAR / screenAR : screenAR / vAR, 1), 4);
      dispWSV.value = dispW;
      dispHSV.value = dispH;
      coverScaleSV.value = cover;
      // Default look = full height (cover-equivalent). Setting this the same tick
      // we flip aspectKnown→contain keeps the switch pixel-identical to cover.
      zoomScale.value = cover;
      savedScale.value = cover;
      panX.value = 0; panY.value = 0;
      savedPanX.value = 0; savedPanY.value = 0;
      setAspectKnown(true);
      console.log(`[LIVIL][FS] aspect ${nw}x${nh} vAR=${vAR.toFixed(3)} coverScale=${cover.toFixed(3)} disp=${dispW.toFixed(0)}x${dispH.toFixed(0)}`);
    }
  }, [positionRef, dispWSV, dispHSV, coverScaleSV, zoomScale, savedScale, panX, panY, savedPanX, savedPanY]);

  // On each frame tick, correct drift against the engine's position. We do NOT
  // call updatePosition — GAP's hidden <Video> is the source of truth; this just
  // nudges the silent picture back into alignment when it slips (e.g. after a
  // clip loop, a lock-screen seek, or a 2x burst that the frame plays at 1x).
  const handleFrameProgress = useCallback(
    (data: OnProgressData) => {
      const t = data.currentTime ?? 0;
      const target = positionRef.current;
      // Eager clip-end snap. GAP loops/advances at clipEnd by resetting
      // positionRef to clipStart; the free-running frame would otherwise keep
      // showing frames PAST clipEnd until the drift threshold + 600ms cooldown
      // let it resync. Snap immediately the moment the picture crosses clipEnd so
      // the visible frame doesn't overrun the clip window on every loop.
      const cw = clipWindowRef.current;
      if (cw && t >= cw.end) {
        frameSeekCooldownRef.current = Date.now() + 600;
        videoRef.current?.seek(target);
        return;
      }
      const drift = Math.abs(t - target);
      if (drift > 0.4) {
        // While gated, the audio clock (target) is frozen and the frame is busy
        // buffering — chasing the frozen target would only seek the picture back
        // into an unbuffered region and re-trigger the stall. Let the frame play
        // through; normal drift correction resumes the moment the gate lifts.
        if (videoGateRef.current) { return; }
        const now = Date.now();
        if (now >= frameSeekCooldownRef.current) {
          frameSeekCooldownRef.current = now + 600;
          console.log(`[LIVIL][FS] frame drift ${drift.toFixed(2)}s → resync to ${target.toFixed(1)}s`);
          videoRef.current?.seek(target);
        }
      }
    },
    [positionRef, clipWindowRef],
  );

  // When the engine is seeked, markSeekTarget bumps seekNonce — eagerly move the
  // muted frame to the new position. Critical while PAUSED: the frame's
  // onProgress (and thus drift correction) doesn't fire when paused, so without
  // this a scrub on a paused video wouldn't move the picture until playback
  // resumed. videoRef is null unless the frame is mounted, so this no-ops then.
  useEffect(() => {
    if (nowPlaying?.mediaKind === 'video') {
      videoRef.current?.seek(positionRef.current);
      // Hold off drift correction for a beat. After this eager seek the frame is
      // already at the target, but the native player keeps emitting onProgress
      // samples at the PRE-seek position for a few hundred ms — those would make
      // handleFrameProgress fire a SECOND, redundant resync seek, and the extra
      // seek shows up as a second spinner flash (the spinner→video→spinner→video
      // blink right after a scrub). One seek, one settle.
      frameSeekCooldownRef.current = Date.now() + 900;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce]);

  // ── Layout ────────────────────────────────────────────────────────────────
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  const HEADER_H = 52;
  const panelTop = safeTop + HEADER_H;
  const panelHeight = SCREEN_H - panelTop;
  const panelScrollPad = playerBottom + FLOAT_D + 24 + 44 + safeBottom + 16;
  const actionRowBottom = safeBottom + 44;
  const seekRowBottom = playerBottom + FLOAT_D + 24;
  // ── Audio cover-art card ──────────────────────────────────────────────────
  // Audio has no picture to fill the screen with, so a full-bleed crop just
  // hides the edges of the artwork. Instead the card takes the ARTWORK'S OWN
  // proportions and is scaled up until it hits the band between the header and
  // the title block, or the side padding — whichever it reaches first. Video is
  // untouched: it keeps the full-bleed frame and its pinch/pan clean view.
  const artTop = safeTop + HEADER_H + ART_GAP_TOP;
  const artBottomEdge = seekRowBottom + 56 + bottomInfoH + ART_GAP_BOTTOM;
  const artBandH = Math.max(160, SCREEN_H - artTop - artBottomEdge);
  const artMaxW = SCREEN_W - ART_SIDE_PAD * 2;
  // The min() picks whichever limit binds: a wide image runs out of width first,
  // a tall one runs out of band height. Whole dp so the rounded corners and the
  // 1px rim land on pixel boundaries.
  const artW = Math.floor(Math.min(artMaxW, artBandH * (artAR ?? 1)));
  const artH = Math.floor(artW / (artAR ?? 1));
  // The no-artwork placeholder has no intrinsic shape of its own — square it.
  const artSide = Math.min(artMaxW, artBandH);
  // Clean-view control hide: top group (header/credits) slides fully above the
  // status bar, bottom group (info/seek/actions) slides down off-screen; both
  // fade via controlsAnim (opacity). pointerEvents is flipped to 'none' on each
  // group while immersive so a hidden control can never be tapped.
  const controlsTopHide = controlsAnim.interpolate({
    inputRange: [0, 1], outputRange: [-(safeTop + HEADER_H + 48), 0],
  });
  const controlsBottomHide = controlsAnim.interpolate({
    inputRange: [0, 1], outputRange: [seekRowBottom + 160, 0],
  });
  // Memoize the interpolation node + style array. Without this, every render
  // (e.g. when activeTab changes from null → 'lyrics') creates a fresh
  // interpolation and a new style array; React Native re-binds the
  // Animated.Value to the native view, and during the re-bind the panel
  // briefly snaps to its non-animated rest position for one frame — that's
  // the flicker the user sees when opening Lyrics / Queue / Info.
  const panelTranslateY = useMemo(
    () => panelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [panelHeight, 0],
      extrapolate: 'clamp',
    }),
    [panelAnim, panelHeight],
  );
  const panelStyle = useMemo(
    () => [
      styles.contentPanel,
      { top: panelTop, transform: [{ translateY: panelTranslateY }] },
    ],
    [panelTop, panelTranslateY],
  );

  if (!nowPlaying) { return null; }

  // Video buffering is local (onBuffer/onReadyForDisplay); audio buffering comes
  // from GlobalAudioPlayer via the shared isBuffering flag.
  const showSpinner = nowPlaying.mediaKind === 'video' ? fsBuffering : isBuffering;

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
      {/* ── Full-bleed media (clips the over-scaled zoomed video to the screen) ── */}
      <View style={[StyleSheet.absoluteFill, styles.mediaClip]}>
        {nowPlaying.mediaKind === 'video' &&
        nowPlaying.videoUrl &&
        isFullScreenOpen &&
        appForeground &&
        !engineDriving ? (
          // MUTED, foreground-only video frame. This is NOT the audio engine and
          // NOT the MediaSession owner — GlobalAudioPlayer is. It plays the same
          // video silently and seeks itself to chase GAP's position so the user
          // sees the picture in sync with the audio they hear. It mounts only
          // while FS is open AND the app is foregrounded (minimize / lock / a
          // switch to an audio track all unmount it → cover art), so a second
          // background decoder never exists.
          //
          // Wrapped in a Reanimated view that applies the clean-view zoom/pan
          // (pan + scale, UI-thread). The wrapper owns ITS transform; the outer
          // container owns its open/close burst transform — different nodes, no
          // conflict. resizeMode is "cover" until the aspect ratio is known, then
          // "contain" (+ scale=coverScale, pixel-identical to cover → no flash).
          <Reanimated.View style={[StyleSheet.absoluteFill, videoZoomStyle]}>
          <Video
            ref={videoRef}
            // No `metadata` — GAP owns the lock-screen now-playing info. A second
            // source.metadata here could try to claim the MediaSession.
            source={{ uri: nowPlaying.videoUrl }}
            // Poster covers the brief gap between source mount and first decoded
            // frame so the user sees the thumbnail instead of a black flash.
            poster={
              nowPlaying.thumbnailUrl
                ? { source: { uri: nowPlaying.thumbnailUrl }, resizeMode: 'cover' }
                : undefined
            }
            style={styles.video}
            resizeMode={aspectKnown ? 'contain' : 'cover'}
            // Follow the engine's play/pause: activePostId is the post GAP is
            // actively playing (null when paused). No local fsPaused state.
            paused={activePostId !== nowPlaying.postId}
            onLoad={handleFrameLoad}
            onProgress={handleFrameProgress}
            onBuffer={({ isBuffering: buf }) => {
              setFsBuffering(buf);
              // Only ever RELEASE the audio gate here — never re-raise it on a
              // mid-song re-buffer. Re-gating would hold the audio hostage every
              // time the picture stalls (e.g. after a seek the decoder can't
              // satisfy quickly → dead air until the watchdog). The gate is
              // raised ONCE at track start (the frameMounted effect); after the
              // first frame shows, audio is king and the picture follows via
              // drift correction.
              if (!buf) {
                setVideoFrameBuffering(false);
                videoGateRef.current = false;
              }
            }}
            onReadyForDisplay={() => {
              // DO NOT seek() here. On Android a seek renders a fresh first
              // frame, which makes ExoPlayer fire onReadyForDisplay AGAIN →
              // seek → ready → seek … a ~40 Hz loop that pegs JS and leaves the
              // picture stuck re-seeking forever (the black-screen / frozen-video
              // / endless-spinner bug). Initial alignment is already handled by
              // handleFrameLoad (onLoad) and ongoing alignment by the drift
              // correction + seekNonce effect. Here we only drop the spinner and
              // release the audio gate.
              console.log('[LIVIL][FS] frame ready → release audio');
              setFsBuffering(false);
              setVideoFrameBuffering(false);
              videoGateRef.current = false;
            }}
            onError={(e) => {
              // The frame failed to decode, but GAP is still playing the audio
              // fine on its own surface — so DON'T advance the queue here (that
              // would skip a perfectly audible track). Just drop the spinner and
              // let the cover art / poster stand in for the missing picture.
              console.warn('[LIVIL][FS] frame onError (audio unaffected)', e?.error ?? e);
              setFsBuffering(false);
              // Release the audio gate — the picture is gone, but the audio plays
              // fine on GAP's own surface, so it must not stay held.
              setVideoFrameBuffering(false);
              videoGateRef.current = false;
            }}
            progressUpdateInterval={250}
            // Silent slave surface: muted + volume 0 + disableFocus, and never
            // plays in background. Because it is muted it contributes nothing to
            // the audio-session category, so GAP stays the sole session driver.
            // IMPORTANT (iOS): do NOT set disableAudioSessionManagement here —
            // RNV's AudioSessionManager is a process-wide singleton and that flag
            // on ANY mounted <Video> globally disables management, which would
            // stop GAP from forcing the .playback category (audio would then be
            // silenced by the ring switch and lose background/lock-screen audio).
            muted
            volume={0}
            disableFocus
            playInBackground={false}
            playWhenInactive={false}
            {...(Platform.OS === 'ios'
              ? { preferredForwardBufferDuration: 20 }
              : {
                  bufferConfig: {
                    minBufferMs: 15_000,
                    maxBufferMs: 50_000,
                    bufferForPlaybackMs: 2_500,
                    bufferForPlaybackAfterRebufferMs: 5_000,
                    backBufferDurationMs: 10_000,
                    cacheSizeMB: 200,
                  },
                })}
          />
          </Reanimated.View>
        ) : (nowPlaying.coverArtUrl ?? nowPlaying.thumbnailUrl) ? (
          // Cover-art mode: audio posts use coverArtUrl; a video that has demoted
          // to cover (FS minimized / backgrounded) falls back to its thumbnail so
          // the picture-to-cover transition matches the floating player instead of
          // flashing the gradient placeholder.
          //
          // AUDIO shows the whole artwork on a card cut to its own proportions,
          // centered between the header and the title block, lit by a purple halo
          // and its cast shadow, drifting while the song plays. A demoted VIDEO
          // keeps the full-bleed crop — its thumbnail is a frame of the picture,
          // and shrinking it would make minimize/background visibly jump.
          nowPlaying.mediaKind === 'video' ? (
            <Image
              source={{ uri: (nowPlaying.coverArtUrl ?? nowPlaying.thumbnailUrl)! }}
              style={styles.albumArt}
              resizeMode="cover"
            />
          ) : artAR === null ? (
            // Intrinsic size not resolved yet — draw nothing rather than a
            // guessed rectangle that would visibly snap to the real shape.
            null
          ) : (
            <>
              <ArtGlow centerY={artTop + artBandH / 2} width={artW} height={artH} />
              <View
                style={[styles.artBox, { top: artTop, height: artBandH }]}
                pointerEvents="none"
              >
                <Reanimated.View
                  style={[styles.artCard, { width: artW, height: artH }, artFloatStyle]}
                >
                  <View style={styles.artClip}>
                    <Image
                      source={{ uri: (nowPlaying.coverArtUrl ?? nowPlaying.thumbnailUrl)! }}
                      style={styles.artCentered}
                      // The frame already matches the artwork's ratio, so this
                      // crops nothing — it just guarantees the picture reaches
                      // the rounded edge even if the dp rounding is off by one.
                      resizeMode="cover"
                    />
                  </View>
                </Reanimated.View>
              </View>
            </>
          )
        ) : nowPlaying.mediaKind === 'video' ? (
          <View style={styles.albumArtFallback}>
            <View style={styles.fallbackBlobA} />
            <View style={styles.fallbackBlobB} />
          </View>
        ) : (
          // No artwork on an audio post — the gradient placeholder becomes the
          // "artwork", drawn in the same centered box (halo included) so the
          // layout doesn't change shape between a post that has cover art and
          // one that doesn't.
          <>
            <ArtGlow centerY={artTop + artBandH / 2} width={artSide} height={artSide} />
            <View style={[styles.artBox, { top: artTop, height: artBandH }]} pointerEvents="none">
              <Reanimated.View
                style={[styles.artCard, { width: artSide, height: artSide }, artFloatStyle]}
              >
                <View style={styles.artClip}>
                  <View style={styles.fallbackBlobA} />
                  <View style={styles.fallbackBlobB} />
                </View>
              </Reanimated.View>
            </View>
          </>
        )}
      </View>

      {/* "Tap and pinch" — flashes at the centre on every full-screen VIDEO
          open. pointerEvents none so it never eats the very tap it asks for. */}
      {zoomHintOn ? (
        <Animated.View
          style={[styles.zoomHintWrap, { opacity: zoomHintAnim }]}
          pointerEvents="none"
        >
          {/* Icons sit as siblings in the row, never nested in the <Text> —
              they are SVGs, not inline glyphs (CLAUDE.md). The inward arrows
              after the label say which way the pinch goes. */}
          <View style={styles.zoomHintPill}>
            <Icon name="handTap" size={16} color={COLORS.purpleLight} />
            <Text style={styles.zoomHintText}>Tap and pinch</Text>
            <Icon name="zoomOut" size={16} color={COLORS.purpleLight} />
          </View>
        </Animated.View>
      ) : null}

      {/* Buffering spinner — shown while the active media loads / rebuffers. */}
      {showSpinner ? (
        <View style={styles.bufferOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.purpleLight} />
        </View>
      ) : null}

      {/* Scrims removed — no background overlay on video */}

      {/* ── Swipe-to-close gesture — background hit zone only, no children ── */}
      {/* Interactive elements (header, credits, stats) are siblings rendered AFTER
          this so they sit on top and receive taps before the gesture view does.
          box-only ensures the gesture fires on empty areas but never blocks buttons. */}
      <GestureDetector gesture={mediaGesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only" />
      </GestureDetector>

      {/* ── Header (outside GestureDetector — reliable taps on all Android devices) ── */}
      <Animated.View
        style={[styles.header, { top: safeTop, height: HEADER_H, opacity: controlsAnim, transform: [{ translateY: controlsTopHide }] }]}
        pointerEvents={isImmersive ? 'none' : 'box-none'}
      >
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={closeFullScreenPlayer}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="collapse" size={28} color={COLORS.white} />
        </TouchableOpacity>
        {/* No title here — it already reads large in the bottom info block, and
            repeating it over the artwork was the only thing in the way. The
            spacer keeps Repost/Add pinned right. */}
        <View style={styles.headerSpacer} />
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
          <Icon name="repost" size={12} color={COLORS.purpleLight} />
          <Text style={styles.repostBtnLabel}>Repost</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowPlaylistModal(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="add" size={28} color={COLORS.white} />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Track title + credit line + engagement stats ── */}
      <Animated.View
        style={[styles.bottomInfo, { bottom: seekRowBottom + 56, opacity: controlsAnim, transform: [{ translateY: controlsBottomHide }] }]}
        pointerEvents={isImmersive ? 'none' : 'box-none'}
        // Feeds the audio cover-art box its bottom boundary. Guarded so a
        // sub-pixel re-measure of the same layout can't loop re-renders.
        onLayout={e => {
          const h = Math.round(e.nativeEvent.layout.height);
          setBottomInfoH(prev => (Math.abs(prev - h) > 1 ? h : prev));
        }}
      >
        <Text style={styles.trackTitle} numberOfLines={2}>{nowPlaying.title}</Text>
        <CreditLine nowPlaying={nowPlaying} onPress={() => handleTabPress('info')} />
        <CompactStats
          nowPlaying={nowPlaying}
          onCommentsPress={() => setCommentsOpen(true)}
          onLikesPress={(postId) => setLikersPostId(postId)}
          trackPlaysTotal={trackPlaysTotal}
        />
      </Animated.View>

      {/* ── Seek bar + time labels ── */}
      <Animated.View
        style={[styles.seekRow, { bottom: seekRowBottom, opacity: controlsAnim, transform: [{ translateY: controlsBottomHide }] }]}
        pointerEvents={isImmersive ? 'none' : 'box-none'}
      >
        <FullScreenClipBar />
      </Animated.View>

      {/* Shuffle + Repeat live in the FloatingPlayer pill when fullscreen is open */}

      {/* ── Content panel ── */}
      <Animated.View
        style={panelStyle}
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
            <InfoContent
              nowPlaying={nowPlaying}
              onCommentsPress={() => setCommentsOpen(true)}
              onLikesPress={(postId) => setLikersPostId(postId)}
              trackPlaysTotal={trackPlaysTotal}
            />
          </View>
        )}
      </Animated.View>

      {/* ── Action buttons ── */}
      <Animated.View
        style={[styles.actionRow, { bottom: actionRowBottom, opacity: controlsAnim, transform: [{ translateY: controlsBottomHide }] }]}
        pointerEvents={isImmersive ? 'none' : 'box-none'}
      >
        {(['lyrics', 'queue', 'info'] as TabId[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.actionBtn, activeTab === tab && styles.actionBtnActive]}
            onPress={() => handleTabPress(tab)}
            activeOpacity={0.75}
          >
            {activeTab === tab ? <GradientBorder borderRadius={18} /> : null}
            <Text style={[styles.actionBtnText, activeTab === tab && styles.actionBtnTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>

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

      <CommentsSheet
        visible={commentsOpen}
        postId={getEffectivePost(nowPlaying).postId}
        onClose={() => setCommentsOpen(false)}
        onCommentsCountChange={delta => {
          bumpCommentsCount(delta, getEffectivePost(nowPlaying).isOriginal);
        }}
      />

      <PostLikersSheet
        visible={likersPostId !== null}
        postId={likersPostId}
        onClose={() => setLikersPostId(null)}
      />
    </Animated.View>
  );
}

// ─── Compact stats strip (separate component to keep re-renders isolated) ────

function CompactStats({
  nowPlaying,
  onCommentsPress,
  onLikesPress,
  trackPlaysTotal,
}: {
  nowPlaying: NowPlayingInfo;
  onCommentsPress: () => void;
  onLikesPress: (postId: string) => void;
  trackPlaysTotal: number;
}) {
  const { setNowPlaying } = usePlayback();
  const effective = getEffectivePost(nowPlaying);
  const [liked, setLiked] = useState(effective.viewerHasLiked);
  const [count, setCount] = useState(effective.likesCount);

  useEffect(() => {
    setLiked(effective.viewerHasLiked);
    setCount(effective.likesCount);
  }, [effective.postId, effective.viewerHasLiked, effective.likesCount]);

  const handleLike = useCallback(async () => {
    const prev = liked;
    const prevCount = count;
    const next = !prev;
    if (next) { haptics.toggleOn(); }
    setLiked(next);
    setCount(prevCount + (next ? 1 : -1));
    try {
      const serverLiked = await toggleLike(effective.postId);
      const finalCount = prevCount + (serverLiked ? 1 : 0);
      setLiked(serverLiked);
      setCount(finalCount);
      // Write back to PlaybackContext so the add-to-playlist modal reads the
      // correct liked state when it opens after a like/unlike here. For
      // reposts, we update both the original mirror (consumed by the player)
      // and the live like state on the underlying post.
      if (effective.isOriginal) {
        setNowPlaying({
          ...nowPlaying,
          originalViewerHasLiked: serverLiked,
          originalLikesCount: finalCount,
        });
      } else {
        setNowPlaying({ ...nowPlaying, viewerHasLiked: serverLiked, likesCount: finalCount });
      }
    } catch {
      setLiked(prev);
      setCount(prevCount);
    }
  }, [liked, count, nowPlaying, setNowPlaying, effective.postId, effective.isOriginal]);

  return (
    <View style={csSt.row}>
      {/* Interactive group (like + comments) — bare buttons so they read as
          actionable against the album art. */}
      <View style={csSt.activeGroup}>
        <View style={csSt.item}>
          <TouchableOpacity onPress={handleLike} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Icon name="heart" size={16} color={liked ? '#FF4D6D' : COLORS.white} weight={liked ? 'fill' : 'regular'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onLikesPress(effective.postId)}
            activeOpacity={0.7}
            disabled={count === 0}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={[csSt.val, liked && csSt.valLiked]}>{formatCount(count)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={csSt.item} onPress={onCommentsPress} activeOpacity={0.7}>
          <Icon name="comment" size={16} color={COLORS.white} />
          <Text style={csSt.val}>{formatCount(effective.commentsCount)}</Text>
        </TouchableOpacity>
      </View>
      {/* Passive pill — plays (cumulative across every post using this track)
          and reposts (always the original post's count). Read-only. */}
      <View style={csSt.pill}>
        <View style={csSt.pillItem}>
          <Icon name="play" size={12} color="rgba(255,255,255,0.85)" />
          <Text style={csSt.pillVal}>{formatCount(trackPlaysTotal)}</Text>
        </View>
        <View style={csSt.pillDivider} />
        <View style={csSt.pillItem}>
          {/* Matches the Repost button glyph in PostCard for consistency. */}
          <Icon name="repost" size={12} color="rgba(255,255,255,0.85)" />
          <Text style={csSt.pillVal}>{formatCount(effective.repostsCount)}</Text>
        </View>
      </View>
    </View>
  );
}

const csSt = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 10,
  },
  activeGroup: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  val: { color: COLORS.white, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  valLiked: { color: '#FF4D6D' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pillItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillDivider: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 8 },
  pillVal: { color: COLORS.white, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },

  // Full-bleed media fills entire container
  albumArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  albumArtFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.card, overflow: 'hidden' },

  // Audio artwork: the whole image, centered on the black container.
  artBox: {
    position: 'absolute', left: ART_SIDE_PAD, right: ART_SIDE_PAD,
    alignItems: 'center', justifyContent: 'center',
  },
  // The lifted card. Carries the shadow and the fill, and must NOT clip — iOS
  // clips a view's own shadow when overflow is hidden, so the rounding lives on
  // the inner surface instead.
  artCard: {
    borderRadius: ART_RADIUS,
    backgroundColor: COLORS.card,
    // iOS: a soft, slightly-offset cast shadow. Near-black on a near-black page
    // is subtle by nature — most of the lift comes from the halo pooling below.
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    // Android ignores shadowColor and draws its own. CLAUDE.md bans elevation on
    // BUTTONS, where the grey smudge lands on a visible surface — here the card
    // sits on pure #0A0A0F, so the shadow only darkens the halo directly beneath
    // it, which is exactly the seam that sells the lift. Drop this line if it
    // ever reads as a smudge; the rim + offset glow carry the effect alone.
    elevation: 12,
  },
  // Rounds the picture. Clipping on a parent (rather than borderRadius on the
  // Image) is the reliable path on Android, where a `contain` Image rounds its
  // view box inconsistently. The hairline rim catches the glow and keeps the
  // card's edge legible where artwork is dark.
  artClip: {
    flex: 1,
    borderRadius: ART_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  // The card is cut to the artwork's own ratio, so the picture fills it edge to
  // edge — no letterbox, and nothing of the image is cropped away.
  artCentered: { flex: 1 },
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
  // Clips the over-scaled (zoomed) video wrapper to the screen so it never bleeds.
  mediaClip: { overflow: 'hidden' },
  bufferOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },

  // Centred hint pill. Matches the action-row chrome (same translucent dark +
  // border) so it reads as part of the player, not a system toast.
  zoomHintWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  zoomHintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    backgroundColor: 'rgba(10,10,15,0.9)',
    borderWidth: 1, borderColor: COLORS.border,
  },
  zoomHintText: { color: COLORS.white, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },

  // Gradient scrims — dark top and bottom bands so text is readable over media

  // Header overlay — absolutely positioned at top
  header: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { flex: 1 },
  addBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  repostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purpleGlow,
  },
  repostBtnLabel: {
    color: COLORS.purpleLight,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Bottom overlay — track title + credit line + stats
  bottomInfo: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24 },
  trackTitle: {
    color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
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
  panelTabActive: { borderBottomColor: COLORS.purpleNeon },
  panelTabText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  panelTabTextActive: { color: COLORS.purpleNeon },
  panelScroll: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },

  placeholderText: { color: COLORS.textMuted, fontSize: 14, lineHeight: 22 },

  actionRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 10, paddingHorizontal: 24,
  },
  actionBtn: {
    flex: 1, height: 36, borderRadius: 18,
    // Translucent dark to match the floating pill / handle-bar background.
    backgroundColor: 'rgba(10,10,15,0.9)', borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  // Selected state comes from <GradientBorder>, so no purple fill and no
  // elevation (Android paints elevation as a grey smudge). The dark scrim from
  // actionBtn stays — these float over video and need it for contrast.
  actionBtnActive: {
    borderColor: 'transparent',
  },
  actionBtnText: { color: COLORS.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  actionBtnTextActive: { color: COLORS.purpleNeon },
});
