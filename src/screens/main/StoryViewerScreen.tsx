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
  AppState,
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
  withRepeat,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

import { ViewType } from 'react-native-video';

import { COLORS } from '../../theme/colors';
import MediaPlayer, { type MediaShape } from '../../components/MediaPlayer';
import { usePlayback } from '../../contexts/PlaybackContext';
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
import { GradientBorder } from '../../components/GradientBorder';

type StoryViewerRoute = RouteProp<RootStackParamList, 'StoryViewer'>;
type StoryViewerNav = NativeStackNavigationProp<RootStackParamList, 'StoryViewer'>;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
/** Left third of the screen taps BACK; the rest taps FORWARD (Instagram). */
const TAP_BACK_FRACTION = 0.3;
/**
 * CHROME DEAD ZONES for the tap/long-press recognizers. RNGH's native recognizers
 * hit-test their own attached view (the full-screen media surface) and do NOT
 * yield to plain RN touchables layered above it — so a tap on the ⋯ button ALSO
 * fired the right-zone "next" (LIV-62: on a single story that closed the viewer
 * under the just-opened sheet; header taps were firing a harmless "previous").
 * Instagram's rule: taps over the chrome never navigate. Top band covers the
 * progress pills + header row; bottom band covers the comment + song bar stack.
 */
const TAP_GUARD_TOP = 130;
const TAP_GUARD_BOTTOM = 190;
/**
 * Approx height of the ⋯ options sheet (handle + rows + bottom safe area). The
 * zoomed-out card is scaled and lifted so it sits CENTERED in the space above
 * the sheet with even padding all round, instead of half-hidden behind it.
 */
const MENU_SHEET_H = 260;
const MENU_CARD_PAD = 26;
const MENU_SCALE = Math.max(
  0.6,
  (SCREEN_H - MENU_SHEET_H - MENU_CARD_PAD * 2) / SCREEN_H,
);
const MENU_LIFT = -MENU_SHEET_H / 2;
const MENU_CARD_RADIUS = 26;
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

/** A flat playable entry: the resolved story plus which author cluster it belongs
 *  to. Author index travels WITH each surviving story, so deletion/seen-updates
 *  can never misalign the index from its author boundary. */
type ViewerItem = { story: Story; authorIndex: number };

/**
 * A static preview of an author's first story, shown as the incoming/outgoing
 * face of the cube during a horizontal swipe. Deliberately renders NO MediaPlayer
 * (cover art only) — a second video surface would mean a second audio engine.
 */
