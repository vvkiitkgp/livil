import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SpotifyLogo } from './SpotifyLogo';
import { Button } from './Button';

/** Half the screen wide, art on top — a song in chat is a piece of music, not a file. */
const ART = Math.round(Dimensions.get('window').width * 0.5);

/** A REPOST shared in chat (src/utils/repostShare.ts): whose it is, and where it opens. */
export type ChatSongCardRepost = {
  /** "Riya's repost" / "Your repost" — repostLabel. */
  label: string;
  avatarUrl: string | null;
  initial: string;
  caption: string | null;
  /** Opens the repost's own page. */
  onView: () => void;
};

/**
 * THE song card in chat, for both sources (ADR-0027). A Livil song and a Spotify song are
 * drawn by this one component so they cannot drift apart: same panel, same artwork size,
 * same title / artist / source row, same two buttons. Only the source mark and the verbs
 * differ — "Play on Livil" plays in Livil, "Play on Spotify" opens Spotify.
 *
 * A REPOST (`repost`) is the same card wearing whose repost it is above the artwork, and it
 * is one link to that repost's page: the whole card opens it and "View post" is its only
 * button — playing, liking and reposting happen on the post (owner, 2026-10-19). It drops the
 * Livil mark (the owner's call); a Spotify repost keeps Spotify's, which Spotify requires
 * beside its metadata.
 *
 * Spotify's rules set the shared look, and Livil follows them too so the two match:
 * artwork corners rounded no more than 4px and nothing drawn on top of it; the card sits on
 * its own dark panel so artwork and marks read the same on the purple "sent" bubble as on
 * the dark "received" one.
 */
