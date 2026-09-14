import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Platform,
} from 'react-native';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { usePlayback } from '../contexts/PlaybackContext';
import { useJam } from '../contexts/JamContext';
import { supabase } from '../../lib/supabase';
import { listPostsForUser, feedPostToNowPlaying } from '../services/posts';
import { useTrackWaveform } from '../hooks/useTrackWaveform';
import { COLORS } from '../theme/colors';
import { haptics } from '../utils/haptics';
import { FLOATING_PLAYER_HEIGHT } from '../constants/layout';
import { Icon } from './Icon';
import WaveVisualizer from './WaveVisualizer';
import CoverFallback from './CoverFallback';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ─── Dimensions ───────────────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const D    = FLOATING_PLAYER_HEIGHT;   // circle diameter
const R    = D / 2;
const B    = 4;    // arc ring width

// Bar / pill
const PILL_W   = SCREEN_W * 0.82;
const BAR_H    = 2;
const PILL_H   = 36;

// Vertical offsets so bar/pill stay centred in the D-tall container
const BAR_TOP_REST = (D - BAR_H)  / 2;   // 29
const BAR_TOP_PILL = (D - PILL_H) / 2;   // 12

// Gesture drag limits — keep same feel as the old 50%-wide container
const MAX_DRAG      = (SCREEN_W * 0.5) / 2 - R;
const MAX_DRAG_Y_UP   = 180;
const MAX_DRAG_Y_DOWN = 60;

// Gesture thresholds
const SNAP_VELOCITY = 400;
const OPEN_FS_DIST  = 80;
const OPEN_FS_VEL   = 500;
const CLOSE_FS_DIST = 40;
const CLOSE_FS_VEL  = 400;
// Delay (ms) before the pill morphs open, so the FS player opens first and the
// pill then pops up. Close stays instant (matches the FS collapse).
const OPEN_MORPH_DELAY = 220;

// ─── "It's draggable" wiggle (onboarding discovery) ─────────────────────────────
// A gentle shimmy of the floating circle that teaches the user the centre is
// movable. Shown a few times per app run, and it stops as soon as they drag.
// It's a pure visual transform — it dispatches NO gesture, so it can never
// trigger play/pause/seek/next.
/**
 * Set once the user drags the circle. Module scope, NOT persisted: the hint is
 * session-scoped, so it retires for this app run and returns on the next cold
 * start (the module is re-evaluated). At module scope rather than in a ref so a
 * component remount cannot re-arm it mid-session.
 */
let wiggleLearnedThisSession = false;
const WIGGLE_MAX_PER_SESS = 3;     // cap so it never nags
const WIGGLE_FIRST_MS     = 2600;  // after the player settles in
const WIGGLE_INTERVAL_MS  = 14000; // spacing between hints if still not dragged

// Avatar
const AV = 28;  // avatar diameter

// Re-exported so the 16 screens that already import it from here keep working.
// The definition lives in constants/layout so a screen can reserve space for
// the player without pulling this module's dependency graph into its tests.
export { FLOATING_PLAYER_HEIGHT };

// ─── Repeat icon glyphs ───────────────────────────────────────────────────────
function RepeatGlyph({ mode }: { mode: string }) {
  const active = mode !== 'off';
  const color  = COLORS.white;
  return (
    <View style={icon.wrap}>
      <Icon name="repeat" size={18} color={color} />
      {mode === 'one' && <Text style={icon.badge}>1</Text>}
      {active && <View style={[icon.dot, { backgroundColor: color }]} />}
    </View>
  );
}

// ─── Shuffle icon glyphs ──────────────────────────────────────────────────────
function ShuffleGlyph({ active }: { active: boolean }) {
  const color = COLORS.white;
  return (
    <View style={icon.wrap}>
      <Icon name="shuffle" size={18} color={color} />
      {active && <View style={[icon.dot, { backgroundColor: color }]} />}
    </View>
  );
}

const icon = StyleSheet.create({
  wrap:  { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 3, fontSize: 7, fontWeight: '700', color: COLORS.white },
  dot:   { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
});

// ─── Play / pause flash glyphs (translucent, View-based for reliable rendering) ─
function PlayGlyph() {
  return <View style={flash.playTri} />;
}
function PauseGlyph() {
  return (
    <View style={flash.pauseRow}>
      <View style={flash.pauseBar} />
      <View style={flash.pauseBar} />
    </View>
  );
}

const FLASH_COLOR = 'rgba(255,255,255,0.92)';
const flash = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playTri: {
    width: 0, height: 0,
    borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 15,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: FLASH_COLOR,
    marginLeft: 3, // optical centring of the triangle
  },
  pauseRow: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 5, height: 18, borderRadius: 1.5, backgroundColor: FLASH_COLOR },
});

