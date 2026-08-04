/**
 * Storage layout and filename rules for track media.
 *
 * These are pure functions mirroring `src/services/uploads.ts`. They are restated here
 * rather than imported because that file is React Native-coupled (it imports `Platform`
 * and the document picker), so the browser cannot load it.
 *
 * DRIFT WARNING: the mobile copy is still authoritative for the mobile app. Both clients
 * write into one bucket, so a divergence here produces objects at paths the other client
 * cannot predict. If you change an extension rule, change both — or better, make
 * `uploads.ts` import from here.
 */

export type TrackMediaKind = 'audio' | 'video' | 'cover' | 'thumbnail';

export const TRACKS_MEDIA_BUCKET = 'tracks-media';

/**
 * Ceiling on a single uploaded file from the WEB client: 2 GB (ADR-0015).
 *
 * Four times the mobile cap, which exists because React Native has no workable resumable
 * upload — `tus-js-client` buffers the whole file into memory there and OOM-crashes. A
 * browser has neither constraint, which is the entire reason this client exists.
 *
 * The project-wide "Global file size limit" in Supabase Storage Settings must be >= this
 * value, or the server rejects everything between the two limits.
 */
export const MAX_WEB_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export function tooLargeMessage(kind: TrackMediaKind): string {
  const limitGb = Math.round(MAX_WEB_UPLOAD_BYTES / (1024 * 1024 * 1024));
  if (kind === 'video') {
    return `This video is over the ${limitGb} GB upload limit. Try a shorter clip or a lower resolution.`;
  }
  if (kind === 'audio') {
    return `This audio file is over the ${limitGb} GB upload limit. Try a shorter or more compressed file.`;
  }
  return `This image is over the ${limitGb} GB upload limit. Try a smaller image.`;
}

function extensionFromName(name: string | null, fallback: string): string {
  if (!name) return fallback;
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return fallback;
  return name.slice(dot + 1).toLowerCase();
}

function defaultExtensionFor(kind: TrackMediaKind, mime: string | null): string {
  if (mime) {
    if (mime.includes('mpeg')) return 'mp3';
    if (mime.includes('aac')) return 'aac';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('flac')) return 'flac';
    if (mime.includes('mp4') && kind === 'audio') return 'm4a';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('quicktime')) return 'mov';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('heic')) return 'heic';
  }
  if (kind === 'audio') return 'mp3';
  if (kind === 'video') return 'mp4';
  return 'jpg';
}

export function resolveExtension(
  kind: TrackMediaKind,
  fileName: string | null,
  mime: string | null,
): string {
  return extensionFromName(fileName, defaultExtensionFor(kind, mime));
}

/**
 * Extension → MIME, restricted to what the `tracks-media` bucket actually accepts.
 *
 * The bucket carries a server-side `allowed_mime_types` allowlist (17 entries, verified in
 * ADR-0007). Anything outside it is rejected by storage-api, so a browser that cannot type
 * a file — common for AIFF, and for files dragged from some network volumes, where
 * `File.type` is the empty string — must not fall back to `application/octet-stream`. That
 * value is not on the allowlist and produces an opaque server error instead of a useful one.
 *
 * Deriving from the extension keeps those uploads working. It stays a guess, but a guess
 * inside the allowlist beats a certainty outside it.
 */
const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export function resolveContentType(
  kind: TrackMediaKind,
  ext: string,
  declared: string | null,
): string {
  // Trust the browser when it gave us something usable.
  if (declared && declared !== 'application/octet-stream') return declared;
  const byExt = MIME_BY_EXT[ext];
  if (byExt) return byExt;
  // webm is ambiguous — the same container is audio or video depending on the track.
  if (ext === 'webm') return kind === 'audio' ? 'audio/webm' : 'video/webm';
  if (kind === 'audio') return 'audio/mpeg';
  if (kind === 'video') return 'video/mp4';
  return 'image/jpeg';
}

/**
 * `${userId}/${trackId}/${kind}.${ext}` — the layout storage policies are written against.
 * The leading user id is what lets an owner-scoped policy match on the path prefix.
 */
export function storagePathFor(
  userId: string,
  trackId: string,
  kind: TrackMediaKind,
  ext: string,
): string {
  return `${userId}/${trackId}/${kind}.${ext}`;
}