export default function ChatSongCard({
  source,
  title,
  artist,
  artUrl,
  loading = false,
  onPlay,
  onRepost,
  onLongPress,
  repost,
}: {
  source: 'livil' | 'spotify';
  title: string | null;
  artist: string | null;
  artUrl: string | null;
  loading?: boolean;
  /** Ignored for a repost, which opens its post instead. */
  onPlay?: () => void;
  /** Omitted → no Repost button (e.g. Spotify reposts switched off). Ignored for a repost. */
  onRepost?: () => void;
  /**
   * The chat bubble's long-press (react / reply / delete). Every button here takes it too:
   * a Pressable claims the whole touch, so without it holding the artwork or a button never
   * opened the message menu — and letting go then played the song.
   */
  onLongPress?: () => void;
  repost?: ChatSongCardRepost;
}) {
  const where = source === 'spotify' ? 'Spotify' : 'Livil';

  const artwork = artUrl ? (
    <Image source={{ uri: artUrl }} style={styles.art} />
  ) : (
    <View style={[styles.art, styles.artEmpty]}>
      {loading ? (
        <ActivityIndicator color={COLORS.purpleLight} />
      ) : (
        <Icon name="musicNote" size={32} color={COLORS.textMuted} />
      )}
    </View>
  );
  const song = (
    <>
      <Text style={styles.title} numberOfLines={2}>{title ?? ' '}</Text>
      <Text style={styles.artist} numberOfLines={1}>{artist ?? ' '}</Text>
    </>
  );

  if (repost) {
    return (
      <View style={styles.card}>
        <Pressable
          onPress={repost.onView}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={title ? `Open ${repost.label} of ${title}` : `Open ${repost.label}`}
        >
          <View style={styles.repostHeader}>
            {repost.avatarUrl ? (
              <Image source={{ uri: repost.avatarUrl }} style={styles.repostAvatar} />
            ) : (
              <View style={[styles.repostAvatar, styles.repostAvatarEmpty]}>
                <Text style={styles.repostInitial}>{repost.initial}</Text>
              </View>
            )}
            <Text style={styles.repostLabel} numberOfLines={1}>{repost.label}</Text>
            <Icon name="repost" size={14} color={COLORS.purpleLight} />
          </View>
          {repost.caption ? (
            <Text style={styles.caption} numberOfLines={2}>{repost.caption}</Text>
          ) : null}
          <View style={styles.repostArt}>{artwork}</View>
          {song}
          {source === 'spotify' ? <SpotifyLogo size="xs" withName style={styles.mark} /> : null}
        </Pressable>
        <Button
          label="View post"
          variant="primary"
          size="sm"
          fullWidth
          onPress={repost.onView}
          onLongPress={onLongPress}
          style={styles.viewPost}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPlay}
        onLongPress={onLongPress}
        disabled={!onPlay}
        accessibilityRole="button"
        accessibilityLabel={title ? `Play ${title} on ${where}` : `Play on ${where}`}
      >
        {artwork}
      </Pressable>

      {song}

      {source === 'spotify' ? (
        <SpotifyLogo size="xs" withName style={styles.mark} />
      ) : (
        <View style={styles.mark} accessible accessibilityLabel="Livil">
          <View style={styles.livilMark}>
            <Logo size={34} color={COLORS.white} />
          </View>
          <Text style={styles.markName}>Livil</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onPlay}
          onLongPress={onLongPress}
          disabled={!onPlay}
          style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Play on ${where}`}
        >
          <Icon name="play" size={12} color={COLORS.white} weight="fill" />
          <Text style={styles.actionText}>Play on {where}</Text>
        </Pressable>
        {onRepost ? (
          <Pressable
            onPress={onRepost}
            onLongPress={onLongPress}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Repost to Livil"
          >
            <Icon name="repost" size={12} color={COLORS.purpleLight} />
            <Text style={[styles.actionText, styles.actionTextRepost]}>Repost</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A repost the viewer may NOT see — its reposter keeps reposts to friends (ADR-0028) — sent to
 * them in chat. Says whose it is and that it is friends-only, and nothing else: no caption,
 * no song, no artwork (owner, 2026-10-19). The whole card opens the reposter's profile, the
 * one place the viewer can go from here. Same panel and header as a readable repost card.
 */
export function LockedRepostCard({
  label,
  note,
  avatarUrl,
  initial,
  onOpenProfile,
  onLongPress,
}: {
  /** "Riya's repost" — repostLabel. */
  label: string;
  /** "Only Riya's friends can see this repost". */
  note: string;
  avatarUrl: string | null;
  initial: string;
  onOpenProfile: () => void;
  onLongPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onOpenProfile}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${note}. Open profile`}
      >
        <View style={styles.repostHeader}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.repostAvatar} />
          ) : (
            <View style={[styles.repostAvatar, styles.repostAvatarEmpty]}>
              <Text style={styles.repostInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.repostLabel} numberOfLines={1}>{label}</Text>
          <Icon name="repost" size={14} color={COLORS.purpleLight} />
        </View>
        <View style={styles.lockedRow}>
          <View style={styles.lockedIcon}>
            <Icon name="lock" size={14} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.lockedNote}>{note}</Text>
        </View>
      </Pressable>
      <Button
        label="View profile"
        variant="primary"
        size="sm"
        fullWidth
        onPress={onOpenProfile}
        onLongPress={onLongPress}
        style={styles.viewPost}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: ART + 20,
    padding: 10,
    borderRadius: 14,
    backgroundColor: COLORS.bg,
    marginTop: 2,
  },
  art: { width: ART, height: ART, borderRadius: 4, backgroundColor: COLORS.card },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700', marginTop: 8 },
  artist: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  // The Livil pulse glyph is wide and short; centred in a 21px-tall box it sits on the
  // same baseline and height as Spotify's round icon beside its name.
  livilMark: { height: 21, justifyContent: 'center' },
  markName: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionPrimary: { borderColor: COLORS.textMuted },
  actionText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  actionTextRepost: { color: COLORS.purpleLight },
  pressed: { opacity: 0.7 },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24 },
  repostAvatar: { width: 22, height: 22, borderRadius: 11 },
  repostAvatarEmpty: { backgroundColor: COLORS.purpleDeep, alignItems: 'center', justifyContent: 'center' },
  repostInitial: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  repostLabel: { flex: 1, color: COLORS.white, fontSize: 12.5, fontWeight: '700' },
  // White, as captions are on the feed cards.
  caption: { color: COLORS.white, fontSize: 13, lineHeight: 18, marginTop: 4 },
  repostArt: { marginTop: 8 },
  viewPost: { marginTop: 10 },
  lockedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10 },
  // Centres the 14px glyph on the note's first 18px line.
  lockedIcon: { marginTop: 2 },
  lockedNote: { flex: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
});
