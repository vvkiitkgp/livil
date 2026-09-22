import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import FirstHundredBadge from './FirstHundredBadge';
import VerifiedBadge from './VerifiedBadge';
import type { ProfileBadge } from '../services/profileBadges';

/**
 * The badges on a profile header — the tappable ones, with the explainer popup.
 *
 * SITS BESIDE THE DISPLAY NAME, in a row, exactly like `UsernameBadges` does on every
 * other surface in the app. This was originally a vertical RAIL pinned beside the avatar;
 * it was moved because a mark that appears next to the name in the feed, in comments, in
 * chat and in search, and then next to the *picture* on a profile, reads as two different
 * marks. One position everywhere is the point of a badge.
 *
 * WHY THIS IS NOT JUST `UsernameBadges`. That one is inert decoration — it renders and
 * nothing more, because a feed of twenty cards should not carry twenty modals. This one is
 * the only place a badge can be TAPPED to find out what it means, so it owns the popup.
 * The artwork and the ordering are shared; only the interaction differs.
 *
 * MOUNT IT IN A ROW WITH THE NAME, and give the NAME `flexShrink: 1` while this keeps 0 —
 * a long display name must truncate rather than squash the mark. The old rail carried a
 * warning about the avatar sliding off the header's centre axis; that no longer applies
 * here, because the row this lives in is the name's row, and the name is already centred
 * by the hero. The avatar is untouched above it.
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
    // "Verified Artist", not "Verified". A bare check mark is the internet's shorthand
    // for "this is a real celebrity"; this badge means something narrower and Livil-
    // specific — somebody who makes their own music — and the name is where that gets
    // said. Livil has no identity-verification process and should not imply one.
    title: 'Verified Artist',
    line: 'Livil has confirmed this is who they say they are.',
    label: 'Verified Artist badge',
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

function badgeOrder(a: ProfileBadge, b: ProfileBadge): number {
  const ia = BADGE_PRECEDENCE.indexOf(a);
  const ib = BADGE_PRECEDENCE.indexOf(b);
  return (ia < 0 ? BADGE_PRECEDENCE.length : ia) - (ib < 0 ? BADGE_PRECEDENCE.length : ib);
}

/**
 * Sized to the display name it sits beside, not to the avatar. 20 matches the smaller of
 * the two profile headers; the larger one passes 22.
 */
const BADGE_SIZE = 20;

export default function ProfileBadges({
  badges,
  size = BADGE_SIZE,
}: {
  badges: ProfileBadge[];
  /** Match the font size of the display name beside it. */
  size?: number;
}) {
  const [open, setOpen] = useState<ProfileBadge | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const sorted = useMemo(() => [...badges].sort(badgeOrder), [badges]);

  if (badges.length === 0) {
    return null;
  }

  const spec = open ? BADGES[open] : null;

  return (
    <>
      <View style={styles.row}>
        {sorted.map(badge => (
          <Pressable
            key={badge}
            onPress={() => setOpen(badge)}
            // A 20px mark is well under the 44px minimum touch target, so the
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Two seals touching read as one object; 5 separates them without looking like a gap.
    gap: 5,
    // NEVER shrink: the display name gives way, not the badge. See the header comment.
    flexShrink: 0,
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
