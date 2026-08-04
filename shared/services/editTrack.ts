/**
 * Editing a published track's metadata.
 *
 * ONE function, because the description lives in TWO columns and both are load-bearing:
 *
 *   · `tracks.description` — what `searchPosts` searches (src/services/posts.ts)
 *   · `posts.caption`      — what the feed card renders (src/components/PostCard.tsx)
 *
 * `publishTrack` writes both at insert, mirroring one into the other. Nothing in the product
 * reconciles them afterwards, so an edit that updates only one silently breaks either the
 * feed text or search — and which one breaks depends on which column you happened to pick.
 * That is exactly the two-truths problem, and the fix is that there is no way to update one
 * without the other.
 *
 * Shared rather than web-local because mobile has no edit-track screen yet. When it gets one
 * it must use this, not a second pair of `.update()` calls.
 */
import { livil } from '../client';

export type TrackEdit = {
  trackId: string;
  postId: string;
  title: string;
  description: string;
};

/**
 * Apply a metadata edit.
 *
 * The track row goes first: if the caption update then fails, the feed shows a stale caption
 * against a correct title, which is visibly odd and self-reporting. The other order would
 * leave search indexing text the artist has already removed, which is silent.
 *
 * RLS is the authorization — `tracks_update_own` and the post's owner policy — so there is no
 * ownership check here to get out of step with the policy.
 */
export async function updateTrackMetadata(edit: TrackEdit): Promise<void> {
  const title = edit.title.trim();
  if (!title) throw new Error('Title is required.');

  const description = edit.description.trim() ? edit.description.trim() : null;
  const db = livil();

  // `.select('id')` is load-bearing, not decoration. Without it supabase-js sends
  // `Prefer: return=minimal` and PostgREST answers 204 with no error for an update that
  // matched ZERO rows — so an RLS denial is indistinguishable from a successful write. For
  // this function that is worse than a silent failure: the two updates are independent, so
  // a denied track update paired with a permitted caption update produces exactly the
  // description/caption divergence this file exists to make impossible. Found by security
  // review.
  const { data: trackRows, error: trackError } = await db
    .from('tracks')
    .update({ title, description })
    .eq('id', edit.trackId)
    .select('id');

  if (trackError) throw new Error(trackError.message);
  if (!trackRows || trackRows.length !== 1) {
    throw new Error('That track could not be updated — it may not be yours.');
  }

  const { data: postRows, error: postError } = await db
    .from('posts')
    .update({ caption: description })
    .eq('id', edit.postId)
    .select('id');

  if (postError) {
    throw new Error(
      `Saved the track, but the post caption did not update: ${postError.message}`,
    );
  }
  if (!postRows || postRows.length !== 1) {
    throw new Error(
      'Saved the track, but the post caption did not update — the two are now out of step.',
    );
  }
}

/**
 * Point a track at new artwork.
 *
 * Which column depends on the kind: audio posts render `cover_art_url`, video posts render
 * `thumbnail_url` (see `toCreatorPost` and PostCard). Writing the wrong one silently leaves
 * the feed showing the old picture, so the caller passes the kind rather than this guessing.
 *
 * Separate from `updateTrackMetadata` because it is a different action with a different
 * failure mode: an artwork upload has already put bytes in a bucket by the time this runs.
 */
export async function updateTrackImage(
  trackId: string,
  mediaKind: 'audio' | 'video',
  url: string,
): Promise<void> {
  // Written as two literals rather than a computed key: a computed key widens the payload
  // to `{ [x: string]: string }`, which loses the column typing that would catch a typo here.
  const patch = mediaKind === 'video' ? { thumbnail_url: url } : { cover_art_url: url };

  const { data, error } = await livil()
    .from('tracks')
    .update(patch)
    .eq('id', trackId)
    .select('id');

  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) {
    throw new Error('That track could not be updated — it may not be yours.');
  }
}
