import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ChatSongCard from './ChatSongCard';
import {
  artistLine,
  resolveSpotifyLinkCached,
  useSpotifyAvailability,
  useSpotifyTrack,
} from '../services/spotify';
import { useOpenInSpotify } from '../hooks/useOpenInSpotify';
import type { RootStackParamList } from '../navigation/types';

/**
 * A Spotify song link in a chat message, drawn as a song card (ADR-0027).
 *
 * The message itself is still plain TEXT in the database — nothing about sending changed.
 * This app recognises the link and draws the card; an older app keeps showing the raw link
 * exactly as before, so no one sees a bubble their version cannot draw.
 *
 * The look is ChatSongCard's, shared with Livil songs. What is Spotify-specific lives here:
 * resolving a short link, fetching the metadata, opening Spotify (Livil never plays it),
 * and a Repost button that follows the Spotify-reposts switch.
 */
export default function SpotifyChatCard({
  spotifyTrackId,
  shortUrl,
}: {
  /** A direct track link's id. */
  spotifyTrackId?: string;
  /** A spotify.link short link — resolved through the server first. */
  shortUrl?: string;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openSpotify = useOpenInSpotify('chat');
  const { reposts: repostsOn } = useSpotifyAvailability();

  const [resolvedId, setResolvedId] = useState<string | null>(spotifyTrackId ?? null);
  const [resolving, setResolving] = useState(!spotifyTrackId && !!shortUrl);
  useEffect(() => {
    if (spotifyTrackId) { setResolvedId(spotifyTrackId); setResolving(false); return; }
    if (!shortUrl) { setResolvedId(null); setResolving(false); return; }
    let cancelled = false;
    setResolving(true);
    resolveSpotifyLinkCached(shortUrl).then(id => {
      if (cancelled) {return;}
      setResolvedId(id);
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [spotifyTrackId, shortUrl]);

  const meta = useSpotifyTrack(resolvedId);

  // A short link that turned out not to be a song: draw nothing. The raw link is still in
  // the message text above (it is only removed for direct links), so nothing is lost.
  if (!resolving && !resolvedId) {return null;}

  const loading = resolving || meta.status === 'loading';
  const track = meta.status === 'ready' ? meta.track : null;

  return (
    <ChatSongCard
      source="spotify"
      title={track ? track.title : loading ? null : 'Spotify song'}
      artist={track ? artistLine(track) : loading ? null : 'Open it in Spotify to see it'}
      artUrl={track?.imageUrl ?? null}
      loading={loading}
      onPlay={resolvedId ? () => { void openSpotify(resolvedId); } : undefined}
      onRepost={
        repostsOn && resolvedId
          ? () => navigation.navigate('SpotifyRepost', { spotifyTrackId: resolvedId, locked: true })
          : undefined
      }
    />
  );
}