function AuthorFacePreview({ item }: { item: ViewerItem }) {
  const s = item.story;
  return (
    <View style={styles.previewRoot}>
      {s.track.coverArtUrl ? (
        <Image source={{ uri: s.track.coverArtUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.previewFallback} />
      )}
      <Scrim edge="top" height={150} peakOpacity={0.72} />
      <SafeAreaView style={styles.previewHeader} edges={['top']} pointerEvents="none">
        <View style={styles.authorAvatar}>
          {s.author.avatarUrl ? (
            <Image source={{ uri: s.author.avatarUrl }} style={styles.authorAvatarImg} />
          ) : (
            <Text style={styles.authorAvatarText}>
              {avatarInitials(s.author.displayName, s.author.username)}
            </Text>
          )}
        </View>
        <Text style={styles.authorUsername}>@{s.author.username}</Text>
      </SafeAreaView>
    </View>
  );
}

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
  // Mirror of `index` so navigation decisions (advance-past-end → close) can read
  // the current index WITHOUT doing it inside a setIndex updater — a navigation
  // dispatch there runs during render and warns "setState while rendering".
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  const [paused, setPaused] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Poster shown over a VIDEO story while it loads/seeks, so the 0:00 frame never
  // flashes before the clip start. Hidden once the frame is at the clip.
  const [posterVisible, setPosterVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  /**
   * Halt the progress bar at the VALUE level, not just the animation we hold a
   * ref to. `progressAnimRef` points at the NEWEST animation only — a rapid
   * pause→resume (React batches both `setPaused` calls into one effect run) could
   * start a second animation while the first was still driving `progressAnim`,
   * orphaning it. `stop()` then froze the newest while the orphan kept the bar
   * moving — the "bar keeps running while the story is paused" report.
   * `Animated.Value.stopAnimation()` detaches EVERY animation on the value, so
   * orphans cannot survive. Returns the frozen value via the callback.
   */
  const stopProgress = useCallback((onStopped?: (value: number) => void) => {
    progressAnimRef.current?.stop();
    progressAnimRef.current = null;
    progressAnim.stopAnimation(v => onStopped?.(v));
  }, [progressAnim]);
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

  // The adjacent authors' first stories — the static preview faces of the cube.
  // They render cover art + header only (NO MediaPlayer → no second audio engine).
  const nextAuthorItem = useMemo(
    () => items.find(x => x.authorIndex === currentAuthorIndex + 1) ?? null,
    [items, currentAuthorIndex],
  );
  const prevAuthorItem = useMemo(
    () => items.find(x => x.authorIndex === currentAuthorIndex - 1) ?? null,
    [items, currentAuthorIndex],
  );
  const hasNext = !!nextAuthorItem;
  const hasPrev = !!prevAuthorItem;

  // ── Gesture transforms (reanimated) ──
  // cubeX: horizontal drag → a 3D cube rotation between authors (Instagram).
  // ty/scale: vertical drag-follow dismiss. chromeOpacity: fade chrome on hold.
  const cubeX = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const chromeOpacity = useSharedValue(1);
  // 0→1 while the ⋯ options sheet is open: zooms the whole story UI out over the
  // black root, dims it with a shade, and slides the sheet up (Instagram pattern).
  const menuProgress = useSharedValue(0);
  // Worklet-readable mirror of menuOpenRef (gesture callbacks are worklets and
  // cannot read JS refs): while the sheet / delete-confirm is up, ALL story
  // gestures are inert — a tap on the shade must only close the menu, never leak
  // into the tap zones underneath (the LIV-62 fall-through class).
  const menuOpenSv = useSharedValue(false);

  // The live (front) face: composes the vertical dismiss with the cube rotateY.
  // Hinges on the trailing edge so it turns like a cube face, not a flat flip.
  // While the options sheet is open the whole face zooms out and gains rounded
  // corners (menuProgress).
  const currentFaceStyle = useAnimatedStyle(() => {
    const rot = (cubeX.value / SCREEN_W) * 90;
    const m = menuProgress.value;
    // Menu open: scale down to leave even padding, and lift so the card is
    // CENTERED in the space above the sheet.
    const menuScale = 1 - (1 - MENU_SCALE) * m;
    const menuLift = MENU_LIFT * m;
    return {
      transform: [
        { perspective: 1000 },
        { translateY: ty.value + menuLift },
        { scale: scale.value * menuScale },
        { rotateY: `${rot}deg` },
      ],
      // The cube hinges on the trailing EDGE while swiping — but that origin also
      // makes the menu zoom shrink toward the right edge, leaving the card
      // off-centre with black down one side. Scale about the CENTRE whenever the
      // sheet is involved (gestures are inert then, so the hinge isn't needed).
      // Safe to switch at m===0 because menuScale is 1 there — scaling by 1 is
      // identity about any origin, so there's no jump.
      transformOrigin: m > 0 ? '50% 50%' : (cubeX.value <= 0 ? '100% 50%' : '0% 50%'),
      borderRadius: MENU_CARD_RADIUS * m,
    };
  });
  // Purple gradient glow around the zoomed-out card — the house GradientBorder,
  // faded in with the zoom so it never shows at full screen.
  const menuBorderStyle = useAnimatedStyle(() => ({ opacity: menuProgress.value }));
  const menuShadeStyle = useAnimatedStyle(() => ({ opacity: menuProgress.value }));
  const menuSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - menuProgress.value) * 360 }],
  }));
  // The incoming NEXT author's face — hidden edge-on at rest (90°), rotating to
  // front as you drag left (cubeX 0 → -W).
  const nextFaceStyle = useAnimatedStyle(() => {
    const rot = 90 + (cubeX.value / SCREEN_W) * 90;
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rot}deg` }],
      transformOrigin: '0% 50%',
      opacity: cubeX.value < 0 ? 1 : 0,
    };
  });
  // The incoming PREV author's face — hidden edge-on (-90°), rotating to front as
  // you drag right (cubeX 0 → +W).
  const prevFaceStyle = useAnimatedStyle(() => {
    const rot = -90 + (cubeX.value / SCREEN_W) * 90;
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rot}deg` }],
      transformOrigin: '100% 50%',
      opacity: cubeX.value > 0 ? 1 : 0,
    };
  });
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  // On mount: enter a declared CLIP SESSION (ADR-0013). This snapshots the engine,
  // pauses the user's music, forces repeat/shuffle off, and disarms the native
  // clip-end watcher — the story's advance is owned by the JS progress clock below.
  // The story AUDIO still plays through the single GlobalAudioPlayer engine (per
  // ADR-0001); exitClipSession restores the user's music intact on close.
  useEffect(() => {
    loadedSrcRef.current = playback.enterClipSession(playback.nowPlaying);
    return () => {
      progressAnimRef.current?.stop();
      playback.exitClipSession();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idempotent: close() can be reached from several triggers in the same beat
  // (gesture + AppState background + advance-past-end); a second goBack() would
  // pop the SCREEN UNDER the story.
  const closedRef = useRef(false);
  // `reason` is diagnostic — every close path names itself so a device log shows
  // exactly who exited the viewer (LIV-62 debugging).
  const close = useCallback((reason: string = 'unspecified') => {
    console.log(`[LIVIL][STORY] close(${reason}) closed=${closedRef.current} idx=${indexRef.current}`);
    if (closedRef.current) { return; }
    closedRef.current = true;
    // Pause the engine IMMEDIATELY, before the dismiss/navigation animation, so a
    // gesture always wins over playback — otherwise the story audio keeps playing
    // through the close transition (exitClipSession only pauses on unmount, after
    // the animation). Every close path (swipe-down, X, tap-past-end) routes here.
    playback.handlersRef.current?.pause();
    stopProgress();
    navigation.goBack();
  }, [navigation, playback, stopProgress]);

  // Stories are FOREGROUND-ONLY (product call, Instagram semantics — ADR-0013
  // phase 2): leaving the app closes the viewer entirely. Audio is stopped
  // NATIVELY by GAP's playInBackground={false} during a clip session (a JS pause
  // here would be Fabric-deferred while backgrounded); this listener closes the
  // SCREEN so returning to the app lands on whatever was under the story
  // (Home / profile), with the user's music restored paused by exitClipSession.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      console.log(`[LIVIL][STORY] AppState → ${state}`);
      if (state !== 'active') { close(`appstate-${state}`); }
    });
    return () => sub.remove();
  }, [close]);

  // ── Navigation between stories ──
  const goForward = useCallback(() => {
    // Decide OUTSIDE the updater: calling close() (a navigation dispatch) inside a
    // setIndex updater fires during render and warns "setState while rendering".
    console.log(`[LIVIL][STORY] goForward idx=${indexRef.current} items=${items.length}`);
    if (indexRef.current < items.length - 1) {
      setIndex(i => i + 1);
    } else {
      close('advance-past-last');
    }
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
        close('jump-author-past-end');
      }
    },
    [currentAuthorIndex, items, close],
  );

  // Commit a cube swipe: change author (setIndex → re-drives audio for the new
  // story via the story-keyed effect), then snap the rotation to 0 so the now-
  // front face shows the new story. Only ever calls jumpAuthor — the cube never
  // touches the playback path.
  const commitCube = useCallback(
    (dir: 1 | -1) => {
      jumpAuthor(dir);
      cubeX.value = 0;
    },
    [jumpAuthor, cubeX],
  );

  // Mirrors menuOpen for callbacks (the progress-anim finish closure). While the
  // ⋯ sheet is open an advance must NOT fire — on the last story it would CLOSE
  // the viewer under the open sheet (seen on device: tap ⋯ near clip end → sheet
  // shows for a second → story exits). A suppressed finish is remembered and
  // replayed when the sheet is dismissed (Instagram behavior).
  const menuOpenRef = useRef(false);
  const pendingAdvanceRef = useRef(false);

  // Single-fire advance, keyed by presentation id (see presentationRef).
  const requestAdvance = useCallback(
    (fromPresentation: number) => {
      console.log(`[LIVIL][STORY] requestAdvance from=${fromPresentation} current=${presentationRef.current} advancedFor=${advancedForRef.current} menuOpen=${menuOpenRef.current}`);
      if (fromPresentation !== presentationRef.current) {return;}
      if (advancedForRef.current === fromPresentation) {return;}
      if (menuOpenRef.current) {
        console.log('[LIVIL][STORY] requestAdvance SUPPRESSED (menu open) → pending');
        pendingAdvanceRef.current = true;
        return;
      }
      advancedForRef.current = fromPresentation;
      goForward();
    },
    [goForward],
  );

  const clipDuration = story ? story.clipEndSec - story.clipStartSec : 0;

  const startProgressAnim = useCallback(() => {
    stopProgress();
    progressAnim.setValue(0);
    if (clipDuration <= 0) {return;}
    const p = presentationRef.current;
    console.log(`[LIVIL][STORY] progressAnim START presentation=${p} durMs=${Math.round(clipDuration * 1000)}`);
    progressAnimRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: clipDuration * 1000,
      useNativeDriver: false,
    });
    progressAnimRef.current.start(({ finished }) => {
      console.log(`[LIVIL][STORY] progressAnim FINISH presentation=${p} finished=${finished}`);
      if (finished) {requestAdvance(p);}
    });
  }, [progressAnim, clipDuration, requestAdvance, stopProgress]);

  // ── Per-story effect: drive this story's AUDIO through the single engine ──
  // Keyed on the current story id (not the raw index) so a delete that shifts the
  // list, or a backward/author jump, always re-drives audio for whatever story is
  // now current.
  const storyId = story?.id;
  useEffect(() => {
    console.log(`[LIVIL][STORY] per-story effect storyId=${storyId ?? 'NONE'} idx=${indexRef.current} items=${items.length}`);
    if (!story) {
      close('no-story-at-index');
      return;
    }

    presentationRef.current += 1;
    progressAnim.setValue(0);
    // A finish suppressed under the sheet belongs to the PREVIOUS story — never
    // replay it onto this one.
    pendingAdvanceRef.current = false;
    setPaused(false);

    const isVideo = story.track.mediaKind === 'video' && !!story.track.videoUrl;
    // Show the poster over a video until it has seeked to the clip start (below).
    if (posterTimerRef.current) { clearTimeout(posterTimerRef.current); }
    setPosterVisible(isVideo);

    // Order mirrors PostCard's union of both play paths — see storyPlayback.ts.
    const info = storyToNowPlaying(story);
    const storyUrl = info.audioUrl ?? info.videoUrl ?? null;
    const sameSource = loadedSrcRef.current != null && loadedSrcRef.current === storyUrl;

    playback.setQueue([info], 0, 'story');
    playback.setNowPlaying(info);
    playback.markSeekTarget(story.clipStartSec);
    if (sameSource) {
      // Case A: same source already loaded → force the reposition. (For a video,
      // the picture frame won't fire onLoad, so hide the poster on a short timer.)
      playback.handlersRef.current?.seek(story.clipStartSec);
    }
    // else Case B: different/no source — setNowPlaying switches GAP's source and
    // handleLoad seeks to positionRef(=clipStart). For a DIFFERENT-source video the
    // picture frame's onLoad → handleLoaded hides the poster; a forced seek here
    // would drive the OUTGOING track and race the switch.
    playback.requestPlay(info.postId);
    loadedSrcRef.current = storyUrl;

    // Start the progress bar: AUDIO has no picture frame (no MediaPlayer/onLoad),
    // and a same-source video won't fire onLoad — start here in both cases.
    // Different-source video starts it from handleLoaded.
    if (!isVideo || sameSource) {
      startProgressAnim();
    }
    // Same-source video: no onLoad → the progress-crossing signal (or this
    // fallback) hides the poster once the forced seek has rendered.
    if (isVideo && sameSource) {
      posterTimerRef.current = setTimeout(() => setPosterVisible(false), 900);
    }

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
      if (posterTimerRef.current) {clearTimeout(posterTimerRef.current);}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  // Video picture-frame loaded (different-source video only — audio has no frame).
  // Start the bar; the poster hides on the DETERMINISTIC signal below (the frame's
  // progress crossing the clip start), with this long timer only as an anti-strand
  // fallback if progress events never arrive.
  const handleLoaded = useCallback(() => {
    startProgressAnim();
    if (posterTimerRef.current) { clearTimeout(posterTimerRef.current); }
    posterTimerRef.current = setTimeout(() => setPosterVisible(false), 900);
  }, [startProgressAnim]);

  // Deterministic poster hide: the muted frame reports ~0 while a fresh load is
  // still at the file start and only crosses clipStart once its seek has actually
  // landed — exactly the moment the 0:00 frame can no longer flash. Used ONLY for
  // the poster; never for advance (ADR-0013 — the JS timer is the advance clock).
  const handleFrameProgress = useCallback((pos: number) => {
    if (!story) { return; }
    if (pos >= story.clipStartSec - 0.75) {
      setPosterVisible(false);
    }
  }, [story]);

  // NOTE: there is deliberately NO clip-end-by-position clock here. Under the clip
  // session (ADR-0013) the JS progress timer (startProgressAnim) is the SOLE advance
  // authority. The former `pos >= clipEnd` backstop read the muted picture frame's
  // position, which reports stale values from the previous story before its seek
  // settles — a second clock that fired early and cut clips short. The native
  // watcher is disarmed at the source, so no native clip-end fires either.

  // Pause / resume the progress bar when the story pauses/plays.
  useEffect(() => {
    if (!didMountPausedRef.current) {
      didMountPausedRef.current = true;
      return; // mount run: story already started by the per-story effect
    }
    console.log(`[LIVIL][STORY] paused effect → ${paused}`);
    if (paused) {
      playback.handlersRef.current?.pause();
      stopProgress();
    } else {
      playback.handlersRef.current?.play();
      const p = presentationRef.current;
      // Stop FIRST (kills any orphan), and take the frozen value from the stop
      // callback rather than the private `_value`, so the remaining duration is
      // measured off the bar's true position.
      stopProgress(currentValue => {
        const remaining = clipDuration * (1 - currentValue) * 1000;
        console.log(`[LIVIL][STORY] resume at ${currentValue.toFixed(2)} → remainingMs=${Math.round(remaining)}`);
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
      });
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

  // A gentle continuous glow pulse on the "open the song's post" bar — it draws
  // the eye to the CTA (and replaces the removed visualizer as the live element).
  const songGlow = useSharedValue(1);
  useEffect(() => {
    songGlow.value = withRepeat(
      withTiming(0.5, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [songGlow]);
  const songGlowStyle = useAnimatedStyle(() => ({ opacity: songGlow.value }));

  // ── Go to the song's post: deep-link to the original upload via its author's
  //    profile (the app has no standalone post screen). ──
  const openSong = useCallback(async () => {
    console.log('[LIVIL][STORY] openSong → resolving post author, then goBack + navigate');
    if (!story) {return;}
    const authorId = await getStoryPostAuthorId(story.originalPostId);
    if (!authorId) {
      showToast("Couldn't open the song's post.", { kind: 'error' });
      return;
    }
    navigation.goBack();
    setTimeout(
      () =>
        navigation.navigate('UserProfile', {
          userId: authorId,
          focusPostId: story.originalPostId,
          // The story's original post is always an upload → open the Uploads tab
          // so focusPostId is found there and scrolls into view.
          focusPostKind: 'upload',
        }),
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
    // The sheet/confirm flow is over — release the advance suppression so the
    // NEXT story's clock isn't wrongly gated, and drop any stale pending finish.
    menuOpenRef.current = false;
    menuOpenSv.value = false;
    pendingAdvanceRef.current = false;
    // If this was the only story left, close; otherwise clamp the index and let
    // the story-keyed effect re-drive whatever is now current.
    if (items.length <= 1) {
      removeLocal(id);
      close('deleted-last-story');
      return;
    }
    if (index >= items.length - 1) {
      setIndex(i => Math.max(0, i - 1));
    }
    removeLocal(id);
  }, [story, items.length, index, removeLocal, close, showToast, menuOpenSv]);

  // ⋯ options sheet (Instagram pattern): opening pauses the story and zooms the
  // whole UI out; tapping the zoomed-out story (the shade) resumes full screen.
  const openMenu = useCallback(() => {
    // Stop the advance clock SYNCHRONOUSLY. setPaused(true) stops it too, but only
    // in the [paused] effect a beat later — tapping ⋯ near the clip's end let the
    // running animation FINISH in that window, advancing past the last story and
    // closing the viewer under the just-opened sheet. The menuOpenRef gate in
    // requestAdvance is the backstop; this closes the window at the source.
    console.log('[LIVIL][STORY] openMenu — stopping clock, raising menuOpenRef');
    stopProgress();
    menuOpenRef.current = true;
    menuOpenSv.value = true;
    setPaused(true);
    setMenuOpen(true);
    // Fade the chrome OUT with the zoom (same as hold-to-pause). Keeping the
    // progress pills + header floating over a shrunken, dimmed card looked wrong —
    // Instagram shows just the media behind the sheet. The bottom stack would sit
    // behind the sheet anyway.
    chromeOpacity.value = withTiming(0, { duration: 180 });
    menuProgress.value = withTiming(1, { duration: 230, easing: Easing.out(Easing.quad) });
  }, [menuProgress, menuOpenSv, stopProgress, chromeOpacity]);
  const finishCloseMenu = useCallback(() => {
    console.log(`[LIVIL][STORY] finishCloseMenu pendingAdvance=${pendingAdvanceRef.current}`);
    menuOpenRef.current = false;
    menuOpenSv.value = false;
    setMenuOpen(false);
    setPaused(false);
    // A clip that finished while the sheet was open advances now that the sheet is
    // dismissed (on the last story this closes the viewer — expected, the clip is
    // over). Otherwise the [paused] effect resumes the remaining clock as usual.
    if (pendingAdvanceRef.current) {
      pendingAdvanceRef.current = false;
      goForward();
    }
  }, [goForward, menuOpenSv]);
  const closeMenu = useCallback(() => {
    // Bring the chrome back as the card zooms in (mirror of openMenu).
    chromeOpacity.value = withTiming(1, { duration: 200 });
    menuProgress.value = withTiming(0, { duration: 190, easing: Easing.in(Easing.quad) }, finished => {
      if (finished) { runOnJS(finishCloseMenu)(); }
    });
  }, [menuProgress, finishCloseMenu, chromeOpacity]);

  const openAuthorProfile = useCallback(() => {
    console.log('[LIVIL][STORY] openAuthorProfile → goBack + navigate');
    if (!story) { return; }
    const authorId = story.author.id;
    navigation.goBack();
    setTimeout(() => navigation.navigate('UserProfile', { userId: authorId }), 180);
  }, [story, navigation]);

  // ── Gestures ──
  // Tap: left third → previous, elsewhere → next.
  const logTapZone = useCallback((zone: string, x: number) => {
    console.log(`[LIVIL][STORY] tapGesture ${zone} x=${Math.round(x)}`);
  }, []);
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .onEnd((e, success) => {
          if (!success) {return;}
          // Sheet open: the same physical tap that hits the shade/rows must never
          // leak into the navigation zones underneath (LIV-62).
          if (menuOpenSv.value) {
            runOnJS(logTapZone)('IGNORED (menu open)', e.x);
            return;
          }
          // Chrome dead zones: RNGH doesn't yield to the RN touchables layered
          // above this surface, so taps on the header (⋯ / X / author) and the
          // bottom stack double-fire here — Instagram rule: chrome never navigates.
          if (e.y < TAP_GUARD_TOP || e.y > SCREEN_H - TAP_GUARD_BOTTOM) {
            runOnJS(logTapZone)('IGNORED (chrome band)', e.x);
            return;
          }
          if (e.x < SCREEN_W * TAP_BACK_FRACTION) {
            runOnJS(logTapZone)('LEFT→prev', e.x);
            runOnJS(goBackward)();
          } else {
            runOnJS(logTapZone)('RIGHT→next', e.x);
            runOnJS(goForward)();
          }
        }),
    [goBackward, goForward, logTapZone, menuOpenSv],
  );

  // Long-press: hold to pause + fade the chrome; release to resume. Same guards
  // as the tap: inert while the sheet is up, and holds that BEGIN on the chrome
  // bands belong to the buttons there, not to hold-to-pause.
  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(220)
        .maxDistance(20)
        .onStart(e => {
          if (menuOpenSv.value) { return; }
          if (e.y < TAP_GUARD_TOP || e.y > SCREEN_H - TAP_GUARD_BOTTOM) { return; }
          chromeOpacity.value = withTiming(0, { duration: 150 });
          runOnJS(setPaused)(true);
        })
        .onFinalize(() => {
          if (menuOpenSv.value) { return; }
          // Harmless if onStart was zone-guarded: chrome is already visible and
          // paused is already false — these are idempotent.
          chromeOpacity.value = withTiming(1, { duration: 150 });
          runOnJS(setPaused)(false);
        }),
    [chromeOpacity, menuOpenSv],
  );

  // Pan: horizontal drag drives the cube rotation between authors; downward drag
  // follows the finger and dismisses past a threshold. When there is no author in
  // the drag direction the rotation rubber-bands (¼ tracking) so it reads as a wall.
  //
  // GESTURES WIN OVER PLAYBACK: the moment the pan activates we pause the story
  // (engine + muted frame + progress clock, via the same `paused` machinery as
  // hold-to-pause). Audio playing through a drag-dismiss reads as a hang. Resume
  // only on spring-back; a committed dismiss stays paused (close() also pauses),
  // and a committed author-jump re-drives playback via the per-story effect.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(12)
        .onStart(() => {
          if (menuOpenSv.value) { return; }
          runOnJS(setPaused)(true);
        })
        .onUpdate(e => {
          // Inert under the sheet — a drag on the shade must not move/dismiss the
          // story behind it (same fall-through class as the tap, LIV-62).
          if (menuOpenSv.value) { return; }
          if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
            const goingNext = e.translationX < 0;
            const hasTarget = goingNext ? hasNext : hasPrev;
            cubeX.value = hasTarget ? e.translationX : e.translationX * 0.25;
            ty.value = 0;
            scale.value = 1;
          } else {
            ty.value = Math.max(0, e.translationY);
            cubeX.value = 0;
            const prog = Math.min(1, ty.value / 500);
            scale.value = 1 - prog * 0.12;
          }
        })
        .onEnd(e => {
          if (menuOpenSv.value) { return; }
          const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
          if (horizontal) {
            const dir: 1 | -1 = e.translationX < 0 ? 1 : -1;
            const hasTarget = dir === 1 ? hasNext : hasPrev;
            const passed =
              Math.abs(e.translationX) > AUTHOR_SWIPE_DISTANCE || Math.abs(e.velocityX) > 700;
            if (hasTarget && passed) {
              // Finish the turn, then commit the author change at edge-on (invisible).
              cubeX.value = withTiming(
                dir === 1 ? -SCREEN_W : SCREEN_W,
                { duration: 190 },
                finished => {
                  if (finished) {runOnJS(commitCube)(dir);}
                },
              );
              return;
            }
            if (!hasTarget && passed && dir === 1) {
              runOnJS(close)('swipe-past-last-author'); // stays paused
              return;
            }
            // Rubber-band back to the same story → resume.
            cubeX.value = withTiming(0, { duration: 170 });
            runOnJS(setPaused)(false);
            return;
          }
          if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
            runOnJS(close)('swipe-dismiss'); // stays paused through the animation
            return;
          }
          // Spring back from an uncommitted vertical drag → resume.
          ty.value = withSpring(0);
          scale.value = withSpring(1);
          runOnJS(setPaused)(false);
        }),
    [cubeX, ty, scale, hasNext, hasPrev, commitCube, close, menuOpenSv],
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
      {/* Adjacent cube faces — static previews (cover art + header), no MediaPlayer
          and no audio, so the cube stays a purely visual flourish. */}
      {prevAuthorItem ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.face, prevFaceStyle]} pointerEvents="none">
          <AuthorFacePreview item={prevAuthorItem} />
        </Reanimated.View>
      ) : null}
      {nextAuthorItem ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.face, nextFaceStyle]} pointerEvents="none">
          <AuthorFacePreview item={nextAuthorItem} />
        </Reanimated.View>
      ) : null}

      <Reanimated.View style={[styles.root, styles.face, styles.faceClip, currentFaceStyle]}>
        {/* Media + gesture surface */}
        <GestureDetector gesture={composedGesture}>
          <View style={styles.root}>
            {media && media.kind === 'video' ? (
              <>
                {/* VIDEO — full-screen picture frame, MUTED (audio plays through the
                    single GlobalAudioPlayer engine, ADR-0001; never a second audible
                    <Video>). */}
                <MediaPlayer
                  postId={storyViewerPostId(story.id)}
                  media={media}
                  paused={paused}
                  onTogglePaused={() => {}}
                  onLoaded={handleLoaded}
                  // Poster-only signal (never advance — ADR-0013): hides the
                  // clip-start poster when the frame's position crosses clipStart.
                  onProgress={handleFrameProgress}
                  seekTo={seekTo}
                  visible
                  pauseWhenOffScreen={false}
                  muted
                  // TextureView, not SurfaceView: the drag-dismiss / cube gestures
                  // TRANSFORM this frame, and Android SurfaceView ignores transforms
                  // (video pixels freeze in place while the chrome moves — reads as
                  // a hang). TextureView composites in the view hierarchy and follows.
                  viewType={ViewType.TEXTURE}
                  style={StyleSheet.absoluteFill}
                />
                {/* Poster over the video until it seeks to the clip start, so the
                    0:00 frame never flashes. */}
                {posterVisible ? (
                  story.track.coverArtUrl ? (
                    <Image
                      source={{ uri: story.track.coverArtUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.videoPosterDark} />
                  )
                ) : null}
              </>
            ) : (
              // AUDIO — show the cover as a centered SQUARE (proper aspect ratio),
              // over a soft blurred version of itself, NOT stretched full-screen.
              <View style={styles.audioStage}>
                {story.track.coverArtUrl ? (
                  <>
                    <Image
                      source={{ uri: story.track.coverArtUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      blurRadius={28}
                    />
                    <View style={styles.audioBgTint} />
                    <View style={styles.audioCoverWrap}>
                      <Image
                        source={{ uri: story.track.coverArtUrl }}
                        style={styles.audioCover}
                        resizeMode="cover"
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.audioFallback}>
                    <Icon name="musicNotes" size={64} color={COLORS.purpleLight} />
                  </View>
                )}
              </View>
            )}
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
                onPress={openAuthorProfile}
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
                <TouchableOpacity
                  onPress={openMenu}
                  activeOpacity={0.7}
                  style={styles.headerBtn}
                  hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
                >
                  <Icon name="overflow" size={20} color={COLORS.white} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => close('header-x')}
                  activeOpacity={0.7}
                  style={styles.headerBtn}
                  hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
                >
                  <Icon name="close" size={18} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>

          {/* Bottom stack: comment → glowing go-to-song bar */}
          <SafeAreaView style={styles.bottomArea} edges={['bottom']} pointerEvents="box-none">
            {story.comment ? (
              <Text style={styles.commentText}>{story.comment}</Text>
            ) : null}
            <View style={styles.songBarWrap}>
              {/* Pulsing purple gradient glow border (house GradientBorder). */}
              <Reanimated.View style={[StyleSheet.absoluteFill, songGlowStyle]} pointerEvents="none">
                <GradientBorder borderRadius={14} strokeWidth={1.75} />
              </Reanimated.View>
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
            </View>
          </SafeAreaView>
        </Reanimated.View>

        {/* Purple gradient glow around the zoomed-out card (house GradientBorder),
            faded in with the zoom. Last child so it sits above the media + chrome;
            non-interactive. The face's overflow:hidden doesn't shave it — the face
            has no borderWidth (padding box == border box) and GradientBorder's
            bloom is drawn INWARD by design. */}
        <Reanimated.View
          style={[StyleSheet.absoluteFill, menuBorderStyle]}
          pointerEvents="none"
        >
          <GradientBorder borderRadius={MENU_CARD_RADIUS} strokeWidth={2} />
        </Reanimated.View>
      </Reanimated.View>

      {/* ⋯ options sheet (Instagram pattern): the story is zoomed out behind a
          translucent shade — tapping it resumes full screen — and the options
          slide up from the bottom. */}
      {menuOpen ? (
        <>
          <Reanimated.View style={[styles.menuShade, menuShadeStyle]}>
            <TouchableOpacity style={styles.menuShadeTap} activeOpacity={1} onPress={closeMenu} />
          </Reanimated.View>
          <Reanimated.View style={[styles.sheet, menuSheetStyle]}>
            <SafeAreaView edges={['bottom']}>
              <View style={styles.sheetHandle} />
              <TouchableOpacity style={styles.sheetRow} activeOpacity={0.7} onPress={openSong}>
                <Icon name="musicNotes" size={20} color={COLORS.white} />
                <Text style={styles.sheetRowText}>Open the song's post</Text>
              </TouchableOpacity>
              {!isOwner ? (
                // Pointless on your OWN story — you'd be "viewing" yourself.
                <TouchableOpacity style={styles.sheetRow} activeOpacity={0.7} onPress={openAuthorProfile}>
                  <Icon name="profile" size={20} color={COLORS.white} />
                  <Text style={styles.sheetRowText}>View @{story.author.username}</Text>
                </TouchableOpacity>
              ) : null}
              {isOwner ? (
                <TouchableOpacity
                  style={styles.sheetRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    // Straight into the confirm modal (which covers the screen);
                    // stay paused — cancel resumes, delete advances/closes. Keep
                    // menuOpenRef TRUE so a stale clip-finish stays suppressed
                    // while the confirm modal is up; cancel/delete resolve it.
                    menuProgress.value = withTiming(0, { duration: 150 });
                    chromeOpacity.value = withTiming(1, { duration: 150 });
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                >
                  <Icon name="trash" size={20} color={COLORS.error} />
                  <Text style={[styles.sheetRowText, styles.sheetRowDanger]}>Delete story</Text>
                </TouchableOpacity>
              ) : null}
            </SafeAreaView>
          </Reanimated.View>
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
          menuOpenRef.current = false;
          menuOpenSv.value = false;
          chromeOpacity.value = withTiming(1, { duration: 150 });
          setPaused(false);
          // Same replay as finishCloseMenu: a clip that ended under the sheet /
          // confirm modal advances once the user is back on the story.
          if (pendingAdvanceRef.current) {
            pendingAdvanceRef.current = false;
            goForward();
          }
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
  // Cube faces hide their back so a rotated-away face doesn't show mirrored.
  face: {
    backfaceVisibility: 'hidden',
  },
  // Current face only: clips to the animated borderRadius while the options
  // sheet zooms the story out. Full-bleed content, so nothing is clipped at
  // radius 0; the inner GradientBorder is well inside bounds (safe per the
  // overflow rule — this is not a GradientBorder host).
  faceClip: {
    overflow: 'hidden',
  },
  // Audio story: centered square cover over a soft blurred background.
  audioStage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioBgTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,10,15,0.5)',
  },
  audioCoverWrap: {
    width: SCREEN_W * 0.72,
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 56,
  },
  audioCover: {
    width: '100%',
    height: '100%',
  },
  audioFallback: {
    width: SCREEN_W * 0.72,
    aspectRatio: 1,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 56,
  },
  videoPosterDark: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.bg,
  },
  previewRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.purpleDim,
  },
  previewHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 18,
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
  songBarWrap: {
    borderRadius: 14,
  },
  songBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(14,14,21,0.62)',
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
  // ⋯ options sheet
  menuShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  menuShadeTap: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 8,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  sheetRowText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetRowDanger: {
    color: COLORS.error,
  },
});
