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
  ListRenderItemInfo,
} from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SeekBar from './SeekBar';
import { usePlayback, type NowPlayingInfo, type RepeatMode } from '../contexts/PlaybackContext';
import { COLORS } from '../theme/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TAB_BAR_H = Platform.OS === 'ios' ? 84 : 64;
const PLAYER_BOTTOM = Math.max(SCREEN_H * 0.1, TAB_BAR_H + 10);
const FLOAT_D = 60;

type TabId = 'lyrics' | 'queue' | 'info';

// ─── Seek progress sub-component (polls at 4 Hz to avoid re-rendering the whole player) ──
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
    (seconds: number) => {
      handlersRef.current?.seek(seconds);
    },
    [handlersRef],
  );

  return (
    <View style={seekStyles.wrap}>
      <View style={seekStyles.timeRow}>
        <Text style={seekStyles.time}>{formatTime(position)}</Text>
        <Text style={seekStyles.time}>{formatTime(duration)}</Text>
      </View>
      <SeekBar
        position={position}
        duration={duration}
        onSeekEnd={handleSeekEnd}
      />
    </View>
  );
}

const seekStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  time: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});

// ─── Shuffle icon ─────────────────────────────────────────────────────────────
function ShuffleIcon({ active }: { active: boolean }) {
  const color = active ? COLORS.purpleLight : COLORS.textMuted;
  return (
    <View style={iconStyles.wrap}>
      <View style={[iconStyles.arrowLine, { backgroundColor: color }]} />
      <View style={[iconStyles.arrowLine, { backgroundColor: color, marginTop: 6 }]} />
      <View style={[iconStyles.arrowHeadRight, { borderLeftColor: color, top: -2 }]} />
      <View style={[iconStyles.arrowHeadLeft, { borderRightColor: color, bottom: -2 }]} />
      {/* crossing line */}
      <View style={[iconStyles.crossLine, { backgroundColor: color }]} />
      {active && <View style={iconStyles.activeDot} />}
    </View>
  );
}

// ─── Repeat icon ─────────────────────────────────────────────────────────────
function RepeatIcon({ mode }: { mode: RepeatMode }) {
  const active = mode !== 'off';
  const color = active ? COLORS.purpleLight : COLORS.textMuted;
  return (
    <View style={iconStyles.repeatWrap}>
      <Text style={[iconStyles.repeatGlyph, { color }]}>↻</Text>
      {mode === 'one' && (
        <View style={iconStyles.oneBadge}>
          <Text style={iconStyles.oneBadgeText}>1</Text>
        </View>
      )}
      {active && <View style={[iconStyles.activeDot, iconStyles.repeatDot]} />}
    </View>
  );
}

const iconStyles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  arrowLine: {
    width: 18,
    height: 2,
    borderRadius: 1,
  },
  arrowHeadRight: {
    position: 'absolute',
    right: 8,
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  arrowHeadLeft: {
    position: 'absolute',
    left: 8,
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderRightWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  crossLine: {
    position: 'absolute',
    width: 20,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '-35deg' }],
  },
  activeDot: {
    position: 'absolute',
    bottom: 6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.purple,
  },
  repeatWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatGlyph: {
    fontSize: 22,
    fontWeight: '300',
  },
  oneBadge: {
    position: 'absolute',
    top: 7,
    right: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oneBadgeText: {
    color: COLORS.white,
    fontSize: 8,
    fontWeight: '800',
    lineHeight: 10,
  },
  repeatDot: {
    bottom: 5,
  },
});

