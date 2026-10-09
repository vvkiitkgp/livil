import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SpotifyLogo } from './SpotifyLogo';

/** Half the screen wide, art on top — a song in chat is a piece of music, not a file. */
const ART = Math.round(Dimensions.get('window').width * 0.5);

/**
 * THE song card in chat, for both sources (ADR-0027). A Livil song and a Spotify song are
 * drawn by this one component so they cannot drift apart: same panel, same artwork size,
 * same title / artist / source row, same two buttons. Only the source mark and the verbs
 * differ — "Play on Livil" plays in Livil, "Play on Spotify" opens Spotify.
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
}: {
  source: 'livil' | 'spotify';
  title: string | null;
  artist: string | null;
  artUrl: string | null;
  loading?: boolean;
  onPlay?: () => void;
  /** Omitted → no Repost button (e.g. Spotify reposts switched off). */
  onRepost?: () => void;
  /**
   * The chat bubble's long-press (react / reply / delete). Every button here takes it too:
   * a Pressable claims the whole touch, so without it holding the artwork or a button never
   * opened the message menu — and letting go then played the song.
   */
  onLongPress?: () => void;
}) {
  const where = source === 'spotify' ? 'Spotify' : 'Livil';
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPlay}
        onLongPress={onLongPress}
        disabled={!onPlay}
        accessibilityRole="button"
        accessibilityLabel={title ? `Play ${title} on ${where}` : `Play on ${where}`}
      >
        {artUrl ? (
          <Image source={{ uri: artUrl }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artEmpty]}>
            {loading ? (
              <ActivityIndicator color={COLORS.purpleLight} />
            ) : (
              <Icon name="musicNote" size={32} color={COLORS.textMuted} />
            )}
          </View>
        )}
      </Pressable>

      <Text style={styles.title} numberOfLines={2}>{title ?? ' '}</Text>
      <Text style={styles.artist} numberOfLines={1}>{artist ?? ' '}</Text>

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
});
