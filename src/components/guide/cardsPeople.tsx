import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon } from '../Icon';
import { kf, useLoop } from './timeline';
import { Avatar, EqBars, Kicker, Orb, Phone, PHONE_INNER_W, PHONE_W, TapFinger, TrackTitle } from './primitives';

/**
 * Cards 10–15: people. Friends vs Stars, chat, a Jam, listening-now, the Library and
 * notifications.
 */

/* ── 10. Friends and Stars ────────────────────────────────────────────────── */
export function FriendsIllustration() {
  const t = useLoop(10000);
  // Friend button: ADD → REQUEST SENT → FRIENDS ✓
  const b1 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [16, 1], [18, 0], [100, 0]]) }));
  const b2 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [16, 0], [18, 1], [52, 1], [54, 0], [100, 0]]) }));
  const b3 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [52, 0], [54, 1], [100, 1]]) }));
  const wait = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [18, 0], [22, 1], [52, 1], [54, 0], [100, 0]]) }));
  const chipsOn = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [52, 0], [58, 1], [100, 1]]) }));
  // Star button: STAR → STARRED ✓
  const s1 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [74, 1], [76, 0], [100, 0]]) }));
  const s3 = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [74, 0], [76, 1], [100, 1]]) }));

  const chips = ['CHAT', 'JAM', 'PLAYLISTS', 'LISTENING NOW'];

  return (
    <Phone rows={0}>
      <View style={[styles.relCard, { top: 26 }]}>
        <View style={styles.relTop}>
          <Avatar letter="R" size={30} />
          <Text style={styles.relName}>riya.wav</Text>
          <Kicker size={8}>FRIEND</Kicker>
        </View>
        <View style={styles.relBtn}>
          <Reanimated.View style={[styles.relBtnFace, styles.btnPrimary, b1]}>
            <Text style={styles.btnPrimaryText}>ADD AS FRIEND</Text>
          </Reanimated.View>
          <Reanimated.View style={[styles.relBtnFace, styles.btnMuted, b2]}>
            <Text style={styles.btnMutedText}>REQUEST SENT · WAITING</Text>
          </Reanimated.View>
          <Reanimated.View style={[styles.relBtnFace, styles.btnOk, b3]}>
            <Text style={styles.btnOkText}>FRIENDS ✓</Text>
          </Reanimated.View>
        </View>
        <View>
          <View style={styles.chips}>
            {chips.map(c => <Text key={c} style={[styles.chip, styles.chipOff]}>{c}</Text>)}
          </View>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.chips, chipsOn]}>
            {chips.map(c => <Text key={c} style={[styles.chip, styles.chipOn]}>{c}</Text>)}
          </Reanimated.View>
        </View>
        <Reanimated.Text style={[styles.wait, wait]}>riya has to say yes</Reanimated.Text>
      </View>
      <TapFinger t={t} at={12} left={PHONE_INNER_W / 2 - 10} top={92} />

      <View style={[styles.relCard, { top: 186 }]}>
        <View style={styles.relTop}>
          <Avatar letter="N" size={30} ring={COLORS.border} />
          <Text style={styles.relName}>
            noor.sings<Text style={styles.relSub}> · artist</Text>
          </Text>
          <Kicker size={8}>STAR</Kicker>
        </View>
        <View style={styles.relBtn}>
          <Reanimated.View style={[styles.relBtnFace, styles.btnPrimary, s1]}>
            <Icon name="star" size={12} color={COLORS.purpleNeon} />
            <Text style={styles.btnPrimaryText}>STAR</Text>
          </Reanimated.View>
          <Reanimated.View style={[styles.relBtnFace, styles.btnOk, s3]}>
            <Icon name="star" size={12} color={COLORS.success} weight="fill" />
            <Text style={styles.btnOkText}>STARRED ✓</Text>
          </Reanimated.View>
        </View>
        <View style={styles.chips}>
          <Text style={[styles.chip, styles.chipPurple]}>THEIR UPLOADS</Text>
          <Text style={[styles.chip, styles.chipPurple]}>THEIR STORIES</Text>
        </View>
      </View>
      <TapFinger t={t} at={70} left={PHONE_INNER_W / 2 - 10} top={232} />

      <Text style={styles.foot}>Uploads and reposts are for everyone.{'\n'}Playlists are for friends.</Text>
    </Phone>
  );
}

