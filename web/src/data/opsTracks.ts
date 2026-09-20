/**
 * One artist's uploads, for manual review before granting a badge.
 *
 * READ THROUGH AN OPS RPC, NOT `from('tracks')` DIRECTLY. The first version did the
 * latter, on the belief that `tracks_select_authenticated` was `using (true)`. That was
 * true until 20260809000000 made it block-aware, and the result was a page that said "No
 * uploads" for an artist the roster showed with 19 — silently, because RLS returns fewer
 * rows rather than an error. The roster's count comes from a SECURITY DEFINER function, so
 * the number and the list were computed under different authority and disagreed.
 * `ops_tracks_for_user` puts them back on the same footing; see its migration for why a
 * block must not decide what an operator may review.
 *
 * MEDIA PLAYBACK ALSO NEEDS NOTHING. `audio_url` / `video_url` are public object URLs, and
 * public byte reads never consult RLS (20260804010000 verified this by probe — it is why
 * media kept playing through the four-week period when storage had no policies at all).
 * The owner-scoping in that migration restricts `/object/list` enumeration, not reads.
 *
 * TRACKS, NOT POSTS. A repost creates a post and no track, so listing posts would show an
 * operator somebody else's work under this artist's name — exactly the wrong thing when the
 * question being answered is "did this person make enough good work to be one of the 100".
 * This matches how ops_users_overview() counts the number the operator clicked to get here.
 */
import { supabase } from '../supabase';

function opsError(error: { message?: string; code?: string } | null): Error {
  const message = error?.message ?? 'Unknown error';
  if (error?.code === 'PGRST202' || /schema cache/i.test(message)) {
    return new Error(
      'The ops track-review migration has not been applied to this database yet — run '
      + 'supabase/migrations/20260919010000_ops_tracks_for_user.sql, then reload.',
    );
  }
  return new Error(message);
}

export type OpsTrack = {
  id: string;
  title: string;
  description: string | null;
  mediaKind: 'audio' | 'video';
  durationSeconds: number | null;
  coverArtUrl: string | null;
  thumbnailUrl: string | null;
  /** The URL that actually plays. Audio tracks carry audio_url, video tracks video_url. */
  mediaUrl: string | null;
  createdAt: string;
};

export type OpsArtist = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
};

/**
 * Who the artist is — through an ops RPC for the same reason the tracks are.
 *
 * `profiles_select_authenticated` carries the same block clause `tracks` does, so reading
 * the profile under the operator's own session renders the review page with no name and no
 * handle when a block exists and the two do not share a conversation. No error: the row is
 * simply invisible. That is the identical failure the track list already had, one field over.
 */
export async function fetchArtistForOps(userId: string): Promise<OpsArtist | null> {
  const { data, error } = await supabase.rpc('ops_profile_for_user', { p_user_id: userId });
  if (error) throw opsError(error);
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
  };
}

export async function fetchTracksForUser(userId: string): Promise<OpsTrack[]> {
  const { data, error } = await supabase.rpc('ops_tracks_for_user', { p_user_id: userId });

  if (error) throw opsError(error);

  return (data ?? []).map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    mediaKind: t.media_kind as 'audio' | 'video',
    durationSeconds: t.duration_seconds,
    coverArtUrl: t.cover_art_url,
    thumbnailUrl: t.thumbnail_url,
    // tracks_media_shape_check guarantees exactly one of these is set for the kind, so this
    // yields null only for a row that violated it — in which case null is the honest value.
    mediaUrl: t.media_kind === 'video' ? t.video_url : t.audio_url,
    createdAt: t.created_at,
  }));
}
