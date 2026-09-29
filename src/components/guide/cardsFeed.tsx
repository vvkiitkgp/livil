import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon, type IconName } from '../Icon';
import { kf, useLoop } from './timeline';
import {
  Avatar, Cover, EqBars, Finger, Kicker, Orb, Phone, PHONE_INNER_W, PHONE_W, TapFinger, TrackTitle,
} from './primitives';

/**
 * Cards 5–9: the feed. A post card, its action row, the "moment" scrubber band, the
 * repost editor, the share sheet and a story.
 */

const TRACK_INSET = 16 + 12; // phone padding + post padding
const TRACK_W = PHONE_INNER_W - TRACK_INSET * 2;

/** A post card: header, cover, title, then whatever the card adds below. */
function Post({ children, top = 56, coverHeight = 84 }: { children?: React.ReactNode; top?: number; coverHeight?: number }) {
  return (
    <View style={[styles.post, { top }]}>
      <View style={styles.who}>
        <Avatar letter="R" size={24} />
        <Text style={styles.whoName}>riya.wav</Text>
      </View>
      <Cover height={coverHeight} />
      <TrackTitle>Midnight Loop</TrackTitle>
      {children}
    </View>
  );
}

/** The like / comment / repost / share row. `hot` names the highlighted action. */
function Actions({ hot, heartSlot }: { hot?: 'heart' | 'repost' | 'share'; heartSlot?: React.ReactNode }) {
  const c = (name: string) => (hot === name ? COLORS.purpleNeon : COLORS.textSecondary);
  const item = (name: IconName, count: string | null, color: string) => (
    <View style={styles.act}>
      <Icon name={name} size={16} color={color} />
      {count ? <Text style={[styles.actCount, { color }]}>{count}</Text> : null}
    </View>
  );
  return (
    <View style={styles.acts}>
      {heartSlot ?? item('heart', '12', c('heart'))}
      {item('comment', '4', c('comment'))}
      {item('repost', '2', c('repost'))}
      {item('share', null, c('share'))}
    </View>
  );
}

/** The scrubber: a grey full-song line with a bright band for the chosen moment. */
function Track({ children }: { children?: React.ReactNode }) {
  return (
    <View style={styles.track}>
      <View style={styles.trackLine} />
      {children}
    </View>
  );
}

/* ── 5. Posts play a moment ───────────────────────────────────────────────── */
export function MomentsIllustration() {
  const t = useLoop(5000);
  const bandW = TRACK_W * 0.26;
  const fill = useAnimatedStyle(() => ({
    width: kf(t.value, [[0, 0], [10, 0], [70, bandW], [88, bandW], [100, 0]]),
  }));
  return (
    <Phone rowsOpacity={0.4}>
      <View style={[styles.post, styles.postHot, { top: 60 }]}>
        <View style={styles.who}>
          <Avatar letter="R" size={26} />
          <Text style={styles.whoName}>riya.wav</Text>
        </View>
        <Cover height={110} />
        <View style={styles.titleRow}>
          <TrackTitle size={15}>Midnight Loop</TrackTitle>
          <EqBars height={14} width={3} gap={3} />
        </View>
        <Track>
          <View style={[styles.band, styles.bandTheirs, { left: TRACK_W * 0.36, width: bandW }]}>
            <Reanimated.View style={[styles.bandFill, fill]} />
          </View>
        </Track>
        <View style={styles.times}>
          <Text style={styles.time}>0:00</Text>
          <Kicker color={COLORS.purpleLight}>THEIR PICK</Kicker>
          <Text style={styles.time}>3:41</Text>
        </View>
      </View>
      <Orb />
    </Phone>
  );
}