/* ── 11. Talk about it (chat) ─────────────────────────────────────────────── */
/** A message that fades in at `at` percent and the whole scene resets near the end. */
function useEnter(t: SharedValue<number>, at: number, span = 5.7) {
  return useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [at, 0], [at + span, 1], [97, 1], [98, 0], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, 10], [at, 10], [at + span, 0], [100, 0]]) }],
  }));
}

export function ChatIllustration() {
  const t = useLoop(7000);
  const m1 = useEnter(t, 5.7);
  const m2 = useEnter(t, 22.8);
  const m3 = useEnter(t, 42.8);
  const m4 = useEnter(t, 62.8);

  return (
    <Phone rows={0}>
      <View style={styles.chatHead}>
        <Avatar letter="S" size={24} />
        <Text style={styles.relName}>samdrums</Text>
      </View>
      <View style={styles.chat}>
        <Reanimated.View style={[styles.bubble, styles.them, m1]}><Text style={styles.bubbleText}>have you heard this one??</Text></Reanimated.View>
        <Reanimated.View style={[styles.songCard, m2]}>
          <View style={styles.songArt} />
          <View>
            <Text style={styles.songName}>Midnight Loop</Text>
            <Text style={styles.songBy}>riya.wav</Text>
          </View>
        </Reanimated.View>
        <Reanimated.View style={[styles.bubble, styles.me, m3]}><Text style={styles.bubbleText}>the drop 🔥🔥</Text></Reanimated.View>
        <Reanimated.View style={[styles.bubble, styles.them, m4]}><Text style={styles.bubbleText}>right?? jam later?</Text></Reanimated.View>
      </View>
      <View style={styles.composer}><Text style={styles.composerText}>Message…</Text></View>
    </Phone>
  );
}

/* ── 12. Listen together (Jam) ────────────────────────────────────────────── */
export function JamIllustration() {
  const t = useLoop(8000);
  const prog = useAnimatedStyle(() => ({ width: `${kf(t.value, [[0, 20], [100, 80]])}%` }));
  const m1 = useEnter(t, 6.25, 5);
  const m2 = useEnter(t, 20, 5);
  const m3 = useEnter(t, 37.5, 5);
  const m4 = useEnter(t, 57.5, 5);
  const m5 = useEnter(t, 75, 5);

  return (
    <Phone rows={0}>
      <View style={styles.jamHead}>
        <View style={styles.jamArt} />
        <View style={{ gap: 3 }}>
          <TrackTitle size={13}>Midnight Loop</TrackTitle>
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE · HOST SAM</Text>
          </View>
        </View>
      </View>
      <View style={styles.jamBar}><Reanimated.View style={[styles.jamBarFill, prog]} /></View>
      <View style={styles.faces}>
        <Avatar letter="S" size={22} style={styles.face} />
        <Avatar letter="R" size={22} style={styles.face} />
        <Avatar letter="YOU" size={22} you style={styles.face} />
      </View>
      <View style={[styles.chat, { top: 110, justifyContent: 'flex-start', paddingBottom: 0 }]}>
        <Reanimated.View style={[styles.bubble, styles.them, m1]}><Text style={styles.bubbleText}>this drop tho 🔥</Text></Reanimated.View>
        <Reanimated.View style={[styles.bubble, styles.me, m2]}><Text style={styles.bubbleText}>wait for the second one</Text></Reanimated.View>
        <Reanimated.View style={[styles.suggest, m3]}>
          <Kicker size={7} color={COLORS.infoLight}>YOU SUGGESTED</Kicker>
          <View style={styles.suggestRow}>
            <View style={[styles.songArt, { width: 22, height: 22, backgroundColor: COLORS.infoDeep }]} />
            <View>
              <Text style={styles.songName}>Echo Chamber</Text>
              <Text style={styles.songBy}>noor.sings</Text>
            </View>
          </View>
        </Reanimated.View>
        <Reanimated.View style={[styles.hostPill, m4]}>
          <Icon name="play" size={10} color={COLORS.purpleNeon} weight="fill" />
          <Text style={styles.hostPillText}>HOST: PLAY NEXT</Text>
        </Reanimated.View>
        <Reanimated.View style={[styles.bubble, styles.them, m5]}><Text style={styles.bubbleText}>good call 👌</Text></Reanimated.View>
      </View>
      <View style={styles.composer}><Text style={styles.composerText}>Message the jam…</Text></View>
    </Phone>
  );
}

