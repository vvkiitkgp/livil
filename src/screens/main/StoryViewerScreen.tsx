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
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

import { COLORS } from '../../theme/colors';
import MediaPlayer, { type MediaShape } from '../../components/MediaPlayer';
import { usePlayback, type NowPlayingInfo, type RepeatMode } from '../../contexts/PlaybackContext';
import { useStories } from '../../contexts/StoriesContext';
import { useRelationships } from '../../contexts/RelationshipContext';
import { useToast } from '../../contexts/ToastContext';
import {
  markStorySeen,
  deleteStory,
  getStoryPostAuthorId,
  type Story,
} from '../../services/stories';
import { storyToNowPlaying, storyViewerPostId } from '../../utils/storyPlayback';
import { flattenClusters, flatStartIndex } from '../../utils/groupStoriesByAuthor';
import type { RootStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';
import Scrim from '../../components/Scrim';
import ConfirmActionModal from '../../components/ConfirmActionModal';

type StoryViewerRoute = RouteProp<RootStackParamList, 'StoryViewer'>;
type StoryViewerNav = NativeStackNavigationProp<RootStackParamList, 'StoryViewer'>;

const { width: SCREEN_W } = Dimensions.get('window');
/** Left third of the screen taps BACK; the rest taps FORWARD (Instagram). */
const TAP_BACK_FRACTION = 0.3;
/** Drag distance (dp) / fling velocity past which a downward swipe dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 850;
/** Horizontal drag (dp) past which a swipe jumps to the adjacent author. */
const AUTHOR_SWIPE_DISTANCE = 64;

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
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
};

/** A flat playable entry: the resolved story plus which author cluster it belongs
 *  to. Author index travels WITH each surviving story, so deletion/seen-updates
 *  can never misalign the index from its author boundary. */
type ViewerItem = { story: Story; authorIndex: number };