/* ── 6. Like what you hear ────────────────────────────────────────────────── */
export function LikeIllustration() {
  const t = useLoop(5000);
  const outline = useAnimatedStyle(() => ({ opacity: kf(t.value, [[24, 1], [26, 0], [88, 0], [92, 1]]) }));
  const filled = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[24, 0], [26, 1], [88, 1], [92, 0]]),
    transform: [{ scale: kf(t.value, [[24, 1], [26, 1.5], [34, 1]]) }],
  }));
  const n12 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[24, 1], [26, 0], [88, 0], [92, 1]]) }));
  const n13 = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[24, 0], [30, 1], [88, 1], [92, 0]]),
    transform: [{ translateY: kf(t.value, [[24, 6], [30, 0]]) }],
  }));
  const burst = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [25, 0], [27, 0.9], [45, 0], [100, 0]]),
    transform: [{ scale: kf(t.value, [[0, 0.2], [25, 0.2], [45, 2.6], [100, 2.6]]) }],
  }));

  return (
    <Phone>
      <Post coverHeight={96}>
        <Actions
          hot="heart"
          heartSlot={
            <View style={styles.act}>
              <Reanimated.View style={[styles.burst, burst]} pointerEvents="none" />
              <Reanimated.View style={[styles.iconSlot, outline]}>
                <Icon name="heart" size={16} color={COLORS.textSecondary} />
              </Reanimated.View>
              <Reanimated.View style={[styles.iconSlot, filled]}>
                <Icon name="heart" size={16} color={COLORS.purpleNeon} weight="fill" />
              </Reanimated.View>
              <View style={{ width: 16 }} />
              <Reanimated.Text style={[styles.actCount, styles.countAbs, n12]}>12</Reanimated.Text>
              <Reanimated.Text style={[styles.actCount, styles.countAbs, { color: COLORS.purpleLight }, n13]}>13</Reanimated.Text>
            </View>
          }
        />
      </Post>
      <TapFinger t={t} at={18} left={26} top={236} />
      <Orb />
    </Phone>
  );
}

/* ── 7. Repost your moment ────────────────────────────────────────────────── */
export function RepostIllustration() {
  const t = useLoop(9000);
  const bandW = TRACK_W * 0.24;

  const finger = useAnimatedStyle(() => ({
    left: PHONE_W - 66 - 40,
    top: 222,
    opacity: kf(t.value, [[0, 0], [6, 0], [12, 1], [26, 1], [32, 0], [40, 0], [46, 1], [62, 1], [68, 0], [72, 0], [78, 1], [92, 0], [100, 0]]),
    transform: [
      { translateX: kf(t.value, [[0, 14], [6, 14], [12, 0], [32, 0], [40, -64], [62, -4], [68, -4], [72, 30], [78, 30], [100, 30]]) },
      { translateY: kf(t.value, [[0, 14], [6, 14], [12, 0], [32, 0], [40, 58], [68, 58], [72, 10], [78, 10], [100, 10]]) },
      { scale: kf(t.value, [[12, 1], [16, 0.8], [20, 1], [78, 1], [82, 0.8], [86, 1]]) },
    ],
  }));
  const editor = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [26, 0], [34, 1], [96, 1], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, 8], [26, 8], [34, 0], [100, 0]]) }],
  }));
  const modePost = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [34, 0], [36, 1], [82, 1], [84, 0], [100, 0]]) }));
  const modeStory = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [82, 0], [84, 1], [100, 1]]) }));
  const mine = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [40, 0], [46, 1], [100, 1]]),
    left: TRACK_W * (kf(t.value, [[0, 14], [46, 14], [62, 58], [100, 58]]) / 100),
  }));
  const label = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [50, 0], [58, 1], [100, 1]]) }));

  return (
    <Phone>
      <Post top={44}>
        <Track>
          <View style={[styles.band, styles.bandTheirs, { left: TRACK_W * 0.14, width: bandW }]} />
        </Track>
        <Actions hot="repost" />
      </Post>
      <Reanimated.View style={[styles.editor, editor]}>
        <Kicker size={8}>YOUR MOMENT</Kicker>
        <Track>
          <View style={[styles.band, styles.bandTheirs, { left: TRACK_W * 0.14, width: bandW, opacity: 0.35 }]} />
          <Reanimated.View style={[styles.band, styles.bandMine, { width: bandW }, mine]} />
          <Reanimated.Text style={[styles.pickLabel, label]}>YOUR PICK</Reanimated.Text>
        </Track>
        <View style={styles.modes}>
          <View style={styles.mode}>
            <Reanimated.View style={[styles.modeRing, modePost]} />
            <Text style={styles.modeName}>POST</Text>
            <Text style={styles.modeSub}>Stays on your profile</Text>
          </View>
          <View style={styles.mode}>
            <Reanimated.View style={[styles.modeRing, modeStory]} />
            <Text style={styles.modeName}>STORY</Text>
            <Text style={styles.modeSub}>Disappears after 24h</Text>
          </View>
        </View>
      </Reanimated.View>
      <Finger style={finger} />
      <Orb />
    </Phone>
  );
}