/* ── 13. See what friends play ────────────────────────────────────────────── */
export function ListeningIllustration() {
  const t = useLoop(7000);
  const knob = useAnimatedStyle(() => ({
    left: kf(t.value, [[0, 16], [40, 16], [48, 2], [78, 2], [86, 16], [100, 16]]),
  }));
  const knobOn = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [40, 1], [48, 0], [78, 0], [86, 1], [100, 1]]) }));
  const toggleOn = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [40, 1], [48, 0], [78, 0], [86, 1], [100, 1]]) }));
  const mine = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [44, 1], [52, 0.25], [78, 0.25], [86, 1], [100, 1]]) }));

  const row = (letter: string, name: string, song: string | null, you = false) => (
    <View style={[styles.friendRow, you && { borderColor: COLORS.info }]}>
      <Avatar letter={letter} size={30} you={you} ring={song ? COLORS.purple : COLORS.border} />
      <Text style={[styles.relName, { flex: 1 }]}>{name}</Text>
      {song ? (
        <View style={styles.pill}>
          <EqBars bars={3} height={8} width={2} gap={2} />
          <Text style={styles.pillText}>{song}</Text>
        </View>
      ) : (
        <Text style={styles.relSub}>—</Text>
      )}
    </View>
  );

  return (
    <Phone rows={0}>
      <View style={styles.friendList}>
        {row('R', 'riya.wav', 'Midnight Loop')}
        {row('S', 'samdrums', 'Echo Chamber')}
        <Reanimated.View style={mine}>{row('YOU', 'you', 'Glass Heart', true)}</Reanimated.View>
        <View style={{ opacity: 0.5 }}>{row('N', 'noor.sings', null)}</View>
      </View>
      <View style={styles.switchCard}>
        <Icon name="musicNote" size={14} color={COLORS.purpleLight} />
        <Text style={styles.switchText}>Friends can see my song</Text>
        <View style={styles.toggle}>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.toggleOnRing, toggleOn]} />
          <Reanimated.View style={[styles.knob, knob]}>
            <View style={[StyleSheet.absoluteFill, styles.knobOff]} />
            <Reanimated.View style={[StyleSheet.absoluteFill, styles.knobOn, knobOn]} />
          </Reanimated.View>
        </View>
      </View>
      <TapFinger t={t} at={38} left={PHONE_W - 14 - 40} top={PHONE_H_INNER - 44 - 40} />
    </Phone>
  );
}
const PHONE_H_INNER = 460;

/* ── 14. Your Library ─────────────────────────────────────────────────────── */
function usePop(t: SharedValue<number>, delayPct: number) {
  return useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [delayPct, 0], [delayPct + 12, 1], [86, 1], [94, 0], [100, 0]]),
    transform: [
      { translateY: kf(t.value, [[0, 14], [delayPct, 14], [delayPct + 12, 0], [100, 0]]) },
      { scale: kf(t.value, [[0, 0.96], [delayPct, 0.96], [delayPct + 12, 1], [100, 1]]) },
    ],
  }));
}
function useSlideIn(t: SharedValue<number>, delayPct: number) {
  return useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [20 + delayPct, 0], [30 + delayPct, 1], [86, 1], [94, 0], [100, 0]]),
    transform: [{ translateX: kf(t.value, [[0, -10], [20 + delayPct, -10], [30 + delayPct, 0], [100, 0]]) }],
  }));
}

export function LibraryIllustration() {
  const t = useLoop(7000);
  const t1 = usePop(t, 0.5), t2 = usePop(t, 4.3), t3 = usePop(t, 8.6), t4 = usePop(t, 12.9);
  const r1 = useSlideIn(t, 0), r2 = useSlideIn(t, 3.6), r3 = useSlideIn(t, 7.1);

  const tile = (style: object, glyph: React.ReactNode, name: string, sub: string) => (
    <Reanimated.View style={[styles.tile, style]}>
      {glyph}
      <View>
        <Text style={styles.tileName}>{name}</Text>
        <Text style={styles.tileSub}>{sub}</Text>
      </View>
    </Reanimated.View>
  );
  const rowItem = (style: object, color: string, name: string) => (
    <Reanimated.View style={[styles.recentRow, style]}>
      <View style={[styles.recentArt, { backgroundColor: color }]} />
      <Text style={styles.songName}>{name}</Text>
    </Reanimated.View>
  );

  return (
    <Phone rows={0}>
      <View style={styles.grid}>
        {tile(t1, <Icon name="heart" size={18} color={COLORS.purpleNeon} weight="fill" />, 'LIKED', '48 songs')}
        {tile(t2, <View style={[styles.glyphSq, { backgroundColor: COLORS.purpleRoyal }]} />, 'PLAYLISTS', '3 playlists')}
        {tile(t3, <View style={[styles.glyphSq, { borderRadius: 9, backgroundColor: COLORS.infoDeep }]} />, 'ALBUMS', 'from artists')}
        {tile(t4, <Icon name="recent" size={18} color={COLORS.purpleLight} />, 'RECENT', 'played today')}
      </View>
      <View style={styles.recent}>
        <Kicker size={9}>RECENTLY PLAYED</Kicker>
        {rowItem(r1, COLORS.purpleRoyal, 'Midnight Loop')}
        {rowItem(r2, COLORS.infoDeep, 'Echo Chamber')}
        {rowItem(r3, COLORS.purpleLight, 'Glass Heart')}
      </View>
      <Orb />
    </Phone>
  );
}

