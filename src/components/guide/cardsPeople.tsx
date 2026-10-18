import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon } from '../Icon';
import { kf, useLoop } from './timeline';
import { Avatar, Kicker, Phone, PHONE_INNER_W, TapFinger } from './primitives';

/**
 * The people cards: find your friends, star an artist, and the notifications your three
 * reposted songs bring back. Drawn from the approved design (guide v2, 2026-10-18).
 */

/** Two faces of one button, swapped at `at` percent of the loop and back at the end. */
function useSwap(t: SharedValue<number>, at: number) {
  const before = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 1], [at, 1], [at + 2, 0], [94, 0], [96, 1], [100, 1]]) }));
  const after = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [at, 0], [at + 2, 1], [94, 1], [96, 0], [100, 0]]) }));
  return [before, after] as const;
}

/* ── Find your friends ────────────────────────────────────────────────────── */
const ROW_TOP = 66;
const ROW_STEP = 42;
const FEED_TOP = 214;

function PersonRow({ top, letter, name, sub, children }: {
  top: number; letter: string; name: string; sub: string; children: React.ReactNode;
}) {
  return (
    <View style={[styles.person, { top }]}>
      <Avatar letter={letter} size={30} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{name}</Text>
        <Text style={styles.personSub}>{sub}</Text>
      </View>
      <View style={styles.addSlot}>{children}</View>
    </View>
  );
}

export function FindFriendsIllustration() {
  const t = useLoop(7000);
  const [addRiya, sentRiya] = useSwap(t, 22);
  const [addSam, sentSam] = useSwap(t, 64);

  return (
    <Phone rows={0}>
      <View style={styles.search}>
        <Icon name="search" size={12} color={COLORS.textSecondary} />
        <Text style={styles.searchText}>Search people</Text>
      </View>

      <PersonRow top={ROW_TOP} letter="R" name="riya.wav" sub="likes lo-fi">
        <Reanimated.View style={[styles.addFace, styles.addOn, addRiya]}>
          <Text style={styles.addOnText}>ADD</Text>
        </Reanimated.View>
        <Reanimated.View style={[styles.addFace, styles.addDone, sentRiya]}>
          <Text style={styles.addDoneText}>SENT</Text>
        </Reanimated.View>
      </PersonRow>
      <PersonRow top={ROW_TOP + ROW_STEP} letter="A" name="arjun" sub="reposts Arijit">
        <View style={[styles.addFace, styles.addOn]}>
          <Text style={styles.addOnText}>ADD</Text>
        </View>
      </PersonRow>
      <PersonRow top={ROW_TOP + ROW_STEP * 2} letter="K" name="kiran" sub="your friend">
        <View style={[styles.addFace, styles.addDone]}>
          <Text style={styles.addDoneText}>FRIENDS</Text>
        </View>
      </PersonRow>
      <TapFinger t={t} at={18} left={PHONE_INNER_W - 50} top={ROW_TOP - 2} />

      <View style={styles.feed}>
        <Kicker size={8}>IN YOUR FEED</Kicker>
        <View style={styles.feedCard}>
          <View style={styles.feedCover} />
          <View style={styles.feedChip}>
            <Reanimated.View style={[styles.chipFace, styles.addOn, addSam]}>
              <Text style={styles.addOnText}>+ ADD @SAM</Text>
            </Reanimated.View>
            <Reanimated.View style={[styles.chipFace, styles.addDone, sentSam]}>
              <Text style={styles.addDoneText}>SENT</Text>
            </Reanimated.View>
          </View>
        </View>
      </View>
      <TapFinger t={t} at={60} left={40} top={FEED_TOP + 104} />
    </Phone>
  );
}

/* ── Be a fan ─────────────────────────────────────────────────────────────── */
export function StarIllustration() {
  const t = useLoop(6000);
  const [star, starred] = useSwap(t, 40);
  const glow = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [40, 0], [44, 1], [94, 1], [96, 0], [100, 0]]) }));
  const tiles = ['#3A1A2E', '#1C2A20', '#13283A', COLORS.purpleDeep];

  return (
    <Phone rows={0}>
      <View style={styles.artist}>
        <Avatar letter="R" size={70} />
        <Text style={styles.artistName}>riya.sings</Text>
        <Text style={styles.artistSub}>independent artist · 12 songs</Text>
        <View style={styles.starSlot}>
          <Reanimated.View style={[styles.starGlow, glow]} />
          <Reanimated.View style={[styles.starFace, styles.addOn, star]}>
            <Icon name="star" size={13} color={COLORS.purpleNeon} />
            <Text style={styles.starText}>STAR</Text>
          </Reanimated.View>
          <Reanimated.View style={[styles.starFace, styles.starOn, starred]}>
            <Icon name="star" size={13} color={COLORS.purpleNeon} weight="fill" />
            <Text style={styles.starText}>STARRED · FAN</Text>
          </Reanimated.View>
        </View>
        <View style={styles.tiles}>
          {tiles.map(c => <View key={c} style={[styles.tile, { backgroundColor: c }]} />)}
        </View>
      </View>
      <TapFinger t={t} at={36} left={PHONE_INNER_W / 2 - 4} top={186} />
    </Phone>
  );
}

