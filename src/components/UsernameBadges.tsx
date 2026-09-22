import React from 'react';
import { StyleSheet, View } from 'react-native';
import FirstHundredBadge from './FirstHundredBadge';
import VerifiedBadge from './VerifiedBadge';
import { BADGE_PRECEDENCE } from './ProfileBadgeRail';
import { useBadgesFor } from '../contexts/ProfileBadgesContext';
import type { ProfileBadge } from '../services/profileBadges';

/**
 * The badges that sit beside a username, anywhere that is not a profile header.
 *
 * ALL of them, inline, in precedence order — First 100 before Verified, from the same
 * BADGE_PRECEDENCE array the profile rail sorts by. One array, so a feed card and a profile
 * can never disagree about who somebody is.
 *
 * MUST BE A SIBLING OF THE NAME, INSIDE A ROW — never nested in the <Text>. These are SVGs,
 * not glyphs; React Native will not lay one out inside a Text run, and CLAUDE.md forbids it
 * for the same reason. Put the name and this component in a flexDirection: 'row' View.
 *
 * THE NAME MUST SHRINK FIRST. Give the name `flexShrink: 1` and this keeps `flexShrink: 0`,
 * so a long display name truncates with an ellipsis and the badges stay whole. The other way
 * round produces a squashed, unreadable mark next to a name that had room to spare.
 *
 * SIZE follows the text it sits beside — 15 in a feed header, 13 in a comment. Below about
 * 12 the seal's scallops merge into the glyph and both badges read as the same grey dot;
 * prefer showing fewer badges to showing smaller ones.
 *
 * SPACING IS THE PARENT'S JOB. No outer margin here: the rows that use this already set
 * `gap` (PostCard's nameRow uses 6), and a margin would silently double it. A parent
 * without a gap should add one.
 *
 * Renders nothing at all when there are no badges, so it costs no layout on the vast
 * majority of rows.
 */

const RENDERERS: Record<ProfileBadge, (size: number) => React.ReactElement> = {
  first_100: size => <FirstHundredBadge size={size} />,
  verified: size => <VerifiedBadge size={size} />,
};

function order(a: ProfileBadge, b: ProfileBadge): number {
  const ia = BADGE_PRECEDENCE.indexOf(a);
  const ib = BADGE_PRECEDENCE.indexOf(b);
  return (ia < 0 ? BADGE_PRECEDENCE.length : ia) - (ib < 0 ? BADGE_PRECEDENCE.length : ib);
}

export default function UsernameBadges({
  userId,
  size = 15,
}: {
  userId: string | null | undefined;
  /** Match the font size of the name beside it. */
  size?: number;
}) {
  const badges = useBadgesFor(userId);
  if (badges.length === 0) { return null; }

  return (
    <View style={styles.row}>
      {[...badges].sort(order).map(badge => (
        <View key={badge} style={styles.mark}>{RENDERERS[badge](size)}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Never shrink: the NAME gives way, not the badge. See the header comment.
    flexShrink: 0,
  },
  // Two seals touching read as one object, and 3 is the least that separates them
  // without looking like a gap.
  mark: { marginRight: 3 },
});