/* ── 15. Don't miss a beat (notifications) ────────────────────────────────── */
function useDrop(t: SharedValue<number>, at: number) {
  return useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [at, 0], [at + 6, 1], [84, 1], [92, 0], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, -10], [at, -10], [at + 6, 0], [100, 0]]) }],
  }));
}

export function NotifyIllustration() {
  const t = useLoop(8000);
  const k1 = useDrop(t, 6.25), k2 = useDrop(t, 21.25), k3 = useDrop(t, 36.25), k4 = useDrop(t, 51.25);
  const bell = useAnimatedStyle(() => ({
    transform: [{ rotate: `${kf(t.value, [[0, 0], [66, 0], [68, 14], [70, -12], [72, 10], [74, -8], [76, 0], [100, 0]])}deg` }],
  }));

  const row = (style: object, letter: string, who: string, what: string, why: string, you = false) => (
    <Reanimated.View style={[styles.notif, style]}>
      <Avatar letter={letter} size={26} you={you} />
      <View style={{ flex: 1 }}>
        <Text style={styles.notifText}>
          <Text style={styles.notifWho}>{who}</Text> {what}
        </Text>
        <Text style={styles.notifWhy}>{why}</Text>
      </View>
    </Reanimated.View>
  );

  return (
    <Phone rows={0}>
      <View style={styles.notifList}>
        {row(k1, 'S', 'samdrums', 'sent you a message', 'chat from a friend')}
        {row(k2, 'R', 'riya.wav', 'invited you to a Jam', 'live right now — join in')}
        {row(k3, 'N', 'noor.sings', 'wants to be friends', 'friend request')}
        {row(k4, 'L', 'Livil', '· riya liked your repost', 'and 3 new comments', true)}
      </View>
      <Text style={styles.why}>Without them, you find out{'\n'}after the Jam is over.</Text>
      <View style={styles.notifCta}>
        <Reanimated.View style={[bell, { transformOrigin: 'top' }]}>
          <Icon name="bell" size={16} color={COLORS.purpleLight} />
        </Reanimated.View>
        <Text style={styles.notifCtaText}>TURN ON NOTIFICATIONS</Text>
      </View>
      <TapFinger t={t} at={66} left={PHONE_INNER_W / 2 - 6} top={PHONE_H_INNER - 16 - 40} />
    </Phone>
  );
}

