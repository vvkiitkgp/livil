import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Animated,
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
import { COLORS } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ─── Dimensions ───────────────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const D    = 60;   // circle diameter
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
const RATE_FORWARD  = 2.0;

// Avatar
const AV = 28;  // avatar diameter

export const FLOATING_PLAYER_HEIGHT = D;

// ─── Repeat icon glyphs ───────────────────────────────────────────────────────
function RepeatGlyph({ mode }: { mode: string }) {
  const active = mode !== 'off';
  const color  = COLORS.white;
  return (
    <View style={icon.wrap}>
      <Text style={[icon.glyph, { color }]}>↻</Text>
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
      <Text style={[icon.glyph, { color }]}>⇄</Text>
      {active && <View style={[icon.dot, { backgroundColor: color }]} />}
    </View>
  );
}

const icon = StyleSheet.create({
  wrap:  { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 18, fontWeight: '400' },
  badge: { position: 'absolute', top: 3, right: 3, fontSize: 7, fontWeight: '700', color: COLORS.white },
  dot:   { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
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
    jamLocked,
    shuffleEnabled, toggleShuffle,
    repeatMode, cycleRepeatMode,
    setNowPlaying, requestPlay, resumePlay, setQueue,
    reportPaused, playSourceRef,
  } = usePlayback();

  const { activeJam } = useJam();

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
  const shouldShow = !!nowPlaying || !!activeJam;
  useEffect(() => {
    if (shouldShow && !wasVisible.current) {
      wasVisible.current = true;
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
    } else if (!shouldShow && wasVisible.current) {
      wasVisible.current = false;
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [shouldShow, slideAnim]);

  // Combined vertical translate — native driver only
  const translateY = Animated.add(
    slideAnim.interpolate({ inputRange: [0, 1], outputRange: [D + 24, 0] }),
    keyboardAnim.interpolate({ inputRange: [0, 1], outputRange: [0, D + 24] }),
  );

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

  // ─── Circle anims ─────────────────────────────────────────────────────────────
  const circleX   = useRef(new Animated.Value(0)).current;
  const circleY   = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const springBack = () => Animated.parallel([
    Animated.spring(circleX, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
    Animated.spring(circleY, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
  ]).start();

  const rewindTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRewind  = () => { if (rewindTimer.current !== null) { clearInterval(rewindTimer.current); rewindTimer.current = null; } };
  const startRewind = () => {
    stopRewind();
    rewindTimer.current = setInterval(() => {
      const p = Math.max(0, positionRef.current - 0.5);
      positionRef.current = p;
      handlersRef.current?.seek(p);
    }, 250);
  };

  // ─── Bar / pill morph (non-native — animates layout props) ───────────────────
  const isExpanded = isFullScreenOpen || !!activeJam;
  // Jam active but fullscreen NOT open → narrow pill (no shuffle/repeat)
  const isJamOnly  = !!activeJam && !isFullScreenOpen;

  const morphAnim  = useRef(new Animated.Value(0)).current;
  const narrowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(morphAnim, {
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: false,
      bounciness: isExpanded ? 10 : 4,
      speed: 14,
    }).start();
  }, [isExpanded, morphAnim]);

  useEffect(() => {
    Animated.spring(narrowAnim, {
      toValue: isJamOnly ? 1 : 0,
      useNativeDriver: false,
      bounciness: 8,
      speed: 14,
    }).start();
  }, [isJamOnly, narrowAnim]);

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
  const barBg      = morphAnim.interpolate({ inputRange: [0, 1], outputRange: ['#FFFFFF', 'rgba(10,10,15,0.82)'] });
  const barBorderC = morphAnim.interpolate({ inputRange: [0, 1], outputRange: ['rgba(124,58,237,0)', 'rgba(124,58,237,0.50)'] });
  // Content fades in only after pill is mostly open, and out before it collapses
  const contentOpacity = morphAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

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
  }, [setQueue, setNowPlaying, requestPlay]);

  const singleTap = Gesture.Tap().numberOfTaps(1).runOnJS(true)
    .onEnd((_e, ok) => {
      if (!ok || jamLocked) { return; }
      const hasHandlers = !!handlersRef.current;
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
      if (jamLocked) { return; }
      circleX.stopAnimation(); circleY.stopAnimation(); stopRewind();
    })
    .onUpdate((e) => {
      circleX.setValue(Math.max(-MAX_DRAG,      Math.min(MAX_DRAG,       e.translationX)));
      circleY.setValue(Math.max(-MAX_DRAG_Y_UP, Math.min(MAX_DRAG_Y_DOWN, e.translationY)));
      const isH = Math.abs(e.translationX) > Math.abs(e.translationY);
      if (isH) {
        if (e.translationX >= 0) { stopRewind(); console.log('[LIVIL][FP] dragging → forward 2x'); handlersRef.current?.setRate(RATE_FORWARD); }
        else {
          handlersRef.current?.setRate(1.0);
          if (rewindTimer.current === null && activePostId !== null) { console.log('[LIVIL][FP] dragging ← rewind'); startRewind(); }
        }
      } else { stopRewind(); handlersRef.current?.setRate(1.0); }
    })
    .onEnd((e) => {
      stopRewind(); handlersRef.current?.setRate(1.0); springBack();
      if (isFullScreenOpen && (e.translationY > CLOSE_FS_DIST || e.velocityY > CLOSE_FS_VEL)) { closeFullScreenPlayer(); return; }
      if (!isFullScreenOpen && (e.translationY < -OPEN_FS_DIST || (e.velocityY < -OPEN_FS_VEL && e.translationY < -20))) { openFullScreenPlayer(); return; }
      if (Math.abs(e.velocityX) > SNAP_VELOCITY) {
        if (e.velocityX > 0) { console.log('[LIVIL][FP] swipe → playNext'); playNext(); }
        else { console.log('[LIVIL][FP] swipe ← playPrev'); playPrev(); }
      }
    })
    .onFinalize(() => {
      stopRewind(); handlersRef.current?.setRate(1.0); springBack();
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
      style={[styles.container, { bottom: playerBottom, transform: [{ translateY }] }]}
      pointerEvents={shouldShow ? 'box-none' : 'none'}
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
              <TouchableOpacity onPress={toggleShuffle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <ShuffleGlyph active={shuffleEnabled} />
              </TouchableOpacity>
            )}
            {/* Music icon + Avatar — jam only (state 1 & 3) */}
            {activeJam && <Text style={styles.jamIcon}>🎵</Text>}
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
              <TouchableOpacity onPress={cycleRepeatMode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <RepeatGlyph mode={repeatMode} />
              </TouchableOpacity>
            )}
          </View>

        </Animated.View>
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

          <View style={styles.innerDisc}>
            {nowPlaying?.coverArtUrl ? (
              <Image source={{ uri: nowPlaying.coverArtUrl }} style={styles.albumArt} resizeMode="cover" />
            ) : (
              <View style={styles.fallbackArt}>
                <View style={styles.fallbackBlobA} />
                <View style={styles.fallbackBlobB} />
              </View>
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

  jamIcon: {
    fontSize: 13,
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
    borderColor: COLORS.purple,
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
    backgroundColor: 'rgba(124,58,237,0.40)',
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
  circleContainer: { width: D, height: D },
  grayDisc: { position: 'absolute', width: D, height: D, borderRadius: R, backgroundColor: COLORS.textMuted },
  rightClip: { position: 'absolute', left: R, top: 0, width: R, height: D, overflow: 'hidden' },
  halfWrapper: { position: 'absolute', left: -R, top: 0, width: D, height: D },
  rightHalfDisc: { position: 'absolute', right: 0, top: 0, width: R, height: D, borderTopRightRadius: R, borderBottomRightRadius: R, backgroundColor: COLORS.purple },
  leftClip: { position: 'absolute', left: 0, top: 0, width: R, height: D, overflow: 'hidden' },
  halfWrapperLeft: { position: 'absolute', left: 0, top: 0, width: D, height: D },
  leftHalfDisc: { position: 'absolute', left: 0, top: 0, width: R, height: D, borderTopLeftRadius: R, borderBottomLeftRadius: R, backgroundColor: COLORS.purple },
  innerDisc: { position: 'absolute', left: B, top: B, right: B, bottom: B, borderRadius: R - B, backgroundColor: COLORS.bg, overflow: 'hidden' },
  albumArt: { width: '100%', height: '100%' },
  fallbackArt: { flex: 1, backgroundColor: COLORS.card, overflow: 'hidden' },
  fallbackBlobA: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.purple, opacity: 0.5, top: -15, left: -10 },
  fallbackBlobB: { position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: '#EC4899', opacity: 0.4, bottom: -10, right: -8 },
});
