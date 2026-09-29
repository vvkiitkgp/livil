import { useEffect, useMemo } from 'react';
import { usePlayback } from '../contexts/PlaybackContext';
import { setListeningTrack, type ListeningTrack } from '../services/listeningStatus';
import { listeningTrackFor } from '../utils/listeningStatus';

/**
 * Publishes "what I'm playing right now" for the chat listening indicator from React
 * state. Renders nothing.
 *
 * FOREGROUND ONLY, in practice. While the app is backgrounded Android does not flush
 * React effects promptly, so a pause / play / skip from the notification, lock screen
 * or headset would reach the server only when the app is next opened. Those moments
 * are therefore ALSO published directly from GlobalAudioPlayer's native-event
 * handlers (handlePlaybackStateChanged, publishQueueTrack); this component covers every
 * in-app change.
 * Both paths go through listeningTrackFor and the idempotent planListeningWrite, so
 * they agree and a duplicate is a no-op.
 *
 * Playing means the single engine is meant to be sounding this track:
 * `activePostId === nowPlaying.postId`. Deliberately NOT reported:
 *   - a story (clip session): not "listening to music", and ADR-0013 keeps stories off
 *     every surface outside the viewer;
 *   - `engineDriving`: reserved for a separate playback engine. Nothing sets it today,
 *     so a JAM IS reported — a listener's GAP plays the host's track, and friends see
 *     that song in chat, which is the intended behaviour.
 */
export default function ListeningStatusReporter() {
  const { nowPlaying, activePostId, engineDriving, isStoryViewerOpen } = usePlayback();

  const isPlaying =
    !!nowPlaying && activePostId === nowPlaying.postId && !engineDriving && !isStoryViewerOpen;
  const published = nowPlaying ? listeningTrackFor(nowPlaying) : null;

  const track: ListeningTrack | null = useMemo(
    () => (isPlaying && published ? published : null),
    // Keyed on the fields that are written, not on the nowPlaying object: GAP patches
    // nowPlaying in place (e.g. albumTitle), which must not trigger a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPlaying, published?.postId, published?.title, published?.artistName],
  );

  useEffect(() => {
    setListeningTrack(track);
  }, [track]);

  return null;
}