export default function StoryViewerScreen() {
  const route = useRoute<StoryViewerRoute>();
  const navigation = useNavigation<StoryViewerNav>();
  const playback = usePlayback();
  const { stories, markSeenLocal, removeLocal } = useStories();
  const { meId } = useRelationships();
  const { showToast } = useToast();

  const { clusters, startAuthorIndex, startStoryIndex } = route.params;

  // Flatten the author clusters into one ordered index space (contiguous per
  // author), carrying each story's author index so cross-author tap/swipe and
  // per-author progress segments work off a single `index` — which keeps the
  // load-bearing per-story playback effect below unchanged.
  const flat = useMemo(() => flattenClusters(clusters), [clusters]);

  const items = useMemo<ViewerItem[]>(
    () =>
      flat.orderedStoryIds
        .map((id, i) => {
          const s = stories.find(x => x.id === id);
          return s ? { story: s, authorIndex: flat.authorIndexByStory[i]! } : null;
        })
        .filter((x): x is ViewerItem => x !== null),
    [flat, stories],
  );

  const initialIndex = useMemo(
    () => flatStartIndex(clusters, startAuthorIndex, startStoryIndex ?? 0),
    [clusters, startAuthorIndex, startStoryIndex],
  );

  const [index, setIndex] = useState(() =>
    Math.min(initialIndex, Math.max(0, flat.orderedStoryIds.length - 1)),
  );
  const [paused, setPaused] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  // Monotonic "presentation" id, bumped every time the current story changes
  // (forward, backward, author jump, or a delete shifting the list). advance()
  // latches on it so the two clocks (progress-anim finish + handleProgress
  // clip-end) can fire at most ONE advance per presentation, while a stale clock
  // from a prior presentation is ignored — and returning to a story (backward)
  // gets a fresh presentation, so it isn't wrongly latched shut.
  const presentationRef = useRef(0);
  const advancedForRef = useRef(-1);
  // Skip the FIRST run of the `paused` effect. On mount handlersRef still points
  // at the OUTGOING feed track, so its play() would resumePlay() THAT track and
  // hijack the story — the story is started by the per-story effect + GAP.
  const didMountPausedRef = useRef(false);
  const snapshotRef = useRef<PlaybackSnapshot | null>(null);
  // Source URL loaded into the engine when a story activates — the per-story
  // forced seek is only safe when the story reuses the already-loaded source.
  const loadedSrcRef = useRef<string | null>(null);

  const item = items[index];
  const story = item?.story;
  const currentAuthorIndex = item?.authorIndex ?? -1;
  const isOwner = !!meId && !!story && story.author.id === meId;

  // The current author's stories → the segmented progress bar shows only these.
  const authorItems = useMemo(
    () => items.filter(x => x.authorIndex === currentAuthorIndex),
    [items, currentAuthorIndex],
  );
  const activeInAuthor = useMemo(
    () => (story ? authorItems.findIndex(x => x.story.id === story.id) : -1),
    [authorItems, story],
  );

  // ── Gesture transform (reanimated): drag-follow dismiss + chrome fade ──
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const chromeOpacity = useSharedValue(1);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  // On mount: snapshot engine state, pause the current track, hide FloatingPlayer.
  // The story AUDIO is then driven through the single GlobalAudioPlayer engine
  // (see the per-story effect) — NOT a second <Video> — per ADR-0001. On close we
  // restore the full pre-story state (left paused).
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
    loadedSrcRef.current = snapshotRef.current.nowPlaying
      ? (snapshotRef.current.nowPlaying.audioUrl ?? snapshotRef.current.nowPlaying.videoUrl ?? null)
      : null;
    playback.handlersRef.current?.pause();
    playback.pauseAll();
    // Force repeat/shuffle OFF for the story session (restored on close), so
    // GAP's native watcher can't loop the clip or wrap-reload the one-item queue.
    playback.setRepeatMode('off');
    playback.setShuffleEnabled(false);
    playback.setStoryViewerOpen(true);
    return () => {
      playback.handlersRef.current?.pause();
      progressAnimRef.current?.stop();

      const snap = snapshotRef.current;
      if (snap) {
        playback.queueRef.current = snap.queue;
        playback.currentIndexRef.current = snap.currentIndex;
        playback.userQueueRef.current = snap.userQueue;
        playback.queueSourceRef.current = snap.queueSource;
        playback.playSourceRef.current = snap.playSource;
        playback.setRepeatMode(snap.repeatMode);
        playback.setShuffleEnabled(snap.shuffleEnabled);
      }

      if (snap?.nowPlaying) {
        const { nowPlaying: prev, position, duration } = snap;
        playback.setNowPlaying(prev);
        setTimeout(() => {
          playback.durationRef.current = duration;
          // Force the NATIVE engine back to the pre-story position (raw ref writes
          // are not enough for the same-source case — see the util's notes).
          playback.markSeekTarget(position);
          playback.handlersRef.current?.seek(position);
        }, 0);
      } else {
        playback.clearNowPlaying();
      }

      playback.pauseAll();
      playback.setStoryViewerOpen(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── Navigation between stories ──
  const goForward = useCallback(() => {
    setIndex(i => {
      if (i < items.length - 1) {return i + 1;}
      close();
      return i;
    });
  }, [items.length, close]);

  const goBackward = useCallback(() => {
    setIndex(i => (i > 0 ? i - 1 : i));
  }, []);

  // Jump to the first story of the adjacent author cluster (Instagram horizontal
  // swipe). Past the last author, close; before the first, stay.
  const jumpAuthor = useCallback(
    (dir: 1 | -1) => {
      const target = currentAuthorIndex + dir;
      const idx = items.findIndex(x => x.authorIndex === target);
      if (idx >= 0) {
        setIndex(idx);
      } else if (dir === 1) {
        close();
      }
    },
    [currentAuthorIndex, items, close],
  );

  // Single-fire advance, keyed by presentation id (see presentationRef).
  const requestAdvance = useCallback(
    (fromPresentation: number) => {
      if (fromPresentation !== presentationRef.current) {return;}
      if (advancedForRef.current === fromPresentation) {return;}
      advancedForRef.current = fromPresentation;
      goForward();
    },
    [goForward],
  );

  // ── Per-story effect: drive this story's AUDIO through the single engine ──
  // Keyed on the current story id (not the raw index) so a delete that shifts the
  // list, or a backward/author jump, always re-drives audio for whatever story is
  // now current.
  const storyId = story?.id;
  useEffect(() => {
    if (!story) {
      close();
      return;
    }

    presentationRef.current += 1;
    progressAnim.setValue(0);
    setPaused(false);

    // Order mirrors PostCard's union of both play paths — see storyPlayback.ts.
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
      const id = story.id;
      seenTimerRef.current = setTimeout(() => {
        markStorySeen(id).catch(() => {});
        markSeenLocal(id);
      }, 500);
    }

    return () => {
      if (seenTimerRef.current) {clearTimeout(seenTimerRef.current);}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const clipDuration = story ? story.clipEndSec - story.clipStartSec : 0;

  const startProgressAnim = useCallback(() => {
    if (progressAnimRef.current) {progressAnimRef.current.stop();}
    progressAnim.setValue(0);
    if (clipDuration <= 0) {return;}
    const p = presentationRef.current;
    progressAnimRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: clipDuration * 1000,
      useNativeDriver: false,
    });
    progressAnimRef.current.start(({ finished }) => {
      if (finished) {requestAdvance(p);}
    });
  }, [progressAnim, clipDuration, requestAdvance]);

  const handleLoaded = useCallback(() => {
    startProgressAnim();
  }, [startProgressAnim]);

  // When playback reaches clip_end, auto-advance (the audio-accurate clock).
  const handleProgress = useCallback((pos: number) => {
    if (!story) {return;}
    if (pos >= story.clipEndSec) {
      requestAdvance(presentationRef.current);
    }
  }, [story, requestAdvance]);

  // Pause / resume the progress bar when the story pauses/plays.
  useEffect(() => {
    if (!didMountPausedRef.current) {
      didMountPausedRef.current = true;
      return; // mount run: story already started by the per-story effect
    }
    if (paused) {
      playback.handlersRef.current?.pause();
      progressAnimRef.current?.stop();
    } else {
      playback.handlersRef.current?.play();
      const p = presentationRef.current;
      const remaining = clipDuration * (1 - (progressAnim as any)._value) * 1000;
      if (remaining > 0) {
        progressAnimRef.current = Animated.timing(progressAnim, {
          toValue: 1,
          duration: remaining,
          useNativeDriver: false,
        });
        progressAnimRef.current.start(({ finished }) => {
          if (finished) {requestAdvance(p);}
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

  // ── Go to the song's post: deep-link to the original upload via its author's
  //    profile (the app has no standalone post screen). ──
  const openSong = useCallback(async () => {
    if (!story) {return;}
    const authorId = await getStoryPostAuthorId(story.originalPostId);
    if (!authorId) {
      showToast("Couldn't open the song's post.", { kind: 'error' });
      return;
    }
    navigation.goBack();
    setTimeout(
      () => navigation.navigate('UserProfile', { userId: authorId, focusPostId: story.originalPostId }),
      180,
    );
  }, [story, navigation, showToast]);

  // ── Author delete ──
  const onConfirmDelete = useCallback(async () => {
    if (!story) {return;}
    const id = story.id;
    setDeleting(true);
    try {
      await deleteStory(id);
    } catch {
      setDeleting(false);
      showToast("Couldn't delete story. Please try again.", { kind: 'error' });
      return;
    }
    setDeleting(false);
    setConfirmDelete(false);
    // If this was the only story left, close; otherwise clamp the index and let
    // the story-keyed effect re-drive whatever is now current.
    if (items.length <= 1) {
      removeLocal(id);
      close();
      return;
    }
    if (index >= items.length - 1) {
      setIndex(i => Math.max(0, i - 1));
    }
    removeLocal(id);
  }, [story, items.length, index, removeLocal, close, showToast]);

  const openMenu = useCallback(() => {
    setPaused(true);
    setMenuOpen(true);
  }, []);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setPaused(false);
  }, []);

  // ── Gestures ──
  // Tap: left third → previous, elsewhere → next.
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .onEnd((e, success) => {
          if (!success) {return;}
          if (e.x < SCREEN_W * TAP_BACK_FRACTION) {
            runOnJS(goBackward)();
          } else {
            runOnJS(goForward)();
          }
        }),
    [goBackward, goForward],
  );

  // Long-press: hold to pause + fade the chrome; release to resume.
  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(220)
        .maxDistance(20)
        .onStart(() => {
          chromeOpacity.value = withTiming(0, { duration: 150 });
          runOnJS(setPaused)(true);
        })
        .onFinalize(() => {
          chromeOpacity.value = withTiming(1, { duration: 150 });
          runOnJS(setPaused)(false);
        }),
    [chromeOpacity],
  );

  // Pan: downward drag follows the finger and dismisses past a threshold;
  // horizontal drag jumps between authors.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(12)
        .onUpdate(e => {
          if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
            tx.value = e.translationX;
            ty.value = 0;
            scale.value = 1;
          } else {
            ty.value = Math.max(0, e.translationY);
            tx.value = 0;
            const prog = Math.min(1, ty.value / 500);
            scale.value = 1 - prog * 0.12;
          }
        })
        .onEnd(e => {
          const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
          if (horizontal && Math.abs(e.translationX) > AUTHOR_SWIPE_DISTANCE) {
            runOnJS(jumpAuthor)(e.translationX < 0 ? 1 : -1);
          } else if (!horizontal && (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY)) {
            runOnJS(close)();
            return;
          }
          tx.value = withSpring(0);
          ty.value = withSpring(0);
          scale.value = withSpring(1);
        }),
    [tx, ty, scale, jumpAuthor, close],
  );

  const composedGesture = useMemo(
    () => Gesture.Race(panGesture, longPressGesture, tapGesture),
    [panGesture, longPressGesture, tapGesture],
  );

  if (!story || items.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      <Reanimated.View style={[styles.root, containerStyle]}>
        {/* Media + gesture surface */}
        <GestureDetector gesture={composedGesture}>
          <View style={styles.root}>
            {media ? (
              <MediaPlayer
                postId={storyViewerPostId(story.id)}
                media={media}
                paused={paused}
                onTogglePaused={() => {}}
                onProgress={handleProgress}
                onLoaded={handleLoaded}
                seekTo={seekTo}
                visible
                pauseWhenOffScreen={false}
                // MUTED picture-only frame — the story's audio plays through the
                // single GlobalAudioPlayer engine (ADR-0001), never a second
                // <Video>.
                muted
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Scrim edge="top" height={150} peakOpacity={0.72} />
            <Scrim edge="bottom" height={230} peakOpacity={0.82} />
          </View>
        </GestureDetector>

        {/* Chrome — OUTSIDE the GestureDetector so its buttons get reliable taps;
            fades out on hold via chromeStyle. */}
        <Reanimated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
          <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
            {/* Segmented progress — the CURRENT author's stories only. */}
            <View style={styles.progressRow}>
              {authorItems.map((it, i) => (
                <View key={it.story.id} style={styles.progressPill}>
                  {i < activeInAuthor ? (
                    <View style={styles.progressFillFull} />
                  ) : i === activeInAuthor ? (
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

            {/* Header */}
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

              <View style={styles.headerActions}>
                {isOwner ? (
                  <TouchableOpacity
                    onPress={openMenu}
                    activeOpacity={0.7}
                    style={styles.headerBtn}
                    hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Icon name="overflow" size={20} color={COLORS.white} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={close}
                  activeOpacity={0.7}
                  style={styles.headerBtn}
                  hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
                >
                  <Icon name="close" size={18} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>

          {/* Bottom stack: comment → go-to-song bar */}
          <SafeAreaView style={styles.bottomArea} edges={['bottom']} pointerEvents="box-none">
            {story.comment ? (
              <Text style={styles.commentText}>{story.comment}</Text>
            ) : null}
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.songBar}
              onPress={openSong}
            >
              <View style={styles.songCover}>
                {story.track.coverArtUrl ? (
                  <Image source={{ uri: story.track.coverArtUrl }} style={styles.songCoverImg} />
                ) : (
                  <Icon name="musicNotes" size={16} color={COLORS.white} />
                )}
              </View>
              <View style={styles.songText}>
                <Text style={styles.songTitle} numberOfLines={1}>
                  {story.track.title}
                </Text>
                <Text style={styles.songSub} numberOfLines={1}>
                  Tap to open the song's post
                </Text>
              </View>
              <Icon name="arrowRight" size={18} color={COLORS.purpleLight} />
            </TouchableOpacity>
          </SafeAreaView>
        </Reanimated.View>
      </Reanimated.View>

      {/* Owner overflow menu */}
      {menuOpen ? (
        <>
          <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={closeMenu} />
          <SafeAreaView style={styles.menuAnchor} edges={['top']} pointerEvents="box-none">
            <View style={styles.menu}>
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Icon name="trash" size={18} color={COLORS.error} />
                <Text style={styles.menuItemText}>Delete story</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </>
      ) : null}

      <ConfirmActionModal
        visible={confirmDelete}
        title="Delete this story?"
        message="It will be removed for everyone right away. This can't be undone."
        glyph="🗑"
        tone="destructive"
        confirmLabel="Delete"
        cancelLabel="Keep"
        busy={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setPaused(false);
        }}
      />
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
  progressRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 4,
  },
  progressPill: {
    flex: 1,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bottom stack
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 18,
    gap: 10,
  },
  commentText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    paddingHorizontal: 2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  songBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.purple,
    backgroundColor: 'rgba(14,14,21,0.55)',
  },
  songCover: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  songCoverImg: {
    width: '100%',
    height: '100%',
  },
  songText: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  songSub: {
    color: COLORS.purpleLight,
    fontSize: 11,
    marginTop: 1,
  },
  // Owner menu
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuAnchor: {
    position: 'absolute',
    top: 0,
    right: 14,
  },
  menu: {
    marginTop: 52,
    minWidth: 180,
    backgroundColor: COLORS.surface,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  menuItemText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '700',
  },
});
