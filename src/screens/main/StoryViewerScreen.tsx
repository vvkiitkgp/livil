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

import { COLORS } from '../../theme/colors';
import MediaPlayer, { type MediaShape } from '../../components/MediaPlayer';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useStories } from '../../contexts/StoriesContext';
import { markStorySeen } from '../../services/stories';
import type { RootStackParamList } from '../../navigation/types';

type StoryViewerRoute = RouteProp<RootStackParamList, 'StoryViewer'>;
type StoryViewerNav = NativeStackNavigationProp<RootStackParamList, 'StoryViewer'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  const story = orderedStories[index];

  // Pause global player on mount and hide FloatingPlayer.
  // Intentionally do NOT call clearNowPlaying() so the user can resume
  // whatever was playing after closing the story viewer.
  useEffect(() => {
    playback.handlersRef.current?.pause();
    playback.pauseAll();
    playback.setStoryViewerOpen(true);
    return () => {
      playback.setStoryViewerOpen(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const advance = useCallback(() => {
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
    setPaused(false);

    // Seek to clip start on first load.
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

  // Tap to advance.
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd(() => {
          advance();
        }),
    [advance],
  );

  const composedGesture = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
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
              postId={`story_viewer_${story.id}`}
              media={media}
              paused={paused}
              onTogglePaused={() => setPaused(p => !p)}
              onProgress={handleProgress}
              onLoaded={handleLoaded}
              seekTo={seekTo}
              visible
              pauseWhenOffScreen={false}
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
                <Text style={styles.closeBtnText}>✕</Text>
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
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  closeBtnText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
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