/* ── 8. Share it outside ──────────────────────────────────────────────────── */
const SHEET_H = 150;

export function ShareIllustration() {
  const t = useLoop(6000);
  const sheet = useAnimatedStyle(() => ({
    transform: [{ translateY: kf(t.value, [[0, SHEET_H], [22, SHEET_H], [32, 0], [86, 0], [94, SHEET_H], [100, SHEET_H]]) }],
  }));
  const dim = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [22, 0], [32, 1], [86, 1], [94, 0], [100, 0]]) }));

  return (
    <Phone>
      <Post coverHeight={96}>
        <Actions hot="share" />
      </Post>
      <Orb />
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.dim, dim]} pointerEvents="none" />
      <TapFinger t={t} at={14} left={PHONE_W - 22 - 40} top={236} />
      <Reanimated.View style={[styles.sheet, sheet]}>
        <View style={styles.grab} />
        <View style={[styles.opt, { borderColor: COLORS.purple }]}>
          <View style={[styles.optDot, { borderColor: COLORS.purple }]}>
            <Icon name="share" size={14} color={COLORS.purpleNeon} />
          </View>
          <View>
            <Text style={styles.optName}>Share link</Text>
            <Text style={styles.optSub}>WhatsApp, Messages, anywhere</Text>
          </View>
        </View>
        <View style={styles.apps}>
          <View style={[styles.app, { backgroundColor: '#25D366' }]} />
          <View style={[styles.app, { backgroundColor: '#0A84FF' }]} />
          <View style={[styles.app, { backgroundColor: COLORS.border }]}>
            <Text style={styles.appMore}>…</Text>
          </View>
        </View>
        <View style={styles.opt}>
          <View style={styles.optDot}>
            <Icon name="externalLink" size={14} color={COLORS.textSecondary} />
          </View>
          <View>
            <Text style={styles.optName}>Send the card</Text>
            <Text style={styles.optSub}>The artwork as an image</Text>
          </View>
        </View>
      </Reanimated.View>
    </Phone>
  );
}