/* ── Don't miss a beat ────────────────────────────────────────────────────── */
function useDrop(t: SharedValue<number>, at: number) {
  return useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [at, 0], [at + 6, 1], [86, 1], [94, 0], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, -10], [at, -10], [at + 6, 0], [100, 0]]) }],
  }));
}

export function NotifyIllustration() {
  const t = useLoop(8000);
  const k1 = useDrop(t, 8), k2 = useDrop(t, 26), k3 = useDrop(t, 44);
  const bell = useAnimatedStyle(() => ({
    transform: [{ rotate: `${kf(t.value, [[0, 0], [8, 0], [10, 14], [12, -12], [14, 10], [16, -8], [18, 0], [100, 0]])}deg` }],
  }));

  const row = (style: object, letter: string, who: string, what: string, song: string) => (
    <Reanimated.View style={[styles.notif, style]}>
      <Avatar letter={letter} size={26} />
      <View style={styles.notifBody}>
        <Text style={styles.notifText}>
          <Text style={styles.notifWho}>{who}</Text> {what}
        </Text>
        <Text style={styles.notifSong}>{song}</Text>
      </View>
    </Reanimated.View>
  );

  return (
    <Phone rows={0}>
      <View style={styles.notifHead}>
        <Reanimated.View style={bell}>
          <Icon name="bell" size={14} color={COLORS.purpleLight} />
        </Reanimated.View>
        <Kicker size={8}>NOTIFICATIONS</Kicker>
      </View>
      <View style={styles.notifList}>
        {row(k1, 'R', 'riya.wav', 'liked your repost', 'Blinding Lights')}
        {row(k2, 'A', 'arjun', 'commented: "on repeat!"', 'Full Moon, Pune')}
        {row(k3, 'K', 'kiran', 'and 2 others liked', 'Night Drive')}
      </View>
    </Phone>
  );
}

const styles = StyleSheet.create({
  // Find your friends
  search: {
    position: 'absolute',
    top: 24,
    left: 14,
    right: 14,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  searchText: { fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textSecondary },
  person: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personText: { flex: 1 },
  personName: { fontFamily: FONTS.monoBold, fontSize: 10, color: COLORS.white },
  personSub: { fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textSecondary },
  addSlot: { width: 62, height: 22 },
  addFace: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOn: { borderWidth: 1, borderColor: COLORS.purpleNeon, backgroundColor: COLORS.bg },
  addOnText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.purpleNeon },
  addDone: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  addDoneText: { fontFamily: FONTS.monoBold, fontSize: 9, letterSpacing: 1, color: COLORS.textSecondary },
  feed: {
    position: 'absolute',
    top: FEED_TOP,
    left: 14,
    right: 14,
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  feedCard: { height: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: COLORS.surface },
  feedCover: { height: 140, backgroundColor: COLORS.purpleDeep },
  feedChip: { position: 'absolute', left: 8, bottom: 8, width: 92, height: 22 },
  chipFace: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Be a fan
  artist: { position: 'absolute', top: 34, left: 16, right: 16, alignItems: 'center', gap: 6 },
  artistName: { marginTop: 4, fontFamily: FONTS.monoBold, fontSize: 13, color: COLORS.white },
  artistSub: { fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textSecondary },
  starSlot: { marginTop: 10, width: 150, height: 30 },
  starGlow: {
    position: 'absolute', left: -6, right: -6, top: -6, bottom: -6,
    borderRadius: 16,
    backgroundColor: 'rgba(168, 85, 247, 0.22)',
  },
  starFace: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  starOn: { borderWidth: 1.5, borderColor: COLORS.purpleNeon, backgroundColor: COLORS.bg },
  starText: { fontFamily: FONTS.monoBold, fontSize: 10, letterSpacing: 1, color: COLORS.purpleNeon },
  tiles: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tile: { width: 88, height: 88, borderRadius: 10 },

  // Don't miss a beat
  notifHead: { position: 'absolute', top: 30, left: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifList: { position: 'absolute', top: 62, left: 12, right: 12, gap: 10 },
  notif: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifBody: { flex: 1, gap: 2 },
  notifText: { fontFamily: FONTS.mono, fontSize: 10, lineHeight: 14, color: COLORS.white },
  notifWho: { fontFamily: FONTS.monoBold },
  notifSong: { fontFamily: FONTS.monoBold, fontSize: 9, color: COLORS.purpleLight },
});
