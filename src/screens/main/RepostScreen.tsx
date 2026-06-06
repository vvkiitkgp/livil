import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from '../../components/MediaPlayer';
import ClipRangeSlider from '../../components/ClipRangeSlider';
import { usePlayback } from '../../contexts/PlaybackContext';
import { fetchPostById, fetchTrackPlaysTotal } from '../../services/posts';
import { createRepost } from '../../services/posts';
import { createStory } from '../../services/stories';
import type { FeedPost } from '../../services/posts';
import type { RootStackParamList } from '../../navigation/types';

type RepostRoute = RouteProp<RootStackParamList, 'Repost'>;
type RepostNav = NativeStackNavigationProp<RootStackParamList, 'Repost'>;

type PostMode = 'post' | 'story';

function formatCount(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {return '0:00';}
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MAX_STORY_CLIP = 10;

export default function RepostScreen() {
  const route = useRoute<RepostRoute>();
  const navigation = useNavigation<RepostNav>();
  const playback = usePlayback();
  const { originalPostId, seedClipStartSec, seedClipEndSec } = route.params;

  const playerRef = useRef<MediaPlayerHandle>(null);

  const [mode, setMode] = useState<PostMode>('post');
  const [originalPost, setOriginalPost] = useState<FeedPost | null>(null);
  const [playsTotal, setPlaysTotal] = useState(0);
  const [loadError, setLoadError] = useState('');

  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const clipStartRef = useRef(0);
  const clipEndRef = useRef(0);
  clipStartRef.current = clipStart;
  clipEndRef.current = clipEnd;

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Stop global player on mount, hide FloatingPlayer for the duration of this
  // screen, and leave the global player paused on exit. We intentionally do
  // NOT clearNowPlaying() — leaving it set means the user can resume what was
  // playing once they back out of the repost flow.
  useEffect(() => {
    playback.handlersRef.current?.pause();
    playback.pauseAll();
    playback.setRepostOpen(true);
    return () => {
      playback.setRepostOpen(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load original post + cumulative plays.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [post, plays] = await Promise.all([
          fetchPostById(originalPostId),
          fetchTrackPlaysTotal(originalPostId).catch(() => 0),
        ]);
        if (cancelled) {return;}
        if (!post) {
          setLoadError('Post not found.');
          return;
        }
        setOriginalPost(post);
        // fetchTrackPlaysTotal by track id
        const trackPlays = await fetchTrackPlaysTotal(post.track.id).catch(() => 0);
        if (!cancelled) {setPlaysTotal(trackPlays);}
      } catch (err) {
        if (!cancelled) {setLoadError(err instanceof Error ? err.message : 'Failed to load post.');}
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [originalPostId]);

  // First-time seed for the clip range. Uses the caller's current clip window
  // (post-card or full-screen player) when provided, falling back to the
  // original post's stored values. Caps to MAX_STORY_CLIP when starting in
  // story mode. Mode switches after this are handled in handleModeChange so
  // the user's edits aren't blown away.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) {return;}
    if (duration <= 0 || !originalPost) {return;}
    seededRef.current = true;
    const rawStart = seedClipStartSec ?? originalPost.clipStartSec ?? 0;
    const rawEnd = seedClipEndSec ?? originalPost.clipEndSec ?? duration;
    const seedStart = Math.max(0, Math.min(duration, rawStart));
    const seedEnd = Math.max(seedStart, Math.min(duration, rawEnd));
    let newStart: number;
    let newEnd: number;
    if (mode === 'story') {
      newStart = Math.min(seedStart, Math.max(0, duration - MAX_STORY_CLIP));
      newEnd = Math.max(newStart + 1, Math.min(newStart + MAX_STORY_CLIP, duration, seedEnd > seedStart ? seedEnd : duration));
    } else {
      newStart = seedStart;
      newEnd = seedEnd;
    }
    setClipStart(newStart);
    setClipEnd(newEnd);
  }, [duration, mode, originalPost, seedClipStartSec, seedClipEndSec]);

  const handleModeChange = useCallback((next: PostMode) => {
    if (submitting || next === mode) {return;}
    setPaused(true);
    setMode(next);
    // Seed the new mode's clip window from whatever the user currently has
    // selected, not from the original seed. Story mode caps the window at
    // MAX_STORY_CLIP — keep the current start fixed and shrink end inward;
    // if end was already inside the cap, leave it alone. Going back to post
    // mode preserves the current selection as-is.
    let newStart = clipStart;
    let newEnd = clipEnd;
    if (next === 'story' && duration > 0) {
      newEnd = Math.max(newStart + 1, Math.min(clipEnd, newStart + MAX_STORY_CLIP, duration));
    }
    if (newStart !== clipStart) { setClipStart(newStart); }
    if (newEnd !== clipEnd) { setClipEnd(newEnd); }
    // Snap playback to the (possibly unchanged) clip start so a fresh play
    // begins at the clip edge instead of resuming mid-song.
    setPosition(newStart);
    setSeekTo(newStart);
    setTimeout(() => setSeekTo(null), 0);
  }, [mode, submitting, clipStart, clipEnd, duration]);

  const handleLoaded = useCallback((dur: number) => {
    setDuration(dur);
  }, []);

  const handleProgress = useCallback((pos: number) => {
    setPosition(pos);
  }, []);

  const handleRangeChange = useCallback((s: number, e: number) => {
    setClipStart(s);
    setClipEnd(e);
  }, []);

  const handleRangeChangeEnd = useCallback((s: number, e: number, handle: 'left' | 'right') => {
    setClipStart(s);
    setClipEnd(e);
    // Only snap the playhead when the left (clip-start) handle moves — moving
    // the right handle just reshapes the clip; playback should continue from
    // wherever it currently is, matching the FullScreenPlayer's behavior.
    if (handle === 'left') {
      setSeekTo(s);
      setTimeout(() => setSeekTo(null), 0);
    }
  }, []);

  // Blue seek-dot drag — push the seeked position to the player so the
  // audio/video actually jumps. Without this the slider's seek handle
  // animates back to the playhead on release.
  const handleSeekEnd = useCallback((s: number) => {
    setPosition(s);
    setSeekTo(s);
    setTimeout(() => setSeekTo(null), 0);
  }, []);

  const handleReset = useCallback(() => {
    if (duration <= 0) {return;}
    const end = mode === 'story' ? Math.min(MAX_STORY_CLIP, duration) : duration;
    setClipStart(0);
    setClipEnd(end);
    setSeekTo(0);
    setTimeout(() => setSeekTo(null), 0);
  }, [duration, mode]);

  const handleDismissSuccess = useCallback(() => {
    setShowSuccess(false);
    navigation.goBack();
  }, [navigation]);

  const canSubmit = useMemo(() => {
    if (submitting || !originalPost) {return false;}
    if (clipEnd <= clipStart) {return false;}
    if (mode === 'story' && clipEnd - clipStart > MAX_STORY_CLIP) {return false;}
    return true;
  }, [submitting, originalPost, clipStart, clipEnd, mode]);

  const handleSubmit = useCallback(async () => {
    if (!originalPost) {return;}
    setSubmitting(true);
    setSubmitError('');
    try {
      if (mode === 'post') {
        await createRepost(originalPostId, text, clipStart, clipEnd);
      } else {
        await createStory(originalPostId, text, clipStart, clipEnd);
      }
      setShowSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }, [originalPost, mode, originalPostId, text, clipStart, clipEnd]);

  const track = originalPost?.track;
  const media: MediaShape | null = useMemo(() => {
    if (!track) {return null;}
    if (track.mediaKind === 'video' && track.videoUrl) {
      return { kind: 'video', videoUrl: track.videoUrl };
    }
    if (track.audioUrl) {
      return { kind: 'audio', audioUrl: track.audioUrl, coverUrl: track.coverArtUrl };
    }
    return null;
  }, [track]);

  const descLabel = mode === 'story' ? 'Comment' : 'Description';
  const descPlaceholder =
    mode === 'story' ? 'Add a comment to your story' : 'Share what you feel about this track';
  const submitLabel = mode === 'story' ? 'Add to story' : 'Repost';
  const successTitle = mode === 'story' ? 'Story added!' : 'Reposted!';
  const successBody =
    mode === 'story'
      ? 'Your story is live for the next 24 hours.'
      : 'Your repost is live on your profile.';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          disabled={submitting}
          style={styles.headerSide}
        >
          <Text style={[styles.headerCancel, submitting && styles.disabledText]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Repost</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          {/* Loading / error state */}
          {!originalPost && !loadError ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={COLORS.purpleLight} size="large" />
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          ) : null}

          {submitError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          {originalPost ? (
            <>
              {/* ── Mode segment ── */}
              <Text style={styles.sectionLabel}>Share as</Text>
              <View style={styles.modeSegment}>
                <TouchableOpacity
                  onPress={() => handleModeChange('post')}
                  activeOpacity={0.85}
                  disabled={submitting}
                  style={[styles.modeBtn, mode === 'post' && styles.modeBtnActive]}
                >
                  <Text style={[styles.modeBtnLabel, mode === 'post' && styles.modeBtnLabelActive]}>
                    Post
                  </Text>
                  <Text style={[styles.modeBtnSub, mode === 'post' && styles.modeBtnSubActive]}>
                    Stays on your profile
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleModeChange('story')}
                  activeOpacity={0.85}
                  disabled={submitting}
                  style={[styles.modeBtn, mode === 'story' && styles.modeBtnActive]}
                >
                  <Text style={[styles.modeBtnLabel, mode === 'story' && styles.modeBtnLabelActive]}>
                    Story (10s)
                  </Text>
                  <Text style={[styles.modeBtnSub, mode === 'story' && styles.modeBtnSubActive]}>
                    Disappears after 24h
                  </Text>
                </TouchableOpacity>
              </View>

              {/* ── Track preview ── */}
              <Text style={styles.sectionLabel}>Track</Text>
              <View style={styles.previewCard}>
                {media ? (
                  <View style={styles.mediaWrap}>
                    <MediaPlayer
                      ref={playerRef}
                      postId={`repost_preview_${originalPost.id}`}
                      media={media}
                      paused={paused}
                      onTogglePaused={() => setPaused(p => !p)}
                      onProgress={handleProgress}
                      onLoaded={handleLoaded}
                      seekTo={seekTo}
                      visible
                      pauseWhenOffScreen={false}
                    />
                    {/* Cumulative plays badge */}
                    {playsTotal > 0 ? (
                      <View style={styles.playsBadge} pointerEvents="none">
                        <Text style={styles.playsBadgeText}>▶ {formatCount(playsTotal)}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {originalPost.track.title}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() =>
                      navigation.navigate('UserProfile', { userId: originalPost.author.id })
                    }
                  >
                    <Text style={styles.trackAuthor} numberOfLines={1}>
                      @{originalPost.author.username}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Clip range ── */}
              <View style={styles.clipHeader}>
                <Text style={styles.sectionLabel}>Clip</Text>
                <TouchableOpacity onPress={handleReset} activeOpacity={0.7}>
                  <Text style={styles.resetLink}>
                    {mode === 'story' ? 'Reset (10s)' : 'Use full song'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.clipTimestamps}>
                <Text style={styles.clipTime}>{formatTime(clipStart)}</Text>
                <Text style={styles.clipTime}>{formatTime(clipEnd)}</Text>
              </View>
              <View style={styles.sliderWrap}>
                <ClipRangeSlider
                  duration={duration}
                  position={position}
                  start={clipStart}
                  end={clipEnd}
                  minClipSeconds={1}
                  maxClipSeconds={mode === 'story' ? MAX_STORY_CLIP : undefined}
                  slideWindowOnLeftDrag={mode === 'story'}
                  onChange={handleRangeChange}
                  onChangeEnd={handleRangeChangeEnd}
                  onSeekEnd={handleSeekEnd}
                />
              </View>

              {/* ── Description / Comment ── */}
              <Text style={styles.sectionLabel}>{descLabel}</Text>
              <FormInput
                value={text}
                onChangeText={setText}
                placeholder={descPlaceholder}
                multiline
                maxLength={2000}
                editable={!submitting}
                wrapperStyle={styles.textAreaWrapper}
                style={styles.textArea}
              />

              <View style={styles.scrollSpacer} />
            </>
          ) : null}
      </KeyboardAwareScrollView>

        {/* Footer submit button */}
        {originalPost ? (
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={!canSubmit}
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.submitBtnText}>{submitLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

      {/* Success modal */}
      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleDismissSuccess}
      >
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successGlow} />
            <View style={styles.successIconOuter}>
              <View style={styles.successIconInner}>
                <Text style={styles.successCheck}>✓</Text>
              </View>
            </View>
            <Text style={styles.successTitle}>{successTitle}</Text>
            <Text style={styles.successBody}>{successBody}</Text>
            <TouchableOpacity
              onPress={handleDismissSuccess}
              activeOpacity={0.85}
              style={styles.successButton}
            >
              <Text style={styles.successButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: { minWidth: 64 },
  headerCancel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  disabledText: { opacity: 0.5 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  // Mode segment
  modeSegment: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  modeBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: COLORS.card,
  },
  modeBtnActive: {
    borderColor: COLORS.purpleLight,
    backgroundColor: COLORS.purpleDim,
  },
  modeBtnLabel: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modeBtnLabelActive: { color: COLORS.purpleLight },
  modeBtnSub: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 14,
  },
  modeBtnSubActive: {
    color: COLORS.purpleLight,
    opacity: 0.85,
  },
  // Track preview
  previewCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  mediaWrap: {
    position: 'relative',
  },
  playsBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  playsBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
  trackInfo: {
    padding: 14,
    gap: 4,
  },
  trackTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  trackAuthor: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '600',
  },
  // Clip range
  clipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  resetLink: {
    color: COLORS.purpleLight,
    fontSize: 12,
    fontWeight: '600',
  },
  clipTimestamps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  clipTime: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  sliderWrap: {
    marginBottom: 24,
  },
  // Text input
  textAreaWrapper: {
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  scrollSpacer: { height: 24 },
  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  submitBtn: {
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Success modal
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5,5,12,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  successGlow: {
    position: 'absolute',
    top: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.purpleGlow,
    opacity: 0.65,
  },
  successIconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.purple,
    marginBottom: 18,
  },
  successIconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 10,
  },
  successCheck: {
    color: COLORS.white,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 32,
    marginTop: -2,
  },
  successTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  successBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  successButton: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
  successButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
