import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { COLORS } from '../../theme/colors';
import MediaPlayer, { type MediaShape } from '../../components/MediaPlayer';
import { usePlayback, type NowPlayingInfo, type RepeatMode } from '../../contexts/PlaybackContext';
import { useStories } from '../../contexts/StoriesContext';
import { markStorySeen } from '../../services/stories';
import { storyToNowPlaying, storyViewerPostId } from '../../utils/storyPlayback';
import type { RootStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';

type StoryViewerRoute = RouteProp<RootStackParamList, 'StoryViewer'>;
type StoryViewerNav = NativeStackNavigationProp<RootStackParamList, 'StoryViewer'>;


function relativeTime(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) {return `${diff}s`;}
  const m = Math.floor(diff / 60);
  if (m < 60) {return `${m}m`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h`;}
  return `${Math.floor(h / 24)}d`;
}

function avatarInitials(displayName: string | null, username: string): string {
  const name = displayName?.trim() || username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {return '?';}
  if (parts.length === 1) {return parts[0]!.slice(0, 2).toUpperCase();}
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/**
 * Snapshot of the single engine's full state before the viewer opened, so it can
 * be restored intact on close. The viewer overwrites ALL of this — nowPlaying,
 * the queue refs, and positionRef — while it drives the story audio through GAP;
 * restoring only nowPlaying would leave the user's queue as `[last story]` and
 * their song resumed from 0.
 */
type PlaybackSnapshot = {
  nowPlaying: NowPlayingInfo | null;
  queue: NowPlayingInfo[];
  currentIndex: number;
  userQueue: NowPlayingInfo[];
  queueSource: string;
  playSource: 'user' | 'queue';
  position: number;
  duration: number;
  // Repeat/shuffle are forced OFF for the story session so GAP's native clip-end
  // watcher can't loop the clip or wrap-reload the one-item queue (racing the
  // JS advance). Captured here and restored on close.
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
};

export default function StoryViewerScreen() {
  const route = useRoute<StoryViewerRoute>();
  const navigation = useNavigation<StoryViewerNav>();
  const playback = usePlayback();
  const { stories, markSeenLocal } = useStories();

  const { storyIds, startIndex } = route.params;

  // Build ordered story list from context (only IDs that are still present).
  const orderedStories = useMemo(
    () => storyIds.map(id => stories.find(s => s.id === id)).filter(Boolean) as typeof stories,
    [storyIds, stories],
  );

  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, orderedStories.length - 1)));
  const [paused, setPaused] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const initialSeekDoneRef = useRef(false);
  // Single-fire latch for advance(): the progress-bar animation finishing and
  // handleProgress crossing clipEnd can both fire in the same tick, which would
  // call setIndex(i => i + 1) twice and skip a story. Reset per story.
  const advancedRef = useRef(false);
  // Skip the FIRST run of the `paused` effect (below). On mount handlersRef still
  // points at the OUTGOING feed track, so its play() would resumePlay() THAT track
  // and hijack the story — the story is already started by the per-story index
  // effect's requestPlay + GAP's activation.
  const didMountPausedRef = useRef(false);
  // Full snapshot of the single engine's state before the viewer opened, so the
  // user's now-playing track, position, AND queue are restored intact on close —
  // the viewer clobbers all of them while it drives the story audio through GAP.
  const snapshotRef = useRef<PlaybackSnapshot | null>(null);
  // The source URL loaded into the single engine when a story activates. Used to
  // decide whether the per-story forced seek is safe: it is ONLY correct when the
  // story reuses the already-loaded source (same-source → no onLoad → handleLoad's
  // seek never runs). If a DIFFERENT track is loaded, a forced seek would drive the
  // OUTGOING track and race the source switch (Issue 3).
  const loadedSrcRef = useRef<string | null>(null);

  const story = orderedStories[index];

  // On mount: snapshot the engine state, pause the current track, and hide the
  // FloatingPlayer. The story's own AUDIO is then driven through the single
  // GlobalAudioPlayer engine (see the per-story effect below) — NOT a second
  // <Video> — per ADR-0001. On close we restore the full pre-story state (left
  // paused) so the user resumes exactly where they were.
  useEffect(() => {
    snapshotRef.current = {
      nowPlaying: playback.nowPlaying,
      queue: playback.queueRef.current,
      currentIndex: playback.currentIndexRef.current,
      userQueue: playback.userQueueRef.current,
      queueSource: playback.queueSourceRef.current,
      playSource: playback.playSourceRef.current,
      position: playback.positionRef.current,
      duration: playback.durationRef.current,
      repeatMode: playback.repeatMode,
      shuffleEnabled: playback.shuffleEnabled,
    };
    // Record the source currently loaded in the engine (the pre-story track), so
    // the per-story effect can gate its forced seek to the same-source case.
    loadedSrcRef.current = snapshotRef.current.nowPlaying
      ? (snapshotRef.current.nowPlaying.audioUrl ?? snapshotRef.current.nowPlaying.videoUrl ?? null)
      : null;
    playback.handlersRef.current?.pause();
    playback.pauseAll();
    // Force repeat/shuffle OFF for the story session (restored on close). A
    // leaked repeatMode 'all'/'one' would make GAP's native watcher loop the clip
    // or wrap-reload the one-item queue at clipEnd, racing the JS advance.
    playback.setRepeatMode('off');
    playback.setShuffleEnabled(false);
    playback.setStoryViewerOpen(true);
    return () => {
      // Stop the story audio and kill the progress timer (a JS-driven timing can
      // otherwise resolve after a swipe-close and call advance()/close() on an
      // unmounted screen).
      playback.handlersRef.current?.pause();
      progressAnimRef.current?.stop();

      const snap = snapshotRef.current;
      // Restore the full queue the one-item story queue overwrote (setQueue
      // reassigns these refs to NEW arrays, so the snapshotted old arrays were
      // never mutated in place). Applied for both branches below.
      if (snap) {
        playback.queueRef.current = snap.queue;
        playback.currentIndexRef.current = snap.currentIndex;
        playback.userQueueRef.current = snap.userQueue;
        playback.queueSourceRef.current = snap.queueSource;
        playback.playSourceRef.current = snap.playSource;
        // Restore the repeat/shuffle modes we forced OFF for the story session.
        playback.setRepeatMode(snap.repeatMode);
        playback.setShuffleEnabled(snap.shuffleEnabled);
      }

      if (snap?.nowPlaying) {
        // Restore the previous track. setNowPlaying resets positionRef to the new
        // postId's clip start (PlaybackContext:288 new-post branch), so re-apply
        // the saved live position/duration on the next tick, after that updater
        // has run — otherwise the user's song resumes from 0.
        const { nowPlaying: prev, position, duration } = snap;
        playback.setNowPlaying(prev);
        setTimeout(() => {
          playback.durationRef.current = duration;
          // Force the NATIVE engine back to the pre-story position. Raw ref writes
          // are not enough: when `prev` reuses the story's source (no reload → no
          // onLoad → handleLoad's seek never runs) the native playhead stays at the
          // story clip, and on resume onProgress drags positionRef back to it — the
          // feed card then shows the story position (Issue 2).
          //   same-source (the bug)   → engine seeked to `position`; guard drops
          //                             the stale story-position samples.
          //   different-source        → engine is paused by pauseAll and
          //                             setNowPlaying+handleLoad seek anyway; this
          //                             extra seek is a harmless no-op.
          //   fresh-app (prev==null)  → untouched (clearNowPlaying else branch).
          // handlersRef/markSeekTarget belong to the provider (which outlives this
          // screen), so calling them from the post-unmount timer is safe.
          playback.markSeekTarget(position);
          playback.handlersRef.current?.seek(position);
        }, 0);
      } else {
        // Nothing was playing before (the common "fresh app → tap a story ring"
        // path). Clear the clobbered story now-playing + queue, else closing
        // un-hides the FloatingPlayer showing the just-closed story, paused.
        playback.clearNowPlaying();
      }

      // pauseAll (activePostId → null) runs AFTER setNowPlaying. GAP gates
      // playback on activePostId, and null never equals the restored postId in
      // any interleaving, so the restored track settles PAUSED — it does not
      // auto-play (confirmed in review).
      playback.pauseAll();
      playback.setStoryViewerOpen(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const advance = useCallback(() => {
    // Single-fire: the progress-anim finish callback and handleProgress crossing
    // clipEnd can both fire in one tick; without this latch that runs setIndex
    // twice and skips a story. Reset at the top of the per-story effect below.
    if (advancedRef.current) {return;}
    advancedRef.current = true;
    if (index < orderedStories.length - 1) {
      setIndex(i => i + 1);
    } else {
      close();
    }
  }, [index, orderedStories.length, close]);

  // Start/restart the progress bar animation when the story changes.
  useEffect(() => {
    if (!story) {
      close();
      return;
    }

    progressAnim.setValue(0);
    initialSeekDoneRef.current = false;
    advancedRef.current = false;
    setPaused(false);

    // Drive this story's AUDIO through the single GlobalAudioPlayer engine
    // (ADR-0001). A one-item queue with repeat forced OFF (see mount effect)
    // contains GAP's native auto-advance — a stray clip-end/next resolves to a
    // no-op instead of jumping into a stale queue.
    //
    // Order matters (mirrors PostCard's union of both play paths):
    //   1. setQueue / setNowPlaying — the now-playing info carries the REAL clip,
    //      so setNowPlaying's new-post branch sets positionRef = clipStart and
    //      clipWindowRef = {start,end} (both bounds non-null).
    //   2. markSeekTarget BEFORE the forced seek — arm the seek-guard so any
    //      stale feed-position onProgress is filtered, and bump seekNonce to nudge
    //      the muted picture frame.
    //   3. handlersRef.seek(clipStart) — FORCE the engine to the clip start, but
    //      ONLY when the story reuses the already-loaded source (Case A). Then no
    //      onLoad fires, so handleLoad's seek never runs and this is the sole
    //      reposition. For a DIFFERENT/absent source (Case B) setNowPlaying
    //      switches GAP's source and handleLoad seeks to positionRef(=clipStart);
    //      a forced seek here would drive the OUTGOING track and RACE the switch
    //      (Issue 3 — the feed's loaded track playing under the story picture).
    //      NOT wrapped in setTimeout — that would re-race the deferred setNowPlaying
    //      updater. null-safe for the fresh-app path (no handlers yet).
    //   4. requestPlay last — activate the engine.
    const info = storyToNowPlaying(story);
    const storyUrl = info.audioUrl ?? info.videoUrl ?? null;
    const sameSource = loadedSrcRef.current != null && loadedSrcRef.current === storyUrl;

    playback.setQueue([info], 0, 'story');
    playback.setNowPlaying(info);
    playback.markSeekTarget(story.clipStartSec);
    if (sameSource) {
      // Case A: same source already loaded, no onLoad → force reposition.
      playback.handlersRef.current?.seek(story.clipStartSec);
    }
    // else Case B: different/no source — setNowPlaying switches GAP's source and
    // handleLoad seeks to positionRef(=clipStart). A forced seek here would drive
    // the OUTGOING track and race the switch.
    playback.requestPlay(info.postId);
    loadedSrcRef.current = storyUrl;

    // Seek the MUTED picture frame to the clip start on first load.
    setSeekTo(story.clipStartSec);
    setTimeout(() => setSeekTo(null), 0);

    // Mark seen after 500ms dwell.
    if (seenTimerRef.current) {clearTimeout(seenTimerRef.current);}
    if (story.viewedAt === null) {
      seenTimerRef.current = setTimeout(() => {
        markStorySeen(story.id).catch(() => {});
        markSeenLocal(story.id);
      }, 500);
    }

    return () => {
      if (seenTimerRef.current) {clearTimeout(seenTimerRef.current);}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Run the progress bar animation in sync with the clip duration.
  const clipDuration = story ? story.clipEndSec - story.clipStartSec : 0;

  const startProgressAnim = useCallback(() => {
    if (progressAnimRef.current) {progressAnimRef.current.stop();}
    progressAnim.setValue(0);
    if (clipDuration <= 0) {return;}
    progressAnimRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: clipDuration * 1000,
      useNativeDriver: false,
    });
    progressAnimRef.current.start(({ finished }) => {
      if (finished) {advance();}
    });
  }, [progressAnim, clipDuration, advance]);

  const handleLoaded = useCallback(() => {
    startProgressAnim();
  }, [startProgressAnim]);

  // When playback reaches clip_end, auto-advance.
  const handleProgress = useCallback((pos: number) => {
    if (!story) {return;}
    if (pos >= story.clipEndSec) {
      advance();
    }
  }, [story, advance]);

  // Pause / resume the progress bar when the story pauses/plays.
  useEffect(() => {
    if (!didMountPausedRef.current) {
      didMountPausedRef.current = true;
      return; // mount run: story already started by the index effect; play() here would resume the OUTGOING feed track and hijack the story
    }
    // Drive the single engine — a tap holds/resumes the story AUDIO through GAP
    // (the muted picture frame is paused by the `paused` prop separately).
    if (paused) {
      playback.handlersRef.current?.pause();
    } else {
      playback.handlersRef.current?.play();
    }
    if (paused) {
      progressAnimRef.current?.stop();
    } else {
      // Resume — restart from current value.
      const remaining = clipDuration * (1 - (progressAnim as any)._value) * 1000;
      if (remaining > 0) {
        progressAnimRef.current = Animated.timing(progressAnim, {
          toValue: 1,
          duration: remaining,
          useNativeDriver: false,
        });
        progressAnimRef.current.start(({ finished }) => {
          if (finished) {advance();}
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const media: MediaShape | null = useMemo(() => {
    if (!story) {return null;}
    const t = story.track;
    if (t.mediaKind === 'video' && t.videoUrl) {
      return { kind: 'video', videoUrl: t.videoUrl };
    }
    if (t.audioUrl) {
      return { kind: 'audio', audioUrl: t.audioUrl, coverUrl: t.coverArtUrl };
    }
    return null;
  }, [story]);

  // Swipe-down to close.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([8, Infinity])
        .onEnd(e => {
          if (e.translationY > 80 || e.velocityY > 500) {close();}
        }),
    [close],
  );

  // Tap to advance. `maxDuration(250)` so a press-and-hold can't register as a
  // tap — a hold is claimed by the long-press gesture below instead.
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDuration(250)
        .onEnd(() => {
          advance();
        }),
    [advance],
  );

  // Press-and-HOLD to pause (Instagram model), release/cancel to resume. Drives
  // the existing `paused` state, which the `paused` effect routes to the single
  // engine. `onFinalize` fires on BOTH release and cancel, so the story can never
  // get stuck paused.
  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .runOnJS(true)
        .minDuration(250)
        .onStart(() => setPaused(true))
        .onFinalize(() => setPaused(false)),
    [],
  );

  const composedGesture = useMemo(
    () => Gesture.Race(panGesture, longPressGesture, tapGesture),
    [panGesture, longPressGesture, tapGesture],
  );

  if (!story || orderedStories.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.root}>
          {/* Background media — fills entire screen */}
          {media ? (
            <MediaPlayer
              postId={storyViewerPostId(story.id)}
              media={media}
              paused={paused}
              onTogglePaused={() => setPaused(p => !p)}
              onProgress={handleProgress}
              onLoaded={handleLoaded}
              seekTo={seekTo}
              visible
              pauseWhenOffScreen={false}
              // MUTED picture-only frame — the story's audio plays through the
              // single GlobalAudioPlayer engine (ADR-0001), never a second
              // <Video>. Without this the viewer runs two audio engines at once.
              muted
              // Story mode: render no touch handlers. The GestureDetector above
              // owns all touch (tap→advance, hold→pause, swipe→close); otherwise
              // MediaPlayer's inner Pressables win the Gesture.Race and toggle
              // pause instead of advancing (Issue 1).
              interactionsDisabled
              style={StyleSheet.absoluteFill}
            />
          ) : null}

          {/* Dark gradient overlay at top */}
          <View style={styles.topGradient} pointerEvents="none" />

          {/* ── Top UI (not inside GestureDetector so taps are reliable) ── */}
          <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
            {/* Progress pills */}
            <View style={styles.progressRow}>
              {orderedStories.map((s, i) => (
                <View key={s.id} style={[styles.progressPill, { flex: 1 }]}>
                  {i < index ? (
                    <View style={styles.progressFillFull} />
                  ) : i === index ? (
                    <Animated.View
                      style={[
                        styles.progressFillActive,
                        { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                      ]}
                    />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header row */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.authorRow}
                onPress={() => {
                  navigation.goBack();
                  setTimeout(
                    () => navigation.navigate('UserProfile', { userId: story.author.id }),
                    180,
                  );
                }}
              >
                <View style={styles.authorAvatar}>
                  {story.author.avatarUrl ? (
                    <Image source={{ uri: story.author.avatarUrl }} style={styles.authorAvatarImg} />
                  ) : (
                    <Text style={styles.authorAvatarText}>
                      {avatarInitials(story.author.displayName, story.author.username)}
                    </Text>
                  )}
                </View>
                <View>
                  <Text style={styles.authorUsername} numberOfLines={1}>
                    @{story.author.username}
                  </Text>
                  <Text style={styles.authorTime}>{relativeTime(story.createdAt)}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={close}
                activeOpacity={0.7}
                style={styles.closeBtn}
                hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
              >
                <Icon name="close" size={18} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* ── Bottom comment ── */}
          {story.comment ? (
            <SafeAreaView style={styles.commentArea} edges={['bottom']} pointerEvents="none">
              <Text style={styles.commentText}>{story.comment}</Text>
            </SafeAreaView>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    backgroundColor: 'transparent',
    // Emulate a top-to-transparent gradient with a semi-opaque overlay
    opacity: 0.45,
    // backgroundColor: 'black' would block content; use a solid-to-transparent feel with the overlay approach
  },
  // Progress bar row
  progressRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 4,
  },
  progressPill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFillFull: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.white,
  },
  progressFillActive: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.white,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  authorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  authorAvatarImg: {
    width: '100%',
    height: '100%',
  },
  authorAvatarText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
  authorUsername: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  authorTime: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bottom comment
  commentArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingBottom: 24,
    paddingTop: 14,
  },
  commentText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
