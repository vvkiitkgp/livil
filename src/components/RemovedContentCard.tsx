import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';

type Props = {
  /** Cover art or video thumbnail. A repost removal has none — the track may be gone. */
  coverUrl?: string | null;
  title: string;
  /** The operator's own words, shown verbatim. */
  reason: string | null;
  /**
   * `upload` — your own track was blocked. It still exists and you can delete it.
   * `repost` — somebody else's track went, so your repost of it went with it. There is
   *   nothing of yours left to delete, only the notice.
   */
  kind: 'upload' | 'repost';
  /** Your caption on the removed repost, so the card names something you recognise. */
  caption?: string | null;
  busy?: boolean;
  onDelete: () => void;
};

/**
 * Shown on your own profile where a removed post used to be.
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 *
 * A takedown DELETES the posts — deliberately, because hiding them instead would mean
 * copying a visibility check into every privileged function that reads posts, including
 * the one serving anonymous share links (ADR-0017 §C). The cost is that the track simply
 * vanishes from its owner's profile, and they find out by noticing a gap. This card is
 * the repair: the owner still sees something, and it explains itself.
 *
 * ── IT IS NOT AN ACCUSATION, AND ESPECIALLY NOT FOR A REPOSTER ─────────────
 *
 * Somebody who reposted a track lost their post because of a decision about SOMEBODY
 * ELSE'S upload. They did nothing wrong, and a red error card would tell them they had.
 * Purple, the same treatment the copyright prompt uses.
 *
 * ── IT SAYS WHO CAN SEE IT, BECAUSE THAT IS THE FIRST QUESTION ─────────────
 *
 * The owner's next thought after "what happened" is "who else is looking at this". The
 * answer is nobody — `tracks_select_authenticated` makes a blocked row readable only by
 * its uploader — and saying so is cheaper than leaving them to wonder.
 */
export default function RemovedContentCard({
  coverUrl,
  title,
  reason,
  kind,
  caption,
  busy = false,
  onDelete,
}: Props) {
  const isRepost = kind === 'repost';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.art}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.artImage} />
          ) : (
            <Icon name="musicNote" size={22} color={COLORS.purpleLight} />
          )}
          {/* Over the art, so the state reads before the title does. */}
          <View style={styles.artScrim}>
            <Icon name="warningTriangle" size={18} color={COLORS.white} weight="fill" />
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>
            {isRepost ? 'Your repost was removed' : 'This upload was removed'}
          </Text>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={2}>“{caption}”</Text>
          ) : null}
        </View>
      </View>

      {reason ? <Text style={styles.reason}>{reason}</Text> : null}

      <Text style={styles.note}>
        {isRepost
          ? 'The original track is no longer on Livil, so your repost of it went too.'
          : 'Hidden from your followers and from everyone else — only you can see this. It cannot be played.'}
      </Text>

      <Button
        label={isRepost ? 'Delete this notice' : 'Delete permanently'}
        onPress={onDelete}
        // An upload delete destroys the master; a repost delete only clears a notice for
        // a post that is already gone. Weighting them the same would overstate one and
        // understate the other.
        variant={isRepost ? 'ghost' : 'destructive'}
        size="sm"
        busy={busy}
        fullWidth
        style={styles.action}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleDim,
  },
  row: { flexDirection: 'row', gap: 12 },
  art: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // The one place `overflow: hidden` is right here — the image genuinely needs
    // clipping to the rounded corner.
    overflow: 'hidden',
  },
  artImage: { width: '100%', height: '100%' },
  artScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  body: { flex: 1 },
  heading: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  caption: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  // Set apart with a rule so it reads as a quotation of somebody else's words rather
  // than as Livil's own copy.
  reason: {
    marginTop: 12,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.purple,
    color: COLORS.white,
    fontSize: 13,
    lineHeight: 19,
  },
  note: {
    marginTop: 10,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  action: { marginTop: 12 },
});
