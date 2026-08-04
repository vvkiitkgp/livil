/**
 * Avatar upload from the browser.
 *
 * TWO THINGS HERE ARE SECURITY CONTROLS, not conveniences.
 *
 * 1. THE FILE IS RE-ENCODED, never uploaded as picked. The bucket's MIME allowlist compares
 *    against a CLIENT-DECLARED content type, so a patched client can upload anything while
 *    claiming `image/jpeg`. There is no server-side sniffing available without an API tier
 *    (ADR-0004). The practical control is to never send the original bytes: drawing to a
 *    canvas and re-encoding produces a file we generated, whatever went in.
 *
 * 2. RE-ENCODING STRIPS EXIF, which is the part that matters for users. A phone photo carries
 *    GPS coordinates. Avatar URLs are PUBLIC and permanent, and Livil has no block or mute —
 *    so an avatar with the artist's home coordinates baked in is a stalking vector, not a
 *    hygiene issue. Canvas output carries no metadata at all.
 *
 * The mobile client gets both for free because its picker forces JPEG at 512×512
 * (`AVATAR_CROP_OPTIONS`). The browser has to do it explicitly.
 */
import { AVATARS_BUCKET, avatarPath } from '@shared/services/media';
import { supabase } from '../supabase';

const OUTPUT_PX = 512;
const JPEG_QUALITY = 0.9;

/**
 * Re-encode a square crop to a JPEG we produced.
 *
 * Takes the already-cropped square from the cropper, so this only resizes and re-encodes —
 * the framing decision was made upstream.
 */
async function reencodeSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, OUTPUT_PX, OUTPUT_PX);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('Could not encode the image');
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Upload a new avatar and return its public URL.
 *
 * The path carries a timestamp — `${userId}/avatar_${Date.now()}.jpg` — matching the mobile
 * convention. That is a deliberate CDN cache-bust: every upload is a new URL, so a changed
 * avatar appears immediately with no stale-cache workaround. Do not "simplify" it to a fixed
 * `avatar.jpg`; that reintroduces the caching problem the timestamp exists to solve.
 *
 * Previous avatars are deleted afterwards. Public byte reads bypass RLS entirely, so an old
 * object stays fetchable by anyone who ever saw its URL — "I changed my photo" has to mean
 * the old one is gone, not merely unreferenced. Best-effort: a failed cleanup must not fail
 * the upload, since the new avatar is already live and correct.
 */
export async function uploadAvatar(userId: string, cropped: File): Promise<string> {
  const blob = await reencodeSquare(cropped);
  const path = avatarPath(userId);

  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  // Not awaited: the new avatar is already live, and cleaning up the old one must not make
  // the artist wait or fail their upload.
  removeOldAvatars(userId, path).catch(() => {
    /* handled inside */
  });
  return data.publicUrl;
}

async function removeOldAvatars(userId: string, keepPath: string): Promise<void> {
  try {
    const { data } = await supabase.storage.from(AVATARS_BUCKET).list(userId, { limit: 100 });
    const stale = (data ?? [])
      .map(entry => `${userId}/${entry.name}`)
      .filter(p => p !== keepPath);
    if (stale.length > 0) {
      await supabase.storage.from(AVATARS_BUCKET).remove(stale);
    }
  } catch {
    /* best-effort; the new avatar is already live */
  }
}
