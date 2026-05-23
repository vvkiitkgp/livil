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
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';
import { COLORS } from '../theme/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Mirrors the FloatingPlayer's tab bar heights so action buttons land below it.
const TAB_BAR_H = Platform.OS === 'ios' ? 84 : 64;
const PLAYER_BOTTOM = Math.max(SCREEN_H * 0.1, TAB_BAR_H + 10);
const FLOAT_D = 60; // FloatingPlayer circle diameter

type TabId = 'lyrics' | 'queue' | 'info';

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
    activePostId,
    queueRef,
  } = usePlayback();

  const insets = useSafeAreaInsets();

  // ─── Animation values ───────────────────────────────────────────────────────
  const slideAnim = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;

  // ─── Local state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [fsPaused, setFsPaused] = useState(true);
  const [queueSnapshot, setQueueSnapshot] = useState<NowPlayingInfo[]>([]);
  const videoRef = useRef<VideoRef>(null);
  const initialSeekDone = useRef(false);

  // ─── Open / close animation driven by context ────────────────────────────
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
      // Reset panel state when closing
      panelAnim.setValue(0);
      setActiveTab(null);
    }
  }, [isFullScreenOpen, slideAnim, panelAnim]);

  // ─── Video handoff when opening / closing for video tracks ──────────────
  useEffect(() => {
    if (!nowPlaying || nowPlaying.mediaKind !== 'video') { return; }

    if (isFullScreenOpen) {
      initialSeekDone.current = false;
      // Pause the PostCard's player before taking over
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

  // ─── Snapshot the queue when opening (FlatList needs stable array) ───────
  useEffect(() => {
    if (isFullScreenOpen) {
      setQueueSnapshot([...queueRef.current]);
    }
  }, [isFullScreenOpen, queueRef]);

  // ─── Tab panel helpers ───────────────────────────────────────────────────
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
      if (activeTab === tab) {
        closePanel();
      } else {
        openTab(tab);
      }
    },
    [activeTab, openTab, closePanel],
  );

  // ─── Swipe-down-to-close gesture ────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([8, Infinity])
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 500) {
        closeFullScreenPlayer();
      }
    });

  // ─── Video callbacks ─────────────────────────────────────────────────────
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
    (data: OnProgressData) => {
      updatePosition(data.currentTime ?? 0);
    },
    [updatePosition],
  );

  // ─── Derived layout values ───────────────────────────────────────────────
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  const HEADER_H = 52;
  // Panel slides from SCREEN_H to 0 (top = safeTop + HEADER_H)
  const panelTop = safeTop + HEADER_H;
  const panelHeight = SCREEN_H - panelTop;
  // Scroll content inside panel must avoid the floating player and action buttons
  const panelScrollPaddingBottom = PLAYER_BOTTOM + FLOAT_D + 24 + 44 + safeBottom + 16;
  // Action buttons sit between the screen edge and the floating player
  const actionButtonsBottom = safeBottom + 8;

  const containerTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const panelTranslateY = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  if (!nowPlaying) { return null; }

  const queue = queueSnapshot;

  // ─── Render queue item ───────────────────────────────────────────────────
  const renderQueueItem = ({ item }: ListRenderItemInfo<NowPlayingInfo>) => {
    const isActive = item.postId === nowPlaying.postId;
    return (
      <View style={[styles.queueItem, isActive && styles.queueItemActive]}>
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={styles.queueCover} />
        ) : (
          <View style={[styles.queueCover, styles.queueCoverFallback]} />
        )}
        <View style={styles.queueItemMeta}>
          <Text
            style={[styles.queueItemTitle, isActive && styles.queueItemTitleActive]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.queueItemArtist} numberOfLines={1}>
            {item.artistName}
          </Text>
        </View>
        {isActive && <View style={styles.queueActiveDot} />}
      </View>
    );
  };

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: containerTranslateY }] }]}
      pointerEvents={isFullScreenOpen ? 'box-none' : 'none'}
    >
      {/* ── Main content: header + media + track info ── */}
      <GestureDetector gesture={panGesture}>
        <View style={[styles.mainContent, { paddingTop: safeTop }]} pointerEvents="box-none">
          {/* Header */}
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

          {/* Media */}
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

          {/* Track info */}
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {nowPlaying.title}
            </Text>
            <Text style={styles.artistName} numberOfLines={1}>
              {nowPlaying.artistName}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* ── Content panel (slides up over album art when a tab is tapped) ── */}
      <Animated.View
        style={[
          styles.contentPanel,
          { top: panelTop, transform: [{ translateY: panelTranslateY }] },
        ]}
        pointerEvents={activeTab ? 'box-none' : 'none'}
      >
        {/* Drag handle — tap to close panel */}
        <TouchableOpacity style={styles.panelHandleArea} onPress={closePanel}>
          <View style={styles.panelHandleBar} />
        </TouchableOpacity>

        {/* In-panel tab selector */}
        <View style={styles.panelTabs}>
          {(['lyrics', 'queue', 'info'] as TabId[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.panelTab, activeTab === tab && styles.panelTabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[styles.panelTabText, activeTab === tab && styles.panelTabTextActive]}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'lyrics' && (
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPaddingBottom }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.placeholderText}>Lyrics coming soon</Text>
          </ScrollView>
        )}
        {activeTab === 'queue' && (
          <FlatList
            data={queue}
            keyExtractor={(item) => item.postId}
            renderItem={renderQueueItem}
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPaddingBottom }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.placeholderText}>Queue is empty</Text>
            }
          />
        )}
        {activeTab === 'info' && (
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={{ paddingBottom: panelScrollPaddingBottom }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.infoTitle}>{nowPlaying.title}</Text>
            <Text style={styles.infoArtist}>{nowPlaying.artistName}</Text>
            <Text style={styles.placeholderText}>
              Track information coming soon.
            </Text>
          </ScrollView>
        )}
      </Animated.View>

      {/* ── Action buttons — always visible at the bottom ── */}
      <View
        style={[styles.actionRow, { bottom: actionButtonsBottom }]}
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

  // ── Main content ──────────────────────────────────────────────────────────
  mainContent: {
    flex: 1,
  },

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
  headerSpacer: {
    width: 44,
  },

  mediaArea: {
    marginHorizontal: 24,
    marginTop: 12,
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    // Purple glow
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  albumArt: {
    flex: 1,
    width: '100%',
  },
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
  video: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },

  trackInfo: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 8,
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

  // ── Content panel ─────────────────────────────────────────────────────────
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
  panelHandleArea: {
    alignItems: 'center',
    paddingVertical: 12,
  },
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
  panelTabActive: {
    borderBottomColor: COLORS.purple,
  },
  panelTabText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  panelTabTextActive: {
    color: COLORS.purpleLight,
  },
  panelScroll: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // ── Panel content ─────────────────────────────────────────────────────────
  placeholderText: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },

  infoTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  infoArtist: {
    color: COLORS.purpleLight,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 16,
  },

  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
    borderRadius: 10,
  },
  queueItemActive: {
    backgroundColor: COLORS.purpleDim,
  },
  queueCover: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: COLORS.card,
  },
  queueCoverFallback: {
    backgroundColor: COLORS.purpleDim,
  },
  queueItemMeta: {
    flex: 1,
    minWidth: 0,
  },
  queueItemTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  queueItemTitleActive: {
    color: COLORS.purpleLight,
  },
  queueItemArtist: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  queueActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.purple,
  },

  // ── Action buttons ────────────────────────────────────────────────────────
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
  actionBtnText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  actionBtnTextActive: {
    color: COLORS.purpleLight,
  },
});
