/**
 * Uploading artwork the artist has just cropped — avatars and track covers.
 *
 * WHY THERE IS NO RE-ENCODE HERE. The obvious instinct is to canvas-re-encode before upload,
 * for two real reasons: the bucket's MIME allowlist checks a CLIENT-DECLARED content type
 * (so a patched client can upload anything while claiming image/jpeg, and there is no
 * server-side sniffing without an API tier), and EXIF must be stripped because a phone photo
 * carries GPS and these URLs are public and permanent on a platform with no block or mute.
 *
 * Both are already satisfied: every file reaching this module comes out of `CoverCropper`,
 * which draws to a canvas and calls `toBlob('image/jpeg')`. Canvas output carries no metadata
 * and is bytes we generated. Re-encoding again would be a second lossy pass for no gain —
 * which is exactly what the first version of the avatar upload did.
 *
 * The invariant to keep: NOTHING may call these with a user's original file. The cropper is
 * the re-encode point, and it is the only permitted entry.
 */
import { AVATARS_BUCKET, TRACKS_MEDIA_BUCKET, avatarPath, trackImagePath } from '@shared/services/media';
import { supabase } from '../supabase';

async function put(bucket: string, path: string, file: File): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });

  if (error) throw new Error(error.message);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Delete superseded objects, best-effort.
 *
 * Public byte reads bypass RLS entirely, so a replaced image stays fetchable forever by
 * anyone who ever had its URL. "I changed my photo" has to mean the old one is gone, not
 * merely unreferenced. Never awaited by callers and never throws — the new image is already
 * live and correct, so a failed cleanup must not surface as a failed upload.
 */
async function removeStale(bucket: string, dir: string, keepPath: string, match: RegExp) {
  try {
    const { data } = await supabase.storage.from(bucket).list(dir, { limit: 100 });
    const stale = (data ?? [])
      .filter(e => match.test(e.name))
      .map(e => `${dir}/${e.name}`)
      .filter(p => p !== keepPath);
    if (stale.length > 0) await supabase.storage.from(bucket).remove(stale);
  } catch {
    /* best-effort */
  }
}

export async function uploadAvatar(userId: string, cropped: File): Promise<string> {
  const path = avatarPath(userId);
  const url = await put(AVATARS_BUCKET, path, cropped);
  removeStale(AVATARS_BUCKET, userId, path, /^avatar_/).catch(() => {});
  return url;
}

/**
 * Replace a track's artwork.
 *
 * A NEW timestamped path rather than overwriting `cover.jpg`, for the same reason avatars are
 * timestamped: the URL is stored in the database and rendered by the mobile app, so reusing
 * the path would serve a stale CDN copy with no way to bust it short of a query string that
 * would then have to be persisted too. A new URL is simply correct.
 *
 * Only replacements are timestamped — the first upload at publish keeps `cover.ext`, since
 * there is nothing to invalidate. The storage policy matches on the first path segment only,
 * so any filename under the artist's folder is fine.
 */
export async function uploadTrackImage(
  userId: string,
  trackId: string,
  cropped: File,
): Promise<string> {
  const path = trackImagePath(userId, trackId);
  const url = await put(TRACKS_MEDIA_BUCKET, path, cropped);
  // Only sweep replacements. `cover.jpg`/`thumbnail.jpg` from the original publish are left
  // alone deliberately: this function does not know whether some other row still points at
  // them, and deleting an object another post renders is worse than leaving a stale file.
  removeStale(TRACKS_MEDIA_BUCKET, `${userId}/${trackId}`, path, /^cover_/).catch(() => {});
  return url;
}