/* ── 9. Stories ───────────────────────────────────────────────────────────── */
export function StoriesIllustration() {
  const t = useLoop(8000);
  const story = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [24, 0], [32, 1], [90, 1], [96, 0], [100, 0]]),
    transform: [{ scale: kf(t.value, [[0, 0.6], [24, 0.6], [32, 1], [100, 1]]) }],
    borderRadius: kf(t.value, [[0, 60], [24, 60], [32, 0], [100, 0]]),
  }));
  const pa = useAnimatedStyle(() => ({ width: `${kf(t.value, [[0, 0], [32, 0], [58, 100], [100, 100]])}%` }));
  const pb = useAnimatedStyle(() => ({ width: `${kf(t.value, [[0, 0], [58, 0], [88, 100], [100, 100]])}%` }));

  return (
    <Phone rows={3} rowsTop={76}>
      <View style={styles.ringsRow}>
        {['R', 'S', 'N'].map(l => (
          <View key={l} style={styles.storyRing}>
            <Avatar letter={l} size={36} ring={COLORS.bg} />
          </View>
        ))}
        <View style={[styles.storyRing, { backgroundColor: COLORS.border }]}>
          <Avatar letter="J" size={36} ring={COLORS.bg} />
        </View>
      </View>
      <TapFinger t={t} at={14} left={16} top={24} />
      <Reanimated.View style={[styles.story, story]}>
        <View style={styles.pb}>
          <View style={styles.pbTrack}><Reanimated.View style={[styles.pbFill, pa]} /></View>
          <View style={styles.pbTrack}><Reanimated.View style={[styles.pbFill, pb]} /></View>
        </View>
        <View style={[styles.who, { marginTop: 10 }]}>
          <Avatar letter="R" size={24} />
          <Text style={styles.whoName}>riya.wav</Text>
          <Text style={styles.time}>2h</Text>
        </View>
        <View style={styles.storyEq}>
          <EqBars bars={5} height={60} width={8} gap={5} />
        </View>
        <TrackTitle size={18}>Midnight Loop</TrackTitle>
        <Text style={[styles.time, { marginTop: 4 }]}>tap to skip · hold to pause</Text>
      </Reanimated.View>
      <Orb />
    </Phone>
  );
}

const styles = StyleSheet.create({
  post: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 12,
    gap: 10,
  },
  postHot: { borderWidth: 1.5, borderColor: COLORS.purple, padding: 14, gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whoName: { fontFamily: FONTS.monoBold, fontSize: 11, color: COLORS.white },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  acts: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, minWidth: 34 },
  actCount: { fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textSecondary },
  iconSlot: { position: 'absolute', left: 0, top: 2 },
  countAbs: { position: 'absolute', left: 22 },
  burst: {
    position: 'absolute',
    left: -3,
    top: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.purpleNeon,
  },
  track: { height: 16, justifyContent: 'center' },
  trackLine: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: COLORS.border },
  band: { position: 'absolute', height: 12, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  bandTheirs: { borderColor: COLORS.purple, backgroundColor: 'rgba(139, 61, 255, 0.25)' },
  bandMine: { borderColor: COLORS.info, backgroundColor: 'rgba(34, 211, 238, 0.25)' },
  bandFill: { height: '100%', backgroundColor: COLORS.purpleNeon },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textSecondary },
  pickLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -8,
    textAlign: 'center',
    fontFamily: FONTS.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: COLORS.infoLight,
  },
  editor: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 236,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.purple,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 10,
  },
  modes: { flexDirection: 'row', gap: 6 },
  mode: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  modeRing: {
    position: 'absolute',
    left: -1,
    right: -1,
    top: -1,
    bottom: -1,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: COLORS.purpleNeon,
  },
  modeName: { fontFamily: FONTS.monoBold, fontSize: 10, letterSpacing: 1, color: COLORS.white },
  modeSub: { fontFamily: FONTS.mono, fontSize: 8, color: COLORS.textSecondary },
  dim: { backgroundColor: 'rgba(10, 10, 15, 0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_H,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  grab: { width: 34, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 2 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optName: { fontFamily: FONTS.monoBold, fontSize: 11, color: COLORS.white },
  optSub: { fontFamily: FONTS.mono, fontSize: 8, color: COLORS.textSecondary },
  apps: { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingVertical: 2 },
  app: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  appMore: { fontFamily: FONTS.monoBold, fontSize: 12, color: COLORS.textSecondary },
  ringsRow: { position: 'absolute', left: 16, top: 20, flexDirection: 'row', gap: 10 },
  storyRing: { padding: 2, borderRadius: 20, backgroundColor: COLORS.purpleNeon },
  story: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: COLORS.purpleDeepest,
    padding: 14,
    transformOrigin: '36px 40px',
  },
  pb: { flexDirection: 'row', gap: 4 },
  pbTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  pbFill: { height: 3, backgroundColor: COLORS.white },
  storyEq: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
