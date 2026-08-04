import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Logo } from '../Logo';
import { Barcode } from './Barcode';
import { HoloShimmer } from './HoloShimmer';
import { StripedFill } from './StripedFill';

/**
 * The laminate backstage pass — the centrepiece of pre-auth onboarding.
 *
 * `BackstagePass` is the full hanging card from step 1: lanyard, metal clip, a
 * ±2.4° sway, and a tappable 180° flip to the white "what this grants you" back.
 * `MiniPass` is the finished, role-printed version handed back on step 6.
 *
 * Flip note: this uses `backfaceVisibility: 'hidden'` on two stacked absolute
 * faces, with the back pre-rotated 180°. Android needs BOTH faces to carry a
 * perspective for the rotation to read as depth rather than a flat squash, so
 * the perspective lives on each face's transform rather than on the parent.
 */

const CARD_W = 252;
const CARD_H = 352;
const SWAY_DEG = 2.4;

/**
 * Duration of ONE half-swing. `withRepeat(..., reverse: true)` plays it out and
 * back, so the full pendulum period is twice this — the handoff's 5.5s spec
 * meant an 11s round trip, which read as static rather than hanging.
 */
const SWAY_MS = 1000;

export type PassRole = 'ARTIST' | 'FAN' | 'CREW';

/** Dot-leader rows are the pass's typographic signature — keep the widths. */
function SpecRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Text style={styles.specRow}>
      {label}
      <Text style={valueColor ? { color: valueColor } : undefined}>{value}</Text>
    </Text>
  );
}

export type BackstagePassProps = {
  flipped: boolean;
  onFlip: () => void;
  role: PassRole | null;
};