// ─── Component ────────────────────────────────────────────────────────────────
export default function FloatingPlayer() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const tabBarH      = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const playerBottom = Math.max(SCREEN_H * 0.10, tabBarH + 56);

  const {
    nowPlaying, isStoryViewerOpen, isRepostOpen,
    activePostId, positionRef, durationRef, handlersRef,
    playNext, playPrev,
    openFullScreenPlayer, closeFullScreenPlayer, isFullScreenOpen,
    isImmersive,
    videoFrameBuffering,
    jamLocked,
    shuffleEnabled, toggleShuffle,
    repeatMode, cycleRepeatMode,
    setNowPlaying, requestPlay, resumePlay, setQueue,
    reportPaused, playSourceRef,
  } = usePlayback();

  const { activeJam } = useJam();

  // ─── Beat-synced visualizer envelope ───────────────────────────────────────────
  // Resolve the ACTIVE track's loudness envelope (cache → DB → analyze-on-device)
  // and hand it to WaveVisualizer. Fetched by trackId only (not threaded through
  // every NowPlayingInfo / feed query), since only the playing track needs it.
  //
  // The visualiser's envelope. The AUDIO-ONLY gate that keeps this off video — the one
  // that prevents an OOM kill — now lives in the hook, in one place.
  const waveform = useTrackWaveform(
    nowPlaying?.trackId, nowPlaying?.mediaKind, nowPlaying?.audioUrl,
  );

  // ─── Keyboard hide ────────────────────────────────────────────────────────────
  const keyboardAnim = useRef(new Animated.Value(0)).current;

  const animateKeyboardShow = useCallback(() => {
    Animated.timing(keyboardAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [keyboardAnim]);

  const animateKeyboardHide = useCallback(() => {
    Animated.timing(keyboardAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, [keyboardAnim]);

  useKeyboardHandler({
    onStart: (e) => {
      'worklet';
      if (e.height > 0) {
        runOnJS(animateKeyboardShow)();
      }
    },
    onEnd: (e) => {
      'worklet';
      if (e.height === 0) {
        runOnJS(animateKeyboardHide)();
      }
    },
  });

  // ─── Slide in / out ───────────────────────────────────────────────────────────
  const slideAnim  = useRef(new Animated.Value(0)).current;
  const wasVisible = useRef(false);
  // While a story/repost owns the screen the pill must be treated as HIDDEN — not
  // just `return null`ed below. During a story the single engine's nowPlaying IS
  // the story, so without this `shouldShow` stayed true, slideAnim sat at the
  // "shown" position, and on close (return-null lifts before nowPlaying settles)
  // the pill animated OUT visibly for ~200ms — a hacky flash. Gating shouldShow
  // keeps slideAnim parked at hidden throughout, so closing a story reveals the
  // pill only if the user's music is actually being restored.
  const shouldShow = (!!nowPlaying || !!activeJam) && !isStoryViewerOpen && !isRepostOpen;
  useEffect(() => {
    if (shouldShow && !wasVisible.current) {
      wasVisible.current = true;
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
    } else if (!shouldShow && wasVisible.current) {
      wasVisible.current = false;
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [shouldShow, slideAnim]);

  // ─── Immersive (clean-view) hide ──────────────────────────────────────────────
  // When FullScreenPlayer enters clean view, the floating pill must get out of the
  // way: it sits ON TOP of FS in the z-stack (RootNavigator) and its draggable
  // circle lives in the lower-centre — exactly where a pinch / pan-zoom drag lands.
  // We slide it fully off-screen + fade it out (native driver), and — critically —
  // flip pointerEvents to 'none' SYNCHRONOUSLY with isImmersive below (not gated on
  // this animation) so a touch can never be intercepted mid-transition.
  const immersiveAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(immersiveAnim, {
      toValue: isImmersive ? 1 : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [isImmersive, immersiveAnim]);

  // Combined vertical translate — native driver only.
  // NOTE: the FMP intentionally does NOT hide on feed scroll — it stays visible so
  // playback state + controls are always reachable. Only the bottom nav bar hides
  // on scroll (see AppNavigator).
  const translateY = Animated.add(
    Animated.add(
      slideAnim.interpolate({ inputRange: [0, 1], outputRange: [D + 24, 0] }),
      keyboardAnim.interpolate({ inputRange: [0, 1], outputRange: [0, D + 24] }),
    ),
    immersiveAnim.interpolate({ inputRange: [0, 1], outputRange: [0, D + playerBottom + 240] }),
  );
  const immersiveOpacity = immersiveAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  // ─── Progress arc ─────────────────────────────────────────────────────────────
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!nowPlaying) { return; }
    const id = setInterval(() => {
      const dur = durationRef.current;
      const pos = positionRef.current;
      progressAnim.setValue(dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [nowPlaying, positionRef, durationRef, progressAnim]);

  // ─── Play/pause indicator ─────────────────────────────────────────────────────
  // A translucent glyph PERSISTENTLY shown in the circle centre, reflecting the
  // GLOBAL play state (activePostId) — so it stays in sync no matter where
  // play/pause is triggered (home, playlist, lock screen, the circle tap). Button
  // convention — shows what a tap does: ❚❚ while playing, ▶ while paused. A small
  // pop animates it on each toggle.
  const isPlaying = activePostId !== null;
  const iconScale = useRef(new Animated.Value(1)).current;
  const prevPlayingRef = useRef(isPlaying);
  useEffect(() => {
    if (isPlaying === prevPlayingRef.current) { return; }
    prevPlayingRef.current = isPlaying;
    iconScale.stopAnimation();
    iconScale.setValue(0.7);
    Animated.spring(iconScale, { toValue: 1, useNativeDriver: true, bounciness: 12, speed: 18 }).start();
  }, [isPlaying, iconScale]);

  // ─── Circle anims ─────────────────────────────────────────────────────────────
  const circleX   = useRef(new Animated.Value(0)).current;
  const circleY   = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const springBack = () => Animated.parallel([
    Animated.spring(circleX, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
    Animated.spring(circleY, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
  ]).start();

  // ─── Bar / pill morph (non-native — animates layout props) ───────────────────
  const isExpanded = isFullScreenOpen || !!activeJam;  // wave-suppress + wiggle gate
  // Jam active but fullscreen NOT open → narrow pill (no shuffle/repeat)
  const isJamOnly  = !!activeJam && !isFullScreenOpen;
  const isVideo    = nowPlaying?.mediaKind === 'video';

  // For a VIDEO opening full-screen, keep the handle as a straight line until the
  // FS video frame is actually showing (mounted/ready), THEN expand the pill — so
  // it doesn't expand over a still-loading (cover-only) video. Audio and jam
  // expand right away. We only READ the FS frame's buffering flag; the engine is
  // untouched.
  const [videoFrameReady, setVideoFrameReady] = useState(false);
  const sawFrameBufferingRef = useRef(false);

  // Reset readiness whenever FS (re)opens for a video or the video track changes.
  useEffect(() => {
    if (isFullScreenOpen && isVideo) {
      setVideoFrameReady(false);
      sawFrameBufferingRef.current = false;
    }
  }, [isFullScreenOpen, isVideo, nowPlaying?.postId]);

  // The FS frame raises videoFrameBuffering on mount and clears it once the first
  // picture is decodable → "buffered then cleared" means ready/showing.
  useEffect(() => {
    if (!isFullScreenOpen || !isVideo) { return; }
    if (videoFrameBuffering) { sawFrameBufferingRef.current = true; }
    else if (sawFrameBufferingRef.current) { setVideoFrameReady(true); }
  }, [videoFrameBuffering, isFullScreenOpen, isVideo]);

  // Safety net: never leave the handle stuck as a line if the frame never reports
  // ready (instant cached load, a stall, or a decode error).
  useEffect(() => {
    if (!isFullScreenOpen || !isVideo || videoFrameReady) { return; }
    const id = setTimeout(() => setVideoFrameReady(true), 4000);
    return () => clearTimeout(id);
  }, [isFullScreenOpen, isVideo, videoFrameReady]);

  // Pill expands immediately for a jam or audio; for a video opening FS it waits
  // for the frame to be ready (until then it stays the straight line).
  const morphExpanded = !!activeJam || (isFullScreenOpen && (!isVideo || videoFrameReady));

  const morphAnim  = useRef(new Animated.Value(0)).current;
  const narrowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (morphExpanded) {
      // Springs up with a clear, graceful bounce. Audio FS-open keeps the fixed
      // pre-expand delay (feels right); video has already waited for its frame, so
      // it expands immediately on ready; jam too.
      Animated.spring(morphAnim, {
        toValue: 1,
        delay: (isFullScreenOpen && !isVideo) ? OPEN_MORPH_DELAY : 0,
        speed: 10,
        bounciness: 12,
        useNativeDriver: false,
      }).start();
    } else {
      // Close: quick, clean ease (no delay, no bounce) so it collapses with the FS.
      Animated.timing(morphAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [morphExpanded, isFullScreenOpen, isVideo, morphAnim]);

  // Belt-and-suspenders: while the player is hidden behind a covering screen
  // (Repost / Story viewer) it renders null, so an in-flight collapse animation
  // started right before it hid may not settle. Snap the morph straight to its
  // resting value so it reappears as the thin white line, not a stale expanded
  // pill. (Mirrors clearNowPlaying's isFullScreenOpen reset in PlaybackContext.)
  useEffect(() => {
    if ((isRepostOpen || isStoryViewerOpen) && !morphExpanded) {
      morphAnim.setValue(0);
    }
  }, [isRepostOpen, isStoryViewerOpen, morphExpanded, morphAnim]);

  useEffect(() => {
    Animated.spring(narrowAnim, {
      toValue: isJamOnly ? 1 : 0,
      useNativeDriver: false,
      bounciness: 8,
      speed: 14,
    }).start();
  }, [isJamOnly, narrowAnim]);

  // ─── "It's draggable" wiggle ──────────────────────────────────────────────────
  // SESSION-SCOPED: dragging stops the wiggle for the rest of this app run, and
  // the next cold start offers it again. It used to be persisted forever, which
  // meant a hint that could only ever teach once — after a reinstall-free year
  // the gesture was undiscoverable again for anyone who had merely brushed past
  // it. `learnedThisSession` lives at module scope so a component remount (Fast
  // Refresh, a nav swap) can't quietly re-arm it mid-session.
  const wiggleCountRef = useRef(0);      // per-session cap
  const wiggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wiggleEligible, setWiggleEligible] = useState(!wiggleLearnedThisSession);

  // Pure-visual shimmy: a quick damped horizontal sway + a tiny scale breath. It
  // animates the SAME values a drag uses (circleX / scaleAnim), so an incoming
  // touch (pan onStart stops circleX) cleanly interrupts it — and because it
  // dispatches NO gesture, it can never fire play/pause/seek/next.
  const doWiggle = useCallback(() => {
    circleX.stopAnimation();
    Animated.sequence([
      Animated.timing(circleX, { toValue: -7, duration: 110, easing: Easing.out(Easing.quad),   useNativeDriver: true }),
      Animated.timing(circleX, { toValue:  7, duration: 150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(circleX, { toValue: -4, duration: 130, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(circleX, { toValue:  0, duration: 120, easing: Easing.out(Easing.quad),   useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.1, duration: 150, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,   duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [circleX, scaleAnim]);

  // First real drag → discovered; stop wiggling for the rest of this session.
  const markDragLearned = useCallback(() => {
    if (wiggleLearnedThisSession) { return; }
    wiggleLearnedThisSession = true;
    setWiggleEligible(false);
    if (wiggleTimerRef.current) { clearTimeout(wiggleTimerRef.current); wiggleTimerRef.current = null; }
  }, []);

  // Schedule the hint only while the circle is the resting floating dot (not
  // expanded / jam), visible, unlocked, with a track loaded — for not-yet-learned
  // users, capped per session and spaced out so it never nags.
  useEffect(() => {
    const eligible =
      wiggleEligible && !wiggleLearnedThisSession &&
      shouldShow && !isExpanded && !jamLocked && !!nowPlaying;
    if (!eligible) { return; }
    let cancelled = false;
    const schedule = (ms: number) => {
      wiggleTimerRef.current = setTimeout(() => {
        if (cancelled || wiggleLearnedThisSession || wiggleCountRef.current >= WIGGLE_MAX_PER_SESS) { return; }
        doWiggle();
        wiggleCountRef.current += 1;
        if (wiggleCountRef.current < WIGGLE_MAX_PER_SESS) { schedule(WIGGLE_INTERVAL_MS); }
      }, ms);
    };
    schedule(wiggleCountRef.current === 0 ? WIGGLE_FIRST_MS : WIGGLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (wiggleTimerRef.current) { clearTimeout(wiggleTimerRef.current); wiggleTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiggleEligible, shouldShow, isExpanded, jamLocked, nowPlaying?.postId, doWiggle]);

  // Resting bar: narrow white line centred in the container
  const REST_BAR_W   = SCREEN_W * 0.30;
  const REST_MARGIN  = (PILL_W - REST_BAR_W) / 2;

  // Base margin: large when resting, 0 when pill is fully open
  const baseSideMargin = morphAnim.interpolate({ inputRange: [0, 1], outputRange: [REST_MARGIN, 0] });

  // Extra inset when jam-only (no shuffle/repeat → narrower pill)
  const JAM_ONLY_MARGIN = PILL_W * 0.14;
  const jamSideMargin   = narrowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, JAM_ONLY_MARGIN] });

  // Combined: resting inset + jam-only inset
  const barSideMargin = Animated.add(baseSideMargin, jamSideMargin);

  const barHeight  = morphAnim.interpolate({ inputRange: [0, 1], outputRange: [BAR_H,       PILL_H] });
  const barTop     = morphAnim.interpolate({ inputRange: [0, 1], outputRange: [BAR_TOP_REST, BAR_TOP_PILL] });
  const barRadius  = morphAnim.interpolate({ inputRange: [0, 1], outputRange: [1, PILL_H / 2] });
  // Rest color is TRANSPARENT (not white): the resting "line" is drawn by the
  // WaveVisualizer instead, so it looks like the white line itself is waving
  // (and flattens to that same line when paused). The bar still fades into the
  // dark pill as it morphs open.
  const barBg      = morphAnim.interpolate({ inputRange: [0, 1], outputRange: ['rgba(10,10,15,0)', 'rgba(10,10,15,0.9)'] });
  const barBorderC = morphAnim.interpolate({ inputRange: [0, 1], outputRange: ['rgba(139, 61, 255,0)', 'rgba(139, 61, 255,0.50)'] });
  // Content fades in only after pill is mostly open, and out before it collapses
  const contentOpacity = morphAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  // Spike visualizer lives ONLY on the resting white line — fade it out as soon
  // as the bar starts morphing into the pill (inverse of morphAnim).
  const visualizerOpacity = morphAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' });

  // Pulsing live dot
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeJam) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.2, duration: 650, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [activeJam, pulseAnim]);

  // ─── Gestures ────────────────────────────────────────────────────────────────
  const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true)
    .onEnd((_e, ok) => { if (ok && !jamLocked) { openFullScreenPlayer(); } });

  // Auto-play: fetch user's own posts and start playing
  const autoPlayingRef = useRef(false);
  const autoPlayMyPosts = useCallback(async () => {
    if (autoPlayingRef.current) { return; }
    autoPlayingRef.current = true;
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) { return; }
      const posts = await listPostsForUser(uid, { limit: 20 });
      console.log(`[LIVIL][FP] autoPlay: fetched ${posts.length} posts`);
      posts.forEach((p, i) => {
        console.log(`[LIVIL][FP]   post[${i}] id=${p.id} kind=${p.kind} trackId=${p.track.id} audio=${!!p.track.audioUrl} video=${!!p.track.videoUrl} title="${p.track.title}"`);
      });
      // Filter to posts that have a playable URL
      const playable = posts.filter(p => p.track.audioUrl || p.track.videoUrl);
      console.log(`[LIVIL][FP] autoPlay: ${playable.length} playable out of ${posts.length}`);
      if (playable.length === 0) { return; }
      const queue = playable.map(feedPostToNowPlaying);
      console.log(`[LIVIL][FP] autoPlay: setting queue with ${queue.length} items, starting at 0`);
      setQueue(queue, 0, 'autoplay');
      setNowPlaying(queue[0]);
      // Mark source as 'queue' so HomeScreen/ProfileScreen don't overwrite
      // our queue (they only fire when playSourceRef === 'user').
      playSourceRef.current = 'queue';
      resumePlay(queue[0].postId);
    } catch (err) {
      console.log('[LIVIL][FP] autoPlayMyPosts error:', (err as Error)?.message);
    } finally {
      autoPlayingRef.current = false;
    }
    // `playSourceRef` is a ref — its identity never changes, so listing it would be
    // noise. `resumePlay` is intentionally omitted: including it would rebuild this
    // callback mid-playback, and its behaviour here is unverified without tests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setQueue, setNowPlaying, requestPlay]);

  const singleTap = Gesture.Tap().numberOfTaps(1).runOnJS(true)
    .onEnd((_e, ok) => {
      if (!ok || jamLocked) { return; }
      const hasHandlers = !!handlersRef.current;
      // Acknowledge the tap here, not at the top of the handler: a tap while
      // jam-locked or mid-recognition does nothing, and buzzing for it would
      // promise an action that never happens.
      haptics.tap();
      console.log(`[LIVIL][FP] tap: activePostId=${activePostId} hasHandlers=${hasHandlers} nowPlaying=${!!nowPlaying}`);
      if (!nowPlaying) {
        // No track loaded — auto-play user's posts
        console.log('[LIVIL][FP] no track loaded — auto-playing my posts');
        void autoPlayMyPosts();
        return;
      }
      if (activePostId) {
        console.log('[LIVIL][FP] calling pause()');
        handlersRef.current?.pause();
        reportPaused(activePostId);
      } else {
        console.log('[LIVIL][FP] calling play() + resumePlay');
        handlersRef.current?.play();
        resumePlay(nowPlaying.postId);
      }
    });

  const tapGesture = Gesture.Exclusive(doubleTap, singleTap);

  const panGesture = Gesture.Pan().runOnJS(true)
    // Inert in clean view (the container pointerEvents flip is the authoritative
    // block; this makes even a stray hit on the circle do nothing).
    .enabled(!isImmersive)
    // Require ≥10dp of movement before pan recognizes. Without this, micro-
    // motion during a quick tap can activate pan and fire its onEnd, which
    // — combined with the singleTap recognizer — toggles play/pause while
    // the user is actually trying to minimize/maximize the player.
    .activeOffsetX([-10, 10])
    .activeOffsetY([-10, 10])
    .onBegin(() => {
      scaleAnim.stopAnimation();
      Animated.spring(scaleAnim, { toValue: 1.22, useNativeDriver: true, bounciness: 14, speed: 28 }).start();
    })
    .onStart(() => {
      // Any real drag = the user discovered the circle is movable → stop the
      // wiggle hint forever (also interrupts an in-flight wiggle via stopAnimation).
      markDragLearned();
      if (jamLocked) { return; }
      circleX.stopAnimation(); circleY.stopAnimation();
    })
    .onUpdate((e) => {
      // Movement only. The drag used to also scrub — 2x while held right, a rewind timer
      // while held left — which made one gesture mean two things and, because the rewind
      // wrote positionRef on a 250ms timer, gave the playhead a second writer.
      circleX.setValue(Math.max(-MAX_DRAG,      Math.min(MAX_DRAG,       e.translationX)));
      circleY.setValue(Math.max(-MAX_DRAG_Y_UP, Math.min(MAX_DRAG_Y_DOWN, e.translationY)));
    })
    .onEnd((e) => {
      springBack();
      // ── X-grid ── The swipe belongs to exactly ONE quadrant by its dominant
      // axis, so a left/right swipe can never also trigger open/close (the old
      // bug where a leftward "previous" swipe with a little downward drift would
      // minimise the FS player too). Prefer the axis with the larger flick
      // velocity; fall back to translation when the release is slow.
      const ax = Math.abs(e.translationX), ay = Math.abs(e.translationY);
      const avx = Math.abs(e.velocityX), avy = Math.abs(e.velocityY);
      const horizontalDominant = avx > avy ? true : avx < avy ? false : ax >= ay;
      if (horizontalDominant) {
        // Quick horizontal SNAP → prev/next. A slow drag still does nothing: the velocity
        // threshold keeps an idle fidget with the circle from changing track.
        if (avx > SNAP_VELOCITY) {
          // Only on a committed snap, so a slow fidget with the circle stays silent.
          haptics.select();
          if (e.velocityX > 0) { console.log('[LIVIL][FP] snap → playNext'); playNext(); }
          else { console.log('[LIVIL][FP] snap ← playPrev'); playPrev(); }
        }
      } else if (e.translationY < 0 || e.velocityY < 0) {
        // Up → open FS.
        if (!isFullScreenOpen && (e.translationY < -OPEN_FS_DIST || e.velocityY < -OPEN_FS_VEL)) {
          console.log('[LIVIL][FP] swipe ↑ openFS'); openFullScreenPlayer();
        }
      } else {
        // Down → close FS.
        if (isFullScreenOpen && (e.translationY > CLOSE_FS_DIST || e.velocityY > CLOSE_FS_VEL)) {
          console.log('[LIVIL][FP] swipe ↓ closeFS'); closeFullScreenPlayer();
        }
      }
    })
    .onFinalize(() => {
      springBack();
      scaleAnim.stopAnimation();
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, bounciness: 8, speed: 18 }).start();
    });

  // Race, not Simultaneous: whichever recognizes first wins, the other is
  // canceled. Pan needs ≥10dp movement (activeOffset above), so a real swipe
  // wins over the tap; a stationary tap wins over the pan. Without this both
  // could fire on a single touch and the user would see "minimize toggled
  // play/pause" or "tap fired plus next/prev fired".
  const gesture = Gesture.Race(tapGesture, panGesture);

  // ─── Arc interpolations ───────────────────────────────────────────────────────
  const rightRot = progressAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['180deg', '0deg', '0deg'], extrapolate: 'clamp' });
  const leftRot  = progressAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['180deg', '180deg', '0deg'], extrapolate: 'clamp' });

  if ((!shouldShow && !wasVisible.current) || isStoryViewerOpen || isRepostOpen) { return null; }

  // First letter of jam room title for the avatar
  const avatarLetter = (activeJam?.conversationTitle ?? '?')[0].toUpperCase();

  return (
    <Animated.View
      style={[styles.container, { bottom: playerBottom, opacity: immersiveOpacity, transform: [{ translateY }] }]}
      pointerEvents={(shouldShow && !isImmersive) ? 'box-none' : 'none'}
    >
      {/* ── Bar → Pill ── */}
      <Animated.View
        style={[styles.barBase, {
          top: barTop,
          height: barHeight,
          borderRadius: barRadius,
          backgroundColor: barBg,
          borderColor: barBorderC,
          left: barSideMargin,
          right: barSideMargin,
        }]}
      >
        <Animated.View style={[styles.pillContent, { opacity: contentOpacity }]}>

          {/* ── LEFT ── */}
          <View style={styles.pillLeft}>
            {/* Shuffle — fullscreen only (state 1 & 2) */}
            {isFullScreenOpen && (
              <TouchableOpacity
                onPress={() => { haptics.select(); toggleShuffle(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ShuffleGlyph active={shuffleEnabled} />
              </TouchableOpacity>
            )}
            {/* Music icon + Avatar — jam only (state 1 & 3) */}
            {activeJam && <Icon name="musicNote" size={13} color={COLORS.white} />}
            {activeJam && (
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                </View>
                <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
              </View>
            )}
          </View>

          {/* Centre gap — circle sits here */}
          <View style={styles.circleSpacer} />

          {/* ── RIGHT ── */}
          <View style={styles.pillRight}>
            {/* ↑ Jam button — jam only (state 1 & 3) */}
            {activeJam && (
              <TouchableOpacity
                style={styles.returnChip}
                activeOpacity={0.75}
                onPress={() =>
                  navigation.navigate('JamRoom', {
                    jamRoomId: activeJam.jamRoomId,
                    conversationId: activeJam.conversationId,
                  })
                }
              >
                <Text style={styles.returnText}>↑ Jam</Text>
              </TouchableOpacity>
            )}
            {/* Repeat — fullscreen only (state 1 & 2) */}
            {isFullScreenOpen && (
              <TouchableOpacity
                onPress={() => { haptics.select(); cycleRepeatMode(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <RepeatGlyph mode={repeatMode} />
              </TouchableOpacity>
            )}
          </View>

        </Animated.View>
      </Animated.View>

      {/* ── Wavy-line visualizer ──
          The white line ripples as a scrolling sine wave while playing and
          flattens back to a straight line on pause (Material wavy-progress look).
          Fades out (inverse of morphAnim) as the line morphs into the pill, so it
          only lives on the minimized line. Centered + absolute so it never shifts
          the circle; the album circle sits on top, the wave flows out both sides. */}
      <Animated.View style={[styles.visualizerOverlay, { opacity: visualizerOpacity }]} pointerEvents="none">
        {/* suppressed = isExpanded (FS open OR jam): the wave flattens to a line
            before the pill expands, and only re-ripples once it collapses back —
            during a jam the pill is always expanded, so the wave simply stays off. */}
        <WaveVisualizer playing={isPlaying} suppressed={isExpanded} width={REST_BAR_W} waveform={waveform} />
      </Animated.View>

      {/* ── Draggable circle ── */}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.circleContainer, { transform: [{ translateX: circleX }, { translateY: circleY }, { scale: scaleAnim }] }]}
        >
          <View style={styles.grayDisc} />

          <View style={styles.rightClip}>
            <Animated.View style={[styles.halfWrapper, { transform: [{ rotate: rightRot }] }]}>
              <View style={styles.rightHalfDisc} />
            </Animated.View>
          </View>

          <View style={styles.leftClip}>
            <Animated.View style={[styles.halfWrapperLeft, { transform: [{ rotate: leftRot }] }]}>
              <View style={styles.leftHalfDisc} />
            </Animated.View>
          </View>

          <View style={[styles.innerDisc, isFullScreenOpen && styles.innerDiscOpen]}>
            {/* Minimised → cover (audio) or thumbnail (video). FS open → transparent
                centre (the stroked ring lets the FS video show through). */}
            {!isFullScreenOpen && (
              (nowPlaying?.coverArtUrl ?? nowPlaying?.thumbnailUrl) ? (
                <Image
                  source={{ uri: (nowPlaying.coverArtUrl ?? nowPlaying.thumbnailUrl)! }}
                  style={styles.albumArt}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.fallbackArt}>
                  <CoverFallback />
                </View>
              )
            )}
            {/* Persistent play/pause indicator (driven by global play state).
                Button convention: shows the action a tap would take — ❚❚ while
                playing (tap to pause), ▶ while paused (tap to play). */}
            {nowPlaying && (
              <Animated.View style={[flash.wrap, { transform: [{ scale: iconScale }] }]} pointerEvents="none">
                {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
              </Animated.View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: PILL_W,
    height: D,
    left: (SCREEN_W - PILL_W) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  barBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Centered, absolute (so it never shifts the circle) overlay for the spike
  // visualizer on the resting line. The album circle renders after this and sits
  // on top, framing the spikes that flank it.
  visualizerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 4,
  },

  // Left: flex 1, items left-aligned (shuffle · jam icon · avatar)
  pillLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },


  avatarWrap: {
    position: 'relative',
    width: AV,
    height: AV,
    flexShrink: 0,
  },

  avatar: {
    width: AV,
    height: AV,
    borderRadius: AV / 2,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1.5,
    borderColor: COLORS.purpleNeon,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarLetter: {
    color: COLORS.purpleLight,
    fontSize: 12,
    fontWeight: '700',
  },

  liveDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4444',
    borderWidth: 1.5,
    borderColor: COLORS.bg,
  },

  // Centre gap — exactly the circle width so content never slides under it
  circleSpacer: {
    width: D,
    flexShrink: 0,
  },

  // Right: wraps content (return · repeat), right-aligned
  pillRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },

  returnChip: {
    backgroundColor: 'rgba(139, 61, 255,0.40)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },

  returnText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },

  // ─── Circle ──────────────────────────────────────────────────────────────────
  // The track + progress are STROKED rings (borderWidth B, transparent centre)
  // rather than filled half-discs masked by an opaque inner disc. Same rotation
  // mechanism, identical look — but the hollow centre lets the inner disc be made
  // transparent when FS is open (so the FS video shows through). The half-rings
  // are full-height semicircle arcs: the curved (outer) edge is stroked, the flat
  // edge (towards the centre, at the vertical centre-line) is open (no border).
  circleContainer: { width: D, height: D },
  grayDisc: { position: 'absolute', width: D, height: D, borderRadius: R, borderWidth: B, borderColor: COLORS.textMuted, backgroundColor: 'transparent' },
  rightClip: { position: 'absolute', left: R, top: 0, width: R, height: D, overflow: 'hidden' },
  halfWrapper: { position: 'absolute', left: -R, top: 0, width: D, height: D },
  rightHalfDisc: { position: 'absolute', right: 0, top: 0, width: R, height: D, borderTopRightRadius: R, borderBottomRightRadius: R, borderTopWidth: B, borderRightWidth: B, borderBottomWidth: B, borderLeftWidth: 0, borderColor: COLORS.purpleNeon, backgroundColor: 'transparent' },
  leftClip: { position: 'absolute', left: 0, top: 0, width: R, height: D, overflow: 'hidden' },
  halfWrapperLeft: { position: 'absolute', left: 0, top: 0, width: D, height: D },
  leftHalfDisc: { position: 'absolute', left: 0, top: 0, width: R, height: D, borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopWidth: B, borderLeftWidth: B, borderBottomWidth: B, borderRightWidth: 0, borderColor: COLORS.purpleNeon, backgroundColor: 'transparent' },
  innerDisc: { position: 'absolute', left: B, top: B, right: B, bottom: B, borderRadius: R - B, backgroundColor: COLORS.bg, overflow: 'hidden' },
  // FS open: translucent dark centre that EXACTLY matches the expanded pill/handle
  // background (barBg = 'rgba(10,10,15,0.9)') — a softly tinted centre, not a
  // clear hole. The stroked rings keep it clean (no filled-disc colour bleeds
  // through the translucency).
  innerDiscOpen: { backgroundColor: 'rgba(10,10,15,0.9)' },
  albumArt: { width: '100%', height: '100%' },
  fallbackArt: { flex: 1, backgroundColor: COLORS.card, overflow: 'hidden' },
});
