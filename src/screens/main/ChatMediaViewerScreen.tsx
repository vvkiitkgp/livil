import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  Easing,
  runOnJS,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { RootStackParamList } from '../../navigation/types';
import Icon from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { useChatMediaLeft } from '../../components/ChatMediaBubble';
import {
  fetchChatMediaSavers,
  notifyChatMediaSaved,
  pinChatMedia,
  prefetchChatMedia,
  recordChatMediaSave,
  useLocalChatMedia,
} from '../../services/chatMedia';
import { chatMediaKit, SecureImage } from '../../native/chatMediaKit';
import { chatMediaFrom, chatMediaLeftMs, formatLeft, type ChatMedia } from '../../utils/chatMedia';
import { serverNow } from '../../utils/serverClock';
import { MIN_ZOOM, pinchZoom, zoomAround } from '../../utils/zoomMath';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ChatMediaViewer'>;

/** A drag down past this, or flicked faster than DISMISS_VELOCITY, closes the viewer. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
/** Settling back (a released swipe-down): no overshoot, no wobble. */
const SPRING = { damping: 20, stiffness: 220, overshootClamping: true };
/** A released pinch glides straight back to 100% and stops (owner: no bounce). */
const ZOOM_RESET = { duration: 180, easing: Easing.out(Easing.cubic) };
/** Opening: a spring with a touch of overshoot, like the iPhone Photos zoom. */
// ~40% quicker than the first cut (owner, 2026-11-02), same small overshoot.
const OPEN_SPRING = { damping: 22, stiffness: 320, mass: 0.8 };
/** How small the photo starts at the tap point, as a share of its full size. */
const POP_FROM = 0.08;
const CLOSE_MS = 220;
const SLIDE_MS = 260;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A photo's on-screen size at 1× ("contain" in the stage), from its stored dimensions. */
function fitIn(stage: { w: number; h: number }, media: ChatMedia | null): { w: number; h: number } {
  if (!stage.w || !stage.h) { return { w: 0, h: 0 }; }
  const aspect = media && media.w > 0 && media.h > 0 ? media.w / media.h : stage.w / stage.h;
  const w = Math.min(stage.w, stage.h * aspect);
  return { w, h: w / aspect };
}

/**
 * A disappearing photo, full screen (PROP-0011, design screen 9) — for the sender as well as the
 * recipients, for as long as it exists.
 *
 *   open/close  — the photo grows out of the point you tapped (`origin`) and shrinks back
 *                 into it on close, ✕ and swipe alike.
 *   tap         — right side or centre: the sender's next live photo slides in from the
 *                 right; left third: the previous one slides in from the left. Past the last
 *                 one, closes. Like stories.
 *   swipe down  — closes; the chat shows through as it goes.
 *   pinch       — Instagram-style: zooms around your fingers while you pinch; keep a finger
 *                 down to drag the zoomed photo; lift every finger and it springs back to 100%.
 *   save        — recipients only: adds the photo to the phone's gallery and records the save,
 *                 so the chat shows "Saved to phone by" (src/native/chatMediaKit.ts).
 *   capture     — screenshots and screen recording never get the photo: on iPhone it is drawn
 *                 in <SecureImage>, on Android the window is FLAG_SECURE while this is open.
 *
 * Shows the copy the chat already fetched, so it opens instantly and offline; one that is not
 * there yet is fetched now. A photo whose 20 minutes run out moves on to the next (or closes).
 *
 * A NAVIGATION SCREEN, not an RN <Modal>, on purpose: on Android a Modal is its own Dialog
 * window, which the screenshot block (FLAG_SECURE on the Activity, PROP-0011 step 3) would not
 * cover. Presented as a transparent modal so a swipe down reveals the chat underneath.
 */