export function BackstagePass({ flipped, onFlip, role }: BackstagePassProps) {
  const sway = useSharedValue(0);
  const flip = useSharedValue(0);

  useEffect(() => {
    sway.value = withRepeat(
      withTiming(1, { duration: SWAY_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [sway]);

  useEffect(() => {
    flip.value = withTiming(flipped ? 1 : 0, {
      duration: 700,
      easing: Easing.bezier(0.2, 0.75, 0.25, 1),
    });
  }, [flip, flipped]);

  const swayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(sway.value * 2 - 1) * SWAY_DEG}deg` }],
  }));

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${flip.value * 180}deg` }],
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${flip.value * 180 + 180}deg` }],
  }));

  return (
    <Reanimated.View style={[styles.hanger, swayStyle]}>
      {/* Lanyard strap — 14px alternating bands, the CSS repeating-gradient. */}
      <View style={styles.strap}>
        {Array.from({ length: 8 }, (_, i) => (
          <View
            key={i}
            style={[styles.strapBand, i % 2 === 0 ? styles.strapRoyal : styles.strapDeep]}
          />
        ))}
      </View>

      {/* Metal clip. RN can't paint a gradient on a View, so this is an SVG. */}
      <View style={styles.clip}>
        <Svg width={34} height={16}>
          <Defs>
            <LinearGradient id="lvClip" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#D8D8D8" />
              <Stop offset="1" stopColor="#8F8F8F" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={34} height={16} rx={4} ry={4} fill="url(#lvClip)" />
        </Svg>
      </View>

      <Pressable onPress={onFlip} accessibilityRole="button" accessibilityLabel="Flip the pass">
        <View style={styles.cardBox}>
          {/* FRONT */}
          <Reanimated.View style={[styles.face, styles.front, frontStyle]}>
            <HoloShimmer width={CARD_W} height={10} durationSec={4} />

            <View style={styles.header}>
              <Logo size={120} />
              <Text style={styles.subLine}>ARTIST &amp; FAN NETWORK</Text>

              <HoloShimmer
                width={44}
                height={44}
                durationSec={3}
                borderRadius={22}
                style={styles.sticker}>
                <View style={styles.stickerInner}>
                  <Text style={styles.stickerText}>100%{'\n'}REAL</Text>
                </View>
              </HoloShimmer>
            </View>

            <View style={styles.photo}>
              <StripedFill width={CARD_W - 40} height={112} borderRadius={10} />
              <View style={styles.photoLabelWrap} pointerEvents="none">
                <Text style={styles.photoLabel}>[ your face here ]</Text>
              </View>
            </View>

            <View style={styles.specs}>
              <SpecRow label="ACCESS ..... " value="ALL AREAS" />
              <SpecRow
                label="ROLE ....... "
                value={role ?? 'PENDING...'}
                valueColor={COLORS.purpleNeon}
              />
              <SpecRow label="VALID ...... " value="FOREVER" />
            </View>

            <View style={styles.barcodeWrap}>
              <Barcode width={CARD_W - 40} height={34} />
            </View>
          </Reanimated.View>

          {/* BACK */}
          <Reanimated.View style={[styles.face, styles.back, backStyle]}>
            <Text style={styles.backHeading}>THIS PASS GRANTS ENTRY TO:</Text>
            <View style={styles.backList}>
              <Text style={styles.backItem}>→ the green room</Text>
              <Text style={styles.backItem}>→ unreleased demos</Text>
              <Text style={styles.backItem}>→ front-row fan DMs</Text>
              <Text style={styles.backItem}>→ collab call-outs</Text>
              <Text style={styles.backItem}>→ the merch table</Text>
            </View>
            <Text style={styles.backFooter}>Non-transferable. Extremely yours.</Text>
          </Reanimated.View>
        </View>
      </Pressable>
    </Reanimated.View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

const MINI_W = 216;

export function MiniPass({ role }: { role: PassRole | null }) {
  const punch = useSharedValue(0);

  useEffect(() => {
    // The hole punch pops in AFTER the card has settled — it reads as the pass
    // being finished by hand rather than as part of the print.
    punch.value = withDelay(
      600,
      withSequence(
        withTiming(1.35, { duration: 260, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 140 }),
      ),
    );
  }, [punch]);

  const punchStyle = useAnimatedStyle(() => ({
    transform: [{ scale: punch.value }],
    opacity: punch.value > 0 ? 1 : 0,
  }));

  return (
    <View style={styles.mini}>
      <Reanimated.View style={[styles.punch, punchStyle]} />

      <HoloShimmer
        width={30}
        height={30}
        durationSec={3}
        borderRadius={15}
        style={styles.miniSticker}
      />

      <Logo size={80} />
      <Text style={styles.miniSubLine}>ARTIST &amp; FAN NETWORK</Text>

      <View style={styles.miniSpecs}>
        <Text style={styles.miniRow}>
          {'ROLE ..... '}
          <Text style={styles.miniRoleValue}>{role ?? '—'}</Text>
        </Text>
        <Text style={styles.miniRow}>ACCESS ... ALL AREAS</Text>
        <Text style={styles.miniRow}>VALID .... FOREVER</Text>
      </View>

      <View style={styles.miniBarcode}>
        <Barcode width={MINI_W - 32} height={22} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hanger: {
    alignItems: 'center',
    transformOrigin: '50% 0%',
  },
  strap: {
    width: 16,
    alignItems: 'center',
  },
  strapBand: { width: 16, height: 13 },
  strapRoyal: { backgroundColor: COLORS.purpleRoyal },
  strapDeep: { backgroundColor: COLORS.purpleDeep },
  clip: {
    marginTop: -2,
    marginBottom: -4,
    zIndex: 2,
  },
  cardBox: {
    width: CARD_W,
    height: CARD_H,
  },
  face: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
    backfaceVisibility: 'hidden',
    overflow: 'hidden',
  },
  front: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  back: {
    backgroundColor: COLORS.white,
    padding: 22,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  subLine: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  sticker: {
    position: 'absolute',
    top: 16,
    right: 18,
  },
  stickerInner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerText: {
    fontFamily: FONTS.monoBold,
    fontSize: 8,
    lineHeight: 10,
    color: COLORS.bg,
    textAlign: 'center',
  },
  photo: {
    marginHorizontal: 20,
    marginTop: 18,
  },
  photoLabelWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.textMuted,
  },
  specs: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  specRow: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    lineHeight: 22,
    color: COLORS.white,
  },
  barcodeWrap: {
    marginTop: 'auto',
    marginHorizontal: 20,
    marginBottom: 16,
  },
  backHeading: {
    fontFamily: FONTS.monoBold,
    fontSize: 11,
    letterSpacing: 3,
    color: COLORS.purpleRoyal,
  },
  backList: {
    marginTop: 14,
  },
  backItem: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    lineHeight: 29,
    color: COLORS.bg,
  },
  backFooter: {
    marginTop: 'auto',
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  mini: {
    width: MINI_W,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 16,
    paddingBottom: 14,
    transform: [{ rotate: '-2deg' }],
  },
  miniSticker: {
    position: 'absolute',
    top: 10,
    right: 12,
    zIndex: 2,
  },
  punch: {
    position: 'absolute',
    top: -8,
    left: MINI_W / 2 - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0D0B12',
    zIndex: 3,
  },
  miniSubLine: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  miniSpecs: {
    marginTop: 12,
  },
  miniRow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    lineHeight: 20,
    color: COLORS.white,
  },
  miniRoleValue: {
    fontFamily: FONTS.monoBold,
    color: COLORS.info,
  },
  miniBarcode: {
    marginTop: 10,
  },
});
