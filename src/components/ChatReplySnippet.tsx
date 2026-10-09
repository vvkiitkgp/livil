import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import type { ChatMessage } from '../services/messages';
import {
  artistLine,
  resolveSpotifyLinkCached,
  useSpotifyTrack,
} from '../services/spotify';
import { findSpotifyLinkInText } from '../utils/spotifyLinks';
import { profileHandleIfExactLink } from '../utils/shareLinks';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SpotifyLogo } from './SpotifyLogo';

/**
 * What a reply shows of the message it answers — inside the reply bubble and in the
 * "Replying to …" bar above the composer.
 *
 * A SONG (a Livil track share, or a Spotify link) is shown as a small song row — cover,
 * title, artist, source mark — the same for both sources, never the raw link. Anything
 * else is the message's text, truncated. Only this line is drawn here; the caller draws
 * the author line above it.
 *
 *   me   — inside a sent (purple) bubble
 *   them — inside a received (dark) bubble
 *   bar  — the reply bar above the composer
 */
export type ReplySnippetTone = 'me' | 'them' | 'bar';

export function ChatReplySnippet({
  message,
  tone,
  numberOfLines = 2,
}: {
  /** null = the original isn't loaded (scrolled out of the page, or deleted). */
  message: ChatMessage | null;
  tone: ReplySnippetTone;
  numberOfLines?: number;
}) {
  const textStyle = [styles.text, TEXT_TONE[tone]];

  if (!message) {
    return <Text style={textStyle} numberOfLines={1}>Tap to view</Text>;
  }

  if (message.kind === 'track_share' && message.metadata?.title) {
    return (
      <SongRow
        source="livil"
        tone={tone}
        title={String(message.metadata.title)}
        artist={(message.metadata.artist_name as string | undefined) ?? null}
        artUrl={(message.metadata.cover_art_url as string | null | undefined) ?? null}
      />
    );
  }

  if (message.kind === 'text' && message.body) {
    const spotify = findSpotifyLinkInText(message.body);
    if (spotify) {
      return (
        <SpotifySongRow
          id={spotify.id ?? null}
          shortUrl={spotify.shortUrl ?? null}
          tone={tone}
        />
      );
    }
    const handle = profileHandleIfExactLink(message.body);
    if (handle) {
      return <Text style={textStyle} numberOfLines={1}>{`@${handle}'s profile`}</Text>;
    }
    return <Text style={textStyle} numberOfLines={numberOfLines}>{message.body}</Text>;
  }

  const label =
    message.kind === 'sticker' ? 'Sticker'
      : message.kind === 'track_share' ? 'Song'
      : message.body || 'Message';
  return <Text style={textStyle} numberOfLines={numberOfLines}>{label}</Text>;
}

/** A Spotify link → its song row. A short link is resolved first, as the chat card does. */
function SpotifySongRow({ id, shortUrl, tone }: { id: string | null; shortUrl: string | null; tone: ReplySnippetTone }) {
  const [resolvedId, setResolvedId] = useState<string | null>(id);
  useEffect(() => {
    if (id) { setResolvedId(id); return; }
    if (!shortUrl) { setResolvedId(null); return; }
    let cancelled = false;
    resolveSpotifyLinkCached(shortUrl).then(found => { if (!cancelled) {setResolvedId(found);} });
    return () => { cancelled = true; };
  }, [id, shortUrl]);

  const meta = useSpotifyTrack(resolvedId);
  const track = meta.status === 'ready' ? meta.track : null;
  return (
    <SongRow
      source="spotify"
      tone={tone}
      title={track?.title ?? (meta.status === 'loading' ? null : 'Spotify song')}
      artist={track ? artistLine(track) : null}
      artUrl={track?.imageUrl ?? null}
    />
  );
}

const ART = 36;

function SongRow({
  source,
  tone,
  title,
  artist,
  artUrl,
}: {
  source: 'livil' | 'spotify';
  tone: ReplySnippetTone;
  /** null = still loading. */
  title: string | null;
  artist: string | null;
  artUrl: string | null;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Song: ${title ?? 'loading'}${artist ? `, by ${artist}` : ''}, on ${source === 'spotify' ? 'Spotify' : 'Livil'}`}
    >
      {/* Artwork as given: corners ≤ 4px and nothing drawn over it (Spotify's rule, which
          the Livil row follows too so the two match — same as ChatSongCard). */}
      {artUrl ? (
        <Image source={{ uri: artUrl }} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.artEmpty]}>
          <Icon name="musicNote" size={16} color={COLORS.purpleLight} />
        </View>
      )}
      <View style={styles.meta}>
        <Text style={[styles.title, TITLE_TONE[tone]]} numberOfLines={1}>
          {title ?? ' '}
        </Text>
        {artist ? (
          <Text style={[styles.artist, TEXT_TONE[tone]]} numberOfLines={1}>{artist}</Text>
        ) : null}
      </View>
      <View style={styles.mark}>
        {source === 'spotify' ? <SpotifyLogo size="xs" /> : <Logo size={24} />}
      </View>
    </View>
  );
}

const TEXT_TONE = StyleSheet.create({
  me: { color: 'rgba(255,255,255,0.85)' },
  them: { color: COLORS.white },
  bar: { color: COLORS.textSecondary },
});

const TITLE_TONE = StyleSheet.create({
  me: { color: COLORS.white },
  them: { color: COLORS.white },
  bar: { color: COLORS.white },
});

const styles = StyleSheet.create({
  text: { fontSize: 13, lineHeight: 17, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  art: { width: ART, height: ART, borderRadius: 4 },
  artEmpty: { backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  // flexShrink, not flex: 1. A reply bubble is shrink-wrapped to its content, and flex: 1
  // means a basis of 0 — the title would measure as nothing and vanish. Shrink only when the
  // bubble's max width runs out.
  meta: { flexShrink: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
  artist: { fontSize: 12, lineHeight: 16 },
  mark: { marginLeft: 2 },
});
