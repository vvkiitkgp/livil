import { Platform } from 'react-native';
import { keepLocalCopy } from '@react-native-documents/picker';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../../lib/supabase';

export const TRACKS_MEDIA_BUCKET = 'tracks-media';

export type TrackMediaKind = 'audio' | 'video' | 'cover' | 'thumbnail';

export type PickedFile = {
  uri: string;
  name: string | null;
  type: string | null;
  size: number | null;
};

export type UploadProgressCallback = (fraction: number) => void;

/**
 * Hard ceiling on a single uploaded file from the mobile app — sized for phone-recorded video.
 * The mobile upload is a single streamed request with no resume-on-drop (resumable uploads have no
 * clean React Native solution — tus-js-client buffers the whole file into memory and OOM-crashes),
 * so this is kept reasonable for cellular. Large pro 4K masters are intentionally out of scope on
 * mobile; they're meant for a future web uploader that can do resumable uploads.
 *
 * NOTE: the project-wide "Global file size limit" in Supabase Storage Settings must be >= this
 * value (a bucket's own limit is itself capped by that global), or the server keeps rejecting files
 * between the global limit and this one.
 */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** User-facing "this file is too big" copy, tailored to the media kind. */
export function tooLargeMessage(kind: TrackMediaKind): string {
  const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
  if (kind === 'video') {
    return `This video is over the ${limitMb} MB upload limit. Try a shorter clip or a lower resolution.`;
  }
  if (kind === 'audio') {
    return `This audio file is over the ${limitMb} MB upload limit. Try a shorter or more compressed file.`;
  }
  return `This image is over the ${limitMb} MB upload limit. Try a smaller image.`;
}

function extensionFromName(name: string | null, fallback: string): string {
  if (!name) {return fallback;}
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) {return fallback;}
  return name.slice(dot + 1).toLowerCase();
}

function defaultExtensionFor(kind: TrackMediaKind, mime: string | null): string {
  if (mime) {
    if (mime.includes('mpeg')) {return 'mp3';}
    if (mime.includes('aac')) {return 'aac';}
    if (mime.includes('wav')) {return 'wav';}
    if (mime.includes('ogg')) {return 'ogg';}
    if (mime.includes('flac')) {return 'flac';}
    if (mime.includes('mp4') && kind === 'audio') {return 'm4a';}
    if (mime.includes('mp4')) {return 'mp4';}
    if (mime.includes('quicktime')) {return 'mov';}
    if (mime.includes('webm')) {return 'webm';}
    if (mime.includes('jpeg')) {return 'jpg';}
    if (mime.includes('png')) {return 'png';}
    if (mime.includes('webp')) {return 'webp';}
    if (mime.includes('heic')) {return 'heic';}
  }
  if (kind === 'audio') {return 'mp3';}
  if (kind === 'video') {return 'mp4';}
  return 'jpg';
}

function isLikelyGoogleDriveUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  return (
    lower.includes('com.google.android.apps.docs') ||
    lower.includes('com.google.android.apps.docs.storage') ||
    lower.includes('docs.google.com') ||
    lower.includes('drive.google.com')
  );
}

function describeReadFailure(originalUri: string, underlying: unknown): Error {
  const detail = underlying instanceof Error ? underlying.message : String(underlying ?? '');
  if (isLikelyGoogleDriveUri(originalUri)) {
    return new Error(
      "Couldn't read this file from Google Drive. Open Drive, mark the file as 'Available offline', then pick it again — or download it to your device first.",
    );
  }
  return new Error(
    detail
      ? `Failed to read local file: ${detail}`
      : 'Failed to read the picked file. Try a different file or pick it from device storage.',
  );
}

/**
 * Returns a URI we can stream straight off disk. `content://` URIs from the Android document
 * picker aren't reliably readable by every provider (cloud-backed ones like Drive can fail), so we
 * materialize a real `file://` copy via the picker's `keepLocalCopy` first. On iOS the picker
 * already hands back a `file://` URI, so we stream it directly.
 *
 * We deliberately do NOT read the file into a JS `ArrayBuffer` here — doing that loaded the entire
 * file into memory, which RN surfaced as "Network request failed" for large videos. The upload
 * streams from this URI instead (see `uploadFileUriWithProgress`).
 */
async function resolveReadableUri(file: PickedFile): Promise<string> {
  if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
    try {
      const [result] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name ?? 'upload' }],
        destination: 'cachesDirectory',
      });
      if (result.status !== 'success') {
        throw new Error(result.copyError);
      }
      return result.localUri;
    } catch (err) {
      throw describeReadFailure(file.uri, err);
    }
  }
  return file.uri;
}

/**
 * Direct XHR upload against Supabase Storage REST. The file is streamed straight from its on-disk
 * URI via `multipart/form-data` — RN reads it off disk in chunks rather than us pulling the whole
 * thing into a JS `ArrayBuffer` first (which threw "Network request failed" on large videos).
 *
 * The multipart shape mirrors what supabase-js sends so storage-api parses it identically: a
 * `cacheControl` field first, then an (empty-named) file part whose `Content-Type` becomes the
 * stored object's content type. We do NOT set a request `Content-Type` header — RN fills in
 * `multipart/form-data; boundary=…`. XHR (not fetch) is used so `xhr.upload.onprogress` can drive
 * the progress bar — supabase-js's storage client doesn't expose progress.
 */
function uploadFileUriWithProgress(
  path: string,
  kind: TrackMediaKind,
  fileUri: string,
  fileName: string,
  contentType: string,
  accessToken: string,
  onProgress: UploadProgressCallback,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${TRACKS_MEDIA_BUCKET}/${path}`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');

    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      // Supabase rejects oversized files with "The object exceeded the maximum allowed size"
      // (HTTP 400 or 413). Surface friendly, kind-aware copy instead of that raw server text —
      // "object" is Supabase's word for a stored file and means nothing to a user.
      if (
        xhr.status === 413 ||
        /exceeded the maximum allowed|payload too large|entity too large/i.test(xhr.responseText)
      ) {
        reject(new Error(tooLargeMessage(kind)));
        return;
      }
      let message = `Upload failed (HTTP ${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (parsed && typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // Non-JSON body; keep the default message.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload aborted.'));

    // Field order matters: cacheControl before the file part, mirroring supabase-js — storage-api's
    // streaming multipart parser reads the leading fields, then the trailing file stream.
    const formData = new FormData();
    formData.append('cacheControl', '3600');
    formData.append('', { uri: fileUri, name: fileName, type: contentType } as any);
    xhr.send(formData);
  });
}

export async function uploadTrackFile(
  file: PickedFile,
  kind: TrackMediaKind,
  trackId: string,
  userId: string,
  accessToken: string,
  onProgress: UploadProgressCallback,
): Promise<string> {
  const ext = extensionFromName(file.name, defaultExtensionFor(kind, file.type));
  const path = `${userId}/${trackId}/${kind}.${ext}`;

  const readableUri = await resolveReadableUri(file);

  // 'cover' and 'thumbnail' are both image uploads — branch on that.
  const isImage = kind === 'cover' || kind === 'thumbnail';
  const contentType = file.type ?? `${isImage ? 'image' : kind}/*`;
  const fileName = file.name ?? `${kind}.${ext}`;

  await uploadFileUriWithProgress(path, kind, readableUri, fileName, contentType, accessToken, onProgress);

  const { data } = supabase.storage.from(TRACKS_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