const styles = StyleSheet.create({
  // Friends & Stars
  relCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    gap: 8,
  },
  relTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  relName: { fontFamily: FONTS.monoBold, fontSize: 11, color: COLORS.white, flexGrow: 1 },
  relSub: { fontFamily: FONTS.mono, fontSize: 11, color: COLORS.textSecondary },
  relBtn: { height: 24 },
  relBtnFace: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  btnPrimary: { borderWidth: 1.5, borderColor: COLORS.purple },
  btnPrimaryText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.purpleNeon },
  btnMuted: { borderWidth: 1, borderColor: COLORS.border },
  btnMutedText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.textSecondary },
  btnOk: { borderWidth: 1, borderColor: COLORS.success },
  btnOkText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.success },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    letterSpacing: 1,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  chipOff: { borderColor: COLORS.border, color: COLORS.textSecondary, opacity: 0.4 },
  chipOn: { borderColor: COLORS.success, color: COLORS.success },
  chipPurple: { borderColor: COLORS.purple, color: COLORS.purpleLight },
  wait: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -14,
    textAlign: 'center',
    fontFamily: FONTS.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: COLORS.textSecondary,
  },
  foot: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 26,
    textAlign: 'center',
    fontFamily: FONTS.mono,
    fontSize: 9,
    lineHeight: 14,
    color: COLORS.textSecondary,
  },
  // Chat / Jam
  chatHead: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B2A',
  },
  chat: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 54,
    bottom: 70,
    justifyContent: 'flex-end',
    gap: 8,
  },
  bubble: { maxWidth: 150, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 14 },
  bubbleText: { fontFamily: FONTS.mono, fontSize: 10, lineHeight: 14, color: COLORS.white },
  them: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  me: { alignSelf: 'flex-end', backgroundColor: COLORS.purple, borderBottomRightRadius: 4 },
  songCard: {
    alignSelf: 'flex-start',
    width: 150,
    padding: 8,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.purple,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  songArt: { width: 32, height: 32, borderRadius: 6, backgroundColor: COLORS.purpleRoyal },
  songName: { fontFamily: FONTS.monoBold, fontSize: 10, color: COLORS.white },
  songBy: { fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textSecondary },
  composer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  composerText: { fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textSecondary },
  jamHead: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 64,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B2A',
  },
  jamArt: { width: 40, height: 40, borderRadius: 8, backgroundColor: COLORS.purpleRoyal },
  live: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.error },
  liveText: { fontFamily: FONTS.monoBold, fontSize: 7, letterSpacing: 2, color: COLORS.error },
  jamBar: { position: 'absolute', left: 14, right: 14, top: 70, height: 3, borderRadius: 2, backgroundColor: COLORS.border, overflow: 'hidden' },
  jamBarFill: { height: 3, backgroundColor: COLORS.purpleNeon },
  faces: { position: 'absolute', right: 14, top: 80, flexDirection: 'row' },
  face: { marginLeft: -6, borderWidth: 2, borderColor: COLORS.bg },
  suggest: {
    alignSelf: 'flex-end',
    width: 160,
    padding: 8,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.info,
    gap: 6,
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hostPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.purpleNeon,
  },
  hostPillText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.purpleNeon },
  // Listening now
  friendList: { position: 'absolute', left: 12, right: 12, top: 54, gap: 8 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: '#1B1B2A',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
  },
  pillText: { fontFamily: FONTS.mono, fontSize: 8, color: COLORS.purpleLight },
  switchCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 22,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(139, 61, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchText: { fontFamily: FONTS.monoBold, fontSize: 10, color: COLORS.white, flex: 1 },
  toggle: { width: 36, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border },
  toggleOnRing: { borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.purple, margin: -1.5 },
  knob: { position: 'absolute', top: 2, width: 13, height: 13, borderRadius: 7, overflow: 'hidden' },
  knobOff: { backgroundColor: COLORS.textSecondary },
  knobOn: { backgroundColor: COLORS.purpleNeon },
  // Library
  grid: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 54,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    // Two across inside the frame's inner width (its 2dp border is NOT part of `left`/
    // `right` insets), minus the 10dp gap — 1dp short of that and both tiles wrap.
    width: Math.floor((PHONE_INNER_W - 28 - 10) / 2),
    height: 88,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    justifyContent: 'space-between',
  },
  tileName: { fontFamily: FONTS.monoBold, fontSize: 11, letterSpacing: 1, color: COLORS.white },
  tileSub: { fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textSecondary },
  glyphSq: { width: 18, height: 18, borderRadius: 4 },
  recent: { position: 'absolute', left: 14, right: 14, top: 260, gap: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentArt: { width: 28, height: 28, borderRadius: 6 },
  // Notifications
  notifList: { position: 'absolute', left: 12, right: 12, top: 22, gap: 8 },
  notif: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifText: { fontFamily: FONTS.mono, fontSize: 10, lineHeight: 13, color: COLORS.white },
  notifWho: { fontFamily: FONTS.monoBold, color: COLORS.purpleLight },
  notifWhy: { fontFamily: FONTS.mono, fontSize: 8, color: COLORS.textSecondary, marginTop: 2 },
  why: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 66,
    textAlign: 'center',
    fontFamily: FONTS.mono,
    fontSize: 9,
    lineHeight: 14,
    color: COLORS.textSecondary,
  },
  notifCta: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 18,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: COLORS.purple,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  notifCtaText: { fontFamily: FONTS.monoBold, fontSize: 10, letterSpacing: 1, color: COLORS.purpleNeon },
});