// ─── Time formatter ──────────────────────────────────────────────────────────
function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) { return '0:00'; }
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── Main component ──────────────────────────────────────────────────────────
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

  // ─── Open / close slide animation ───────────────────────────────────────
  useEffect(() => {
    if (isFullScreenOpen) {
      Animated.spring(slideAnim, {
        toValue: 1,
        bounciness: 4,
        speed: 12,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
      panelAnim.setValue(0);
      setActiveTab(null);
    }
  }, [isFullScreenOpen, slideAnim, panelAnim]);

  // ─── Video handoff for video tracks ─────────────────────────────────────
  useEffect(() => {
    if (!nowPlaying || nowPlaying.mediaKind !== 'video') { return; }
    if (isFullScreenOpen) {
      initialSeekDone.current = false;
      handlersRef.current?.pause();
      setFsPaused(false);
      registerHandlers({
        play: () => setFsPaused(false),
        pause: () => setFsPaused(true),
        seek: (s: number) => {
          positionRef.current = s;
          videoRef.current?.seek(s);
        },
        setRate: () => {},
      });
    } else {
      setFsPaused(true);
      unregisterHandlers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreenOpen]);

  // ─── Snapshot queue (current + upcoming only) when opening ──────────────
  useEffect(() => {
    if (!isFullScreenOpen) { return; }
    const all = queueRef.current;
    const currentIdx = all.findIndex(q => q.postId === nowPlaying?.postId);
    setQueueSnapshot(currentIdx >= 0 ? all.slice(currentIdx) : all);
  }, [isFullScreenOpen, queueRef, nowPlaying?.postId]);

  // ─── Panel helpers ────────────────────────────────────────────────────────
  const openTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      Animated.spring(panelAnim, {
        toValue: 1,
        bounciness: 4,
        speed: 12,
        useNativeDriver: true,
      }).start();
    },
    [panelAnim],
  );

  const closePanel = useCallback(() => {
    Animated.timing(panelAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setActiveTab(null));
  }, [panelAnim]);

  const handleTabPress = useCallback(
    (tab: TabId) => {
      if (activeTab === tab) { closePanel(); } else { openTab(tab); }
    },
    [activeTab, openTab, closePanel],
  );

  // ─── Swipe-down-to-close ─────────────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 500) {
        closeFullScreenPlayer();
      }
    });

  // ─── Video callbacks ──────────────────────────────────────────────────────
  const handleVideoLoad = useCallback(
    (data: OnLoadData) => {
      updateDuration(data.duration ?? 0);
      if (!initialSeekDone.current) {
        initialSeekDone.current = true;
        const seekPos = positionRef.current;
        if (seekPos > 0) { videoRef.current?.seek(seekPos); }
      }
    },
    [updateDuration, positionRef],
  );

  const handleVideoProgress = useCallback(
    (data: OnProgressData) => { updatePosition(data.currentTime ?? 0); },
    [updatePosition],
  );

  // ─── Layout constants ─────────────────────────────────────────────────────
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  const HEADER_H = 52;
  const panelTop = safeTop + HEADER_H;
  const panelHeight = SCREEN_H - panelTop;
  // Scroll content padding: needs room for FloatingPlayer + action buttons above it
  const panelScrollPad = PLAYER_BOTTOM + FLOAT_D + 24 + 44 + safeBottom + 16;
  // Action buttons sit between screen edge and floating player
  const actionRowBottom = safeBottom + 8;
  // Shuffle/repeat icons align vertically with FloatingPlayer (centered at PLAYER_BOTTOM + FLOAT_D/2)
  const controlRowBottom = PLAYER_BOTTOM + (FLOAT_D - 44) / 2;
  // Seek bar (with time labels) sits just above FloatingPlayer
  const seekRowBottom = PLAYER_BOTTOM + FLOAT_D + 8;
  // Main column stops above the seek bar
  const mainPaddingBottom = seekRowBottom + 64;

  const containerTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const panelTranslateY = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  if (!nowPlaying) { return null; }

  // ─── Queue item renderer ──────────────────────────────────────────────────
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
          <Text
            style={[styles.queueItemTitle, isCurrent && styles.queueItemTitleActive]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.queueItemArtist} numberOfLines={1}>
            {item.artistName}
          </Text>
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
      {/* ── Header + media + track info ── */}
      <GestureDetector gesture={panGesture}>
        <View
          style={[styles.mainContent, { paddingTop: safeTop, paddingBottom: mainPaddingBottom }]}
          pointerEvents="box-none"
        >
          <View style={[styles.header, { height: HEADER_H }]}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={closeFullScreenPlayer}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeBtnText}>⌄</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {nowPlaying.title}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.mediaArea}>
            {nowPlaying.mediaKind === 'video' && nowPlaying.videoUrl ? (
              <Video
                ref={videoRef}
                source={{ uri: nowPlaying.videoUrl }}
                style={styles.video}
                resizeMode="contain"
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
              <Image
                source={{ uri: nowPlaying.coverArtUrl }}
                style={styles.albumArt}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.albumArtFallback}>
                <View style={styles.fallbackBlobA} />
                <View style={styles.fallbackBlobB} />
              </View>
            )}
          </View>

          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>{nowPlaying.title}</Text>
            <Text style={styles.artistName} numberOfLines={1}>{nowPlaying.artistName}</Text>
          </View>
        </View>
      </GestureDetector>

      {/* ── Seek bar + time labels (above FloatingPlayer) ── */}
      <View
        style={[styles.seekRow, { bottom: seekRowBottom }]}
        pointerEvents="box-none"
      >
        <FullScreenSeekBar />
      </View>

      {/* ── Shuffle icon (left of FloatingPlayer) and Repeat icon (right) ── */}
      <View
        style={[styles.controlsRow, { bottom: controlRowBottom }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={toggleShuffle}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ShuffleIcon active={shuffleEnabled} />
        </TouchableOpacity>
        {/* Center space is where FloatingPlayer floats */}
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

      {/* ── Content panel (slides up over album art) ── */}
      <Animated.View
        style={[
          styles.contentPanel,
          { top: panelTop, transform: [{ translateY: panelTranslateY }] },
        ]}
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
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPad }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.infoTitle}>{nowPlaying.title}</Text>
            <Text style={styles.infoArtist}>{nowPlaying.artistName}</Text>
            <Text style={styles.placeholderText}>Track information coming soon.</Text>
          </ScrollView>
        )}
      </Animated.View>

      {/* ── Action buttons ── */}
      <View
        style={[styles.actionRow, { bottom: actionRowBottom }]}
        pointerEvents="box-none"
      >
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

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.bg,
  },
  mainContent: {
    flex: 1,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },
  headerTitle: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  headerSpacer: { width: 44 },

  // ── Media ──
  mediaArea: {
    marginHorizontal: 24,
    marginTop: 12,
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  albumArt: { flex: 1, width: '100%' },
  albumArtFallback: {
    flex: 1,
    backgroundColor: COLORS.card,
    overflow: 'hidden',
  },
  fallbackBlobA: {
    position: 'absolute',
    width: SCREEN_W * 0.8,
    height: SCREEN_W * 0.8,
    borderRadius: SCREEN_W * 0.4,
    backgroundColor: COLORS.purple,
    opacity: 0.4,
    top: -SCREEN_W * 0.2,
    left: -SCREEN_W * 0.1,
  },
  fallbackBlobB: {
    position: 'absolute',
    width: SCREEN_W * 0.6,
    height: SCREEN_W * 0.6,
    borderRadius: SCREEN_W * 0.3,
    backgroundColor: '#EC4899',
    opacity: 0.3,
    bottom: -SCREEN_W * 0.15,
    right: -SCREEN_W * 0.1,
  },
  video: { flex: 1, width: '100%', backgroundColor: '#000' },

  // ── Track info ──
  trackInfo: {
    paddingHorizontal: 28,
    paddingTop: 14,
    paddingBottom: 6,
  },
  trackTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  artistName: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },

  // ── Seek row ──
  seekRow: {
    position: 'absolute',
    left: 0,
    right: 0,
  },

  // ── Controls row (shuffle + center + repeat) ──
  controlsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  controlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Center area = 50% of screen width (same as FloatingPlayer container)
  controlCenter: { flex: 1 },

  // ── Content panel ──
  contentPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  panelHandleArea: { alignItems: 'center', paddingVertical: 12 },
  panelHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  panelTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 20,
    gap: 4,
  },
  panelTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  panelTabActive: { borderBottomColor: COLORS.purple },
  panelTabText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  panelTabTextActive: { color: COLORS.purpleLight },
  panelScroll: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },

  // ── Panel content ──
  placeholderText: { color: COLORS.textMuted, fontSize: 14, lineHeight: 22 },
  infoTitle: { color: COLORS.white, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  infoArtist: { color: COLORS.purpleLight, fontSize: 15, fontWeight: '600', marginBottom: 16 },

  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
    borderRadius: 10,
  },
  queueItemActive: { backgroundColor: COLORS.purpleDim },
  queueCover: { width: 44, height: 44, borderRadius: 8, backgroundColor: COLORS.card },
  queueCoverFallback: { backgroundColor: COLORS.purpleDim },
  queueItemMeta: { flex: 1, minWidth: 0 },
  queueItemTitle: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  queueItemTitleActive: { color: COLORS.purpleLight },
  queueItemArtist: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  queueActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.purple,
  },

  // ── Action buttons ──
  actionRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnActive: {
    backgroundColor: COLORS.purpleDim,
    borderColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  actionBtnTextActive: { color: COLORS.purpleLight },
});
