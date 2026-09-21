import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import FirstHundredBadge from './FirstHundredBadge';
import VerifiedBadge from './VerifiedBadge';
import type { ProfileBadge } from '../services/profileBadges';

/**
 * The column of badges beside a profile avatar.
 *
 * POSITIONED ABSOLUTELY, and that is not a detail. Both profile headers are
 * centred stacks (`hero: { alignItems: 'center' }`) with the avatar, display
 * name and handle on one vertical axis. A rail laid out in a row beside the
 * avatar would centre the ROW, sliding the avatar left by half the rail's width
 * — and by a different amount depending on whether the person has any badges.
 * Out of flow, the avatar never moves and an empty rail costs nothing.
 *
 * Mount it inside the avatar's own container, which supplies the positioning
 * context. It is a SIBLING of the avatar's touchable, never a child: the avatar
 * is already pressable (it opens stories) and nested touchables swallow each
 * other's taps unpredictably on Android.
 */

type BadgeSpec = {
  title: string;
  line: string;
  label: string;
  render: (size: number) => React.ReactElement;
};

/**
 * THE REGISTRY. One entry per badge: what it looks like, and what the popup says.
 * Adding a badge — "verified", "top 10 artist" — is an entry here, a mark
 * component, and a row in `badge_kinds` server-side. Nothing else in this file
 * changes, and nothing in either profile screen does.
 *
 * The copy deliberately carries NO ordinal and no date: every holder of a badge is
 * presented identically, so nothing in the app can distinguish the 2nd from the
 * 99th. The database knows; nothing that reaches a client does.
 */
const BADGES: Record<ProfileBadge, BadgeSpec> = {
  first_100: {
    title: 'First 100',
    line: 'One of the first 100 artists on Livil.',
    label: 'First 100 badge',
    render: size => <FirstHundredBadge size={size} />,
  },
  verified: {
    title: 'Verified',
    line: 'Livil has confirmed this is who they say they are.',
    label: 'Verified badge',
    render: size => <VerifiedBadge size={size} />,
  },
};

/**
 * BADGE PRECEDENCE, highest first — First 100 outranks Verified.
 *
 * Two jobs, and they must not diverge. Here it fixes the render order so everyone holding
 * the same pair sees the same arrangement. Elsewhere — a feed card or a comment, where
 * there is room for ONE mark beside a username — the same ranking decides which one wins.
 * Both readings have to come from this array, or a profile and a feed card will disagree
 * about who someone is.
 *
 * Badges outside this list sort last in their own order, so adding one to BADGES and
 * forgetting this array degrades to "appears at the bottom" rather than "disappears".
 */
export const BADGE_PRECEDENCE: ProfileBadge[] = ['first_100', 'verified'];

/** The highest-ranked badge someone holds, for surfaces with room for exactly one. */
export function topBadge(badges: ProfileBadge[]): ProfileBadge | null {
  return BADGE_PRECEDENCE.find(b => badges.includes(b))
    ?? (badges.length > 0 ? badges[0] : null);
}

function railOrder(a: ProfileBadge, b: ProfileBadge): number {
  const ia = BADGE_PRECEDENCE.indexOf(a);
  const ib = BADGE_PRECEDENCE.indexOf(b);
  return (ia < 0 ? BADGE_PRECEDENCE.length : ia) - (ib < 0 ? BADGE_PRECEDENCE.length : ib);
}

const BADGE_SIZE = 24;
/** Gap between the avatar's right edge and the rail. */
const RAIL_GAP = 8;

export default function ProfileBadgeRail({
  badges,
  avatarSize,
  size = BADGE_SIZE,
}: {
  badges: ProfileBadge[];
  /**
   * Width of the avatar this rail hangs off, in dp. REQUIRED, and not a default:
   * the two profile screens use different avatars (116 and 88), so a constant here
   * would be silently wrong on one of them.
   *
   * This used to be `left: '100%'`, which reads better and was the only percentage
   * position offset in the whole codebase — no precedent, and it did not place the
   * rail on a device. A number resolves against nothing and cannot be mismeasured.
   */
  avatarSize: number;
  size?: number;
}) {
  const [open, setOpen] = useState<ProfileBadge | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // Computed rather than inline so the style prop is not a fresh literal each render.
  const railStyle = useMemo(
    () => [styles.rail, { left: avatarSize + RAIL_GAP }],
    [avatarSize],
  );

  if (badges.length === 0) {
    return null;
  }

  const spec = open ? BADGES[open] : null;

  return (
    <>
      <View style={railStyle} pointerEvents="box-none">
        {[...badges].sort(railOrder).map(badge => (
          <Pressable
            key={badge}
            onPress={() => setOpen(badge)}
            // A 24px mark is well under the 44px minimum touch target, so the
            // slop is what actually makes it hittable. Not decoration.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`${BADGES[badge].label}, tap for details`}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            {BADGES[badge].render(size)}
          </Pressable>
        ))}
      </View>

      <Modal
        visible={spec !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        // Android hardware / gesture back closes it too.
        onRequestClose={close}
      >
        {/*
          The backdrop is a full-screen Pressable because tap-away only works if
          something outside the card actually receives the touch — an absolutely
          positioned View inside the page would never see it. The card stops
          propagation so a tap on the card itself does not dismiss.
        */}
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.cardMark}>{spec?.render(44)}</View>
            <Text style={styles.cardTitle}>{spec?.title}</Text>
            <Text style={styles.cardLine}>{spec?.line}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  rail: {
    // Out of flow, so the avatar keeps its place on the header's centre axis
    // whether or not there are badges. `left` is supplied by the caller's avatar
    // width — see the avatarSize prop for why it is not a percentage.
    position: 'absolute',
    top: 0,
    flexDirection: 'column',
    gap: 6,
  },
  pressed: { opacity: 0.7 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    maxWidth: 320,
  },
  cardMark: { marginBottom: 14 },
  cardTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  cardLine: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
