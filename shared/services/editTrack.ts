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

  const { error: trackError } = await db
    .from('tracks')
    .update({ title, description })
    .eq('id', edit.trackId);

  if (trackError) throw new Error(trackError.message);

  const { error: postError } = await db
    .from('posts')
    .update({ caption: description })
    .eq('id', edit.postId);

  if (postError) {
    throw new Error(
      `Saved the track, but the post caption did not update: ${postError.message}`,
    );
  }
}