export default function ChatMediaViewerScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<Route>();
  const items = params.messages;
  const [index, setIndex] = useState(() => clamp(params.index, 0, Math.max(0, items.length - 1)));
  const message = items[index];
  const media = message ? chatMediaFrom(message.metadata) : null;
  const uri = useLocalChatMedia(message?.id ?? '');
  const sender = message ? message.senderDisplayName || message.senderUsername || '' : '';
  const [stage, setStage] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const fitted = useMemo(() => fitIn(stage, media), [stage, media]);
  const myId = params.myId ?? '';
  const myName = params.myName ?? '';

  // Android: no screenshots or recording of the window while a photo is open.
  useEffect(() => {
    chatMediaKit.setSecure(true);
    return () => chatMediaKit.setSecure(false);
  }, []);

  // ── Save to phone ───────────────────────────────────────────────────────────
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimer.current) { clearTimeout(noticeTimer.current); } }, []);
  /** A short banner under the header. (The app's toast sits behind this modal on iPhone.) */
  const flash = useCallback((text: string, ok: boolean) => {
    if (noticeTimer.current) { clearTimeout(noticeTimer.current); }
    setNotice({ text, ok });
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);
  // Already saved by me (an earlier visit)? The button starts as done.
  useEffect(() => {
    if (!message || !myId || message.senderId === myId) { return; }
    let cancelled = false;
    void fetchChatMediaSavers([message.id]).then(found => {
      if (!cancelled && found[message.id]?.some(s => s.userId === myId)) {
        setSavedIds(prev => new Set(prev).add(message.id));
      }
    });
    return () => { cancelled = true; };
  }, [message, myId]);
  // Anyone in the chat, the sender included — from a copy that is a file.
  const canSave = !!message && !!myId
    && chatMediaKit.available && !!uri && uri.startsWith('file://');
  const isSaved = !!message && savedIds.has(message.id);
  const onSave = useCallback(async () => {
    if (!message || !uri || saving || isSaved) { return; }
    setSaving(true);
    // Android 7–9 asks for storage access first, and its dialog counts as leaving the app —
    // which deletes every copy (services/chatMedia.ts). Keep this one until the save is done.
    const release = pinChatMedia(message.id);
    const result = await chatMediaKit.saveToPhotos(uri);
    release();
    setSaving(false);
    if (result === 'saved') {
      setSavedIds(prev => new Set(prev).add(message.id));
      flash('Saved to your phone', true);
      // Someone else's photo: marked "Saved to phone by" and announced to the chat. Your own
      // is just saved (the database records only a recipient's save).
      if (message.senderId !== myId) {
        void recordChatMediaSave(message.id, myId).then(recorded => {
          if (recorded) { void notifyChatMediaSaved(message, myId, myName); }
        });
      }
    } else {
      flash(result === 'denied' ? 'Allow Livil to add photos in Settings' : "Couldn't save this photo", false);
    }
  }, [message, uri, saving, isSaved, myId, myName, flash]);

  // ── Motion state ──────────────────────────────────────────────────────────────
  // `open` 0→1 grows the photo out of the tap point (0: there, tiny; 1: in place). `shade`
  // fades the backdrop and header.
  const open = useSharedValue(0);
  const shade = useSharedValue(0);
  const originDX = useSharedValue(0);
  const originDY = useSharedValue(0);
  // Zoom (only while fingers are down) and where the photo's centre sits.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pinchStart = useSharedValue({ scale: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  // This touch sequence included a pinch: it zooms and drags, it never closes the viewer.
  const pinched = useSharedValue(false);
  // Finger count on the last pan event — a change makes the averaged touch point jump, so
  // that one event's movement is skipped instead of applied.
  const lastPointers = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const stageW = useSharedValue(0);
  const stageH = useSharedValue(0);
  useEffect(() => {
    stageW.value = stage.w;
    stageH.value = stage.h;
  }, [stage, stageW, stageH]);

  const left = useRef(false);
  const goBackNow = useCallback(() => {
    if (left.current) { return; }
    left.current = true;
    if (navigation.canGoBack()) { navigation.goBack(); }
  }, [navigation]);

  /** Shrinks the photo back into the point it came from, then leaves. */
  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) { return; }
    closing.current = true;
    const timing = { duration: CLOSE_MS };
    shade.value = withTiming(0, timing);
    open.value = withTiming(0, timing);
    dismissY.value = withTiming(0, timing);
    tx.value = withTiming(0, timing);
    ty.value = withTiming(0, timing);
    scale.value = withTiming(1, timing);
    // A timer, not the animation's callback: an interrupted animation must still leave.
    setTimeout(goBackNow, CLOSE_MS + 20);
  }, [goBackNow, shade, open, dismissY, tx, ty, scale]);

  // Moving between photos: each photo is its own keyed view, so the outgoing one slides out
  // and the incoming one slides in as Reanimated mount/unmount animations — nothing is drawn
  // before it is placed. The direction is committed one render BEFORE the photo changes,
  // because a view's exit animation is the one it carried in its last render.
  const [dir, setDir] = useState<1 | -1>(1);
  const [navigated, setNavigated] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const goTo = useCallback((to: number, d: 1 | -1) => {
    setDir(d);
    setNavigated(true);
    setPendingIndex(to);
  }, []);
  useEffect(() => {
    if (pendingIndex === null) { return; }
    setIndex(pendingIndex);
    setPendingIndex(null);
  }, [pendingIndex]);
  const slideIn = useMemo(
    () => (dir > 0 ? SlideInRight : SlideInLeft).duration(SLIDE_MS).easing(Easing.out(Easing.cubic)),
    [dir],
  );
  const slideOut = useMemo(
    () => (dir > 0 ? SlideOutLeft : SlideOutRight).duration(SLIDE_MS).easing(Easing.out(Easing.cubic)),
    [dir],
  );

  /** Move to the nearest live photo in direction `d`; forward past the last one closes. */
  const step = useCallback((d: 1 | -1) => {
    for (let i = index + d; i >= 0 && i < items.length; i += d) {
      if (chatMediaLeftMs(items[i].createdAt, serverNow()) > 0) {
        goTo(i, d);
        return;
      }
    }
    if (d === 1) { close(); }
  }, [index, items, close, goTo]);

  // Not fetched yet (opened straight after arriving), or deleted because the app was left:
  // fetch now, or on return (nothing is fetched in the background). Nothing to show: move on.
  useEffect(() => {
    if (!message || uri) { return; }
    let cancelled = false;
    const fetchNow = () => {
      if (AppState.currentState === 'background') { return; }
      void prefetchChatMedia(message).then(found => {
        if (!cancelled && !found && AppState.currentState !== 'background') { step(1); }
      });
    };
    fetchNow();
    const sub = AppState.addEventListener('change', next => { if (next === 'active') { fetchNow(); } });
    return () => {
      cancelled = true;
      sub.remove();
    };
  // Only a change of photo, or of whether its copy is here, matters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, uri === null]);

  // Warm the next one, so the tap is instant.
  useEffect(() => {
    const next = items[index + 1];
    if (next) { void prefetchChatMedia(next); }
  }, [index, items]);

  // This photo's 20 minutes run out: on to the next, or close. One timer per photo — the screen
  // does not re-render every second for it (only the header's TimeLeft does).
  useEffect(() => {
    if (!message) { step(1); return; }
    const t = setTimeout(() => step(1), Math.max(0, chatMediaLeftMs(message.createdAt, serverNow())));
    return () => clearTimeout(t);
  }, [message, step]);

  // A new photo starts unzoomed and centred.
  useEffect(() => {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [index, scale, tx, ty]);

  // The backdrop fades in at once; the first photo grows out of the tap only once the picture
  // has actually been decoded and drawn (Image onLoad) — starting on the URI alone ran the
  // first frames of the pop while the phone was still decoding, which read as a stutter.
  // Later photos slide in instead.
  useEffect(() => {
    shade.value = withTiming(1, { duration: 140 });
  }, [shade]);
  const [drawnId, setDrawnId] = useState<string | null>(null);
  const popped = useRef(false);
  useEffect(() => {
    if (popped.current || !message || drawnId !== message.id || !fitted.w || !stage.h) { return; }
    popped.current = true;
    const origin = params.origin;
    originDX.value = origin ? origin.x - (stage.x + stage.w / 2) : 0;
    originDY.value = origin ? origin.y - (stage.y + stage.h / 2) : stage.h * 0.08;
    open.value = withSpring(1, OPEN_SPRING);
  }, [drawnId, message, fitted.w, stage, params.origin, open, originDX, originDY]);

  // The same object while the URI is the same, so a re-render never re-sends the source.
  const imageSource = useMemo(() => (uri ? { uri } : null), [uri]);

  // Safety net: a phone that never reports the picture drawn still pops, after a moment,
  // rather than leaving an invisible photo on a black screen.
  useEffect(() => {
    if (popped.current || !imageSource || !message || drawnId === message.id) { return; }
    const id = message.id;
    const t = setTimeout(() => setDrawnId(d => d ?? id), 700);
    return () => clearTimeout(t);
  }, [imageSource, message, drawnId]);

  const onTapAt = useCallback((x: number) => {
    step(x < stage.w / 3 ? -1 : 1);
  }, [step, stage.w]);

  // ── Gestures ────────────────────────────────────────────────────────────────
  const gestures = useMemo(() => {
    // Two fingers: zoom around their midpoint, and follow it if they move together.
    const pinch = Gesture.Pinch()
      .onStart(e => {
        pinched.value = true;
        dismissY.value = withSpring(0, SPRING);
        pinchStart.value = {
          scale: scale.value,
          tx: tx.value,
          ty: ty.value,
          fx: e.focalX - stageW.value / 2,
          fy: e.focalY - stageH.value / 2,
        };
      })
      .onUpdate(e => {
        const start = pinchStart.value;
        const zoom = pinchZoom(start.scale, e.scale, e.numberOfPointers);
        if (zoom === null) { return; }
        scale.value = zoom;
        tx.value = zoomAround(e.focalX - stageW.value / 2, start.fx, start.tx, start.scale, zoom);
        ty.value = zoomAround(e.focalY - stageH.value / 2, start.fy, start.ty, start.scale, zoom);
      });

    // One finger after a pinch: drags the zoomed photo. One finger, no pinch: a drag down
    // closes. Ends (every finger up): the zoom springs back to 100%.
    const pan = Gesture.Pan()
      .minDistance(8)
      .averageTouches(true)
      .onBegin(() => {
        pinched.value = false;
        lastPointers.value = 0;
      })
      .onChange(e => {
        if (e.numberOfPointers !== lastPointers.value) {
          lastPointers.value = e.numberOfPointers;
          return;
        }
        if (e.numberOfPointers !== 1) { return; } // two fingers: the pinch moves the photo
        if (pinched.value) {
          tx.value += e.changeX;
          ty.value += e.changeY;
        } else {
          dismissY.value = Math.max(0, dismissY.value + e.changeY);
        }
      })
      .onEnd(e => {
        if (pinched.value) { return; }
        if (dismissY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
          runOnJS(close)();
        } else {
          dismissY.value = withSpring(0, SPRING);
        }
      })
      .onFinalize(() => {
        if (scale.value !== MIN_ZOOM || tx.value !== 0 || ty.value !== 0) {
          scale.value = withTiming(MIN_ZOOM, ZOOM_RESET);
          tx.value = withTiming(0, ZOOM_RESET);
          ty.value = withTiming(0, ZOOM_RESET);
        }
        if (dismissY.value > 0 && dismissY.value <= DISMISS_DISTANCE) {
          dismissY.value = withSpring(0, SPRING);
        }
      });

    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((e, success) => {
        if (success && scale.value <= MIN_ZOOM + 0.01) { runOnJS(onTapAt)(e.x); }
      });

    return Gesture.Race(tap, Gesture.Simultaneous(pinch, pan));
  }, [close, onTapAt, scale, tx, ty, pinchStart, pinched, lastPointers, dismissY, stageW, stageH]);

  const photoStyle = useAnimatedStyle(() => {
    const p = open.value;
    return {
      // Hidden for the first few frames, so the start is a growing photo, not a dot.
      opacity: Math.min(1, p * 4),
      transform: [
        { translateX: tx.value + originDX.value * (1 - p) },
        { translateY: ty.value + dismissY.value + originDY.value * (1 - p) },
        { scale: scale.value * (1 - Math.min(dismissY.value, 400) / 1600) * (POP_FROM + (1 - POP_FROM) * p) },
      ],
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: shade.value * (1 - Math.min(dismissY.value / 400, 0.85)),
  }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: shade.value * (1 - Math.min(dismissY.value / 80, 1)),
  }));

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    setStage({ x, y, w: Math.floor(width), h: Math.floor(height) });
  }, []);

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} pointerEvents="none" />

      <Animated.View style={[styles.header, { paddingTop: insets.top + 8 }, chromeStyle]}>
        <View style={styles.avatar}>
          {message?.senderAvatarUrl ? (
            <Image source={{ uri: message.senderAvatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{(sender || '♪').charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>{sender}</Text>
          {message ? <TimeLeft createdAt={message.createdAt} /> : null}
        </View>
        {canSave ? (
          <Pressable
            onPress={() => { void onSave(); }}
            disabled={saving || isSaved}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Saved to phone' : 'Save to phone'}
            accessibilityState={{ disabled: saving || isSaved }}
            hitSlop={8}
            style={({ pressed }) => [styles.round, isSaved && styles.roundDone, pressed && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Icon
                name={isSaved ? 'check' : 'download'}
                size={20}
                color={isSaved ? COLORS.purpleNeon : COLORS.white}
              />
            )}
          </Pressable>
        ) : null}
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <Icon name="close" size={20} color={COLORS.white} />
        </Pressable>
      </Animated.View>

      {notice ? (
        <View
          style={[styles.notice, { top: insets.top + 64 }]}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <View style={[styles.noticeDot, notice.ok ? styles.noticeDotOk : styles.noticeDotErr]}>
            <Icon name={notice.ok ? 'check' : 'error'} size={13} color={notice.ok ? COLORS.success : COLORS.error} />
          </View>
          <Text style={styles.noticeText}>{notice.text}</Text>
        </View>
      ) : null}

      <GestureDetector gesture={gestures}>
        <View style={[styles.stage, { marginBottom: insets.bottom }]} onLayout={onStageLayout}>
          {message && imageSource && media && fitted.w > 0 ? (
            <Animated.View
              key={message.id}
              entering={navigated ? slideIn : undefined}
              exiting={navigated ? slideOut : undefined}
            >
              <Animated.View style={[{ width: fitted.w, height: fitted.h }, photoStyle]}>
                {SecureImage && uri?.startsWith('file://') ? (
                  // iPhone: drawn where screenshots and recordings cannot see it.
                  <SecureImage
                    uri={uri}
                    style={styles.photo}
                    onLoad={() => setDrawnId(message.id)}
                    accessible
                    accessibilityLabel={`Photo from ${sender}`}
                  />
                ) : (
                  <Image
                    source={imageSource}
                    style={styles.photo}
                    resizeMode="contain"
                    onLoad={() => setDrawnId(message.id)}
                    // A copy that will not decode must not leave the viewer waiting to pop.
                    onError={() => setDrawnId(message.id)}
                    accessibilityLabel={`Photo from ${sender}`}
                    accessibilityIgnoresInvertColors
                  />
                )}
              </Animated.View>
            </Animated.View>
          ) : (
            <ActivityIndicator color={COLORS.purpleNeon} />
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * "4:12 left" in the header. Its own component so the once-a-second tick re-renders this
 * line only — not the screen, and not the photo.
 */
function TimeLeft({ createdAt }: { createdAt: string }) {
  const leftMs = useChatMediaLeft(createdAt) ?? 0;
  return (
    <View style={styles.leftRow}>
      <Icon name="timer" size={13} color={COLORS.purpleLight} />
      <Text style={styles.left}>{formatLeft(leftMs)} left</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: COLORS.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 8,
    paddingBottom: 8,
    zIndex: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700' },
  headerText: { flex: 1, gap: 1 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  leftRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  left: { color: COLORS.purpleLight, fontSize: 12, fontVariant: ['tabular-nums'] },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Saved: the purple ring and check of design screen 11.
  roundDone: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.purpleNeon },
  pressed: { opacity: 0.6 },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noticeDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noticeDotOk: { backgroundColor: 'rgba(0, 200, 83, 0.15)' },
  noticeDotErr: { backgroundColor: COLORS.errorBg },
  noticeText: { color: COLORS.white, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
});
