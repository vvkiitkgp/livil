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
 * Ceiling on a single uploaded file from the WEB client.
 *
 * ADR-0015 decision 5 sets this at 2 GB, and that remains the target — a browser has no
 * equivalent of the constraint that caps mobile at 500 MB (React Native has no workable
 * resumable upload; `tus-js-client` buffers the whole file into memory there and
 * OOM-crashes). Raising it is the entire reason this client exists.
 *
 * It is deliberately still 500 MB, because the SERVER is still 500 MB. Two limits govern
 * an upload and only one of them is in this repository:
 *
 *   1. the `tracks-media` bucket's own `file_size_limit` — currently exactly 524288000
 *   2. the project-wide "Global file size limit", which caps (1)
 *
 * Both are console settings (storage config is unversioned — ADR-0007). Promising 2 GB
 * here while the bucket rejects anything past 500 MB would be worse than the current cap:
 * the artist picks a 900 MB master, watches it upload, and gets an opaque server error at
 * the end. A client-side limit fails in a second, with copy that names the number.
 *
 * TO RAISE: move both console settings first, then change this constant to
 * `2 * 1024 * 1024 * 1024`. Nothing else needs to change — the resumable path,
 * the progress weighting, and the error handling are already sized for it.
 */
export const MAX_WEB_UPLOAD_BYTES = 500 * 1024 * 1024;

function formatLimit(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${Math.round(gb)} GB` : `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function tooLargeMessage(kind: TrackMediaKind): string {
  const limit = formatLimit(MAX_WEB_UPLOAD_BYTES);
  if (kind === 'video') {
    return `This video is over the ${limit} upload limit. Try a shorter clip or a lower resolution.`;
  }
  if (kind === 'audio') {
    return `This audio file is over the ${limit} upload limit. Try a shorter or more compressed file.`;
  }
  return `This image is over the ${limit} upload limit. Try a smaller image.`;
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
    if (mime.includes('aiff')) return 'aiff';
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
  // Both spellings exist in the wild: audio/aiff is what most tools emit, audio/x-aiff is
  // the older registration macOS still uses. The bucket accepts both. Without this entry an
  // AIFF whose File.type the browser left empty would be stored declaring audio/mpeg —
  // accepted, but permanently mislabelled as an MP3.
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
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


/** Avatars live in their own bucket, owner-scoped, 10 MB, images only. */
export const AVATARS_BUCKET = 'avatars';

/**
 * `${userId}/avatar_${timestamp}.jpg`, matching what the mobile client writes.
 *
 * The timestamp is a deliberate CDN cache-bust: each upload is a NEW URL, so a changed
 * avatar shows up immediately without a query-string hack or a cache purge. A fixed
 * `avatar.jpg` would be simpler and would reintroduce exactly the staleness this avoids.
 *
 * The leading user id is what the owner-scoped storage policy matches on.
 */
export function avatarPath(userId: string): string {
  return `${userId}/avatar_${Date.now()}.jpg`;
}

/**
 * Path for REPLACEMENT track artwork: `${userId}/${trackId}/cover_${timestamp}.jpg`.
 *
 * Timestamped for the same reason avatars are: the URL is stored in the database and
 * rendered by the mobile app, so overwriting `cover.jpg` in place would serve a stale CDN
 * copy with no way to bust it. The original publish keeps the plain `cover.ext` name —
 * there is nothing to invalidate the first time.
 */
export function trackImagePath(userId: string, trackId: string): string {
  return `${userId}/${trackId}/cover_${Date.now()}.jpg`;
}
