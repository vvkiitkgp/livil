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
 * `content://` URIs from the Android document picker can't be read with `fetch()` reliably —
 * cloud-backed providers (Drive) return HTTP status 0, which crashes whatwg-fetch's Response
 * constructor. We materialize a real `file://` copy via the picker's `keepLocalCopy`, then read
 * it through RN's native fetch which handles `file://` cleanly.
 */
async function readPickedFileAsArrayBuffer(file: PickedFile): Promise<ArrayBuffer> {
  let readableUri = file.uri;

  if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
    try {
      const [result] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name ?? 'upload' }],
        destination: 'cachesDirectory',
      });
      if (result.status !== 'success') {
        throw new Error(result.copyError);
      }
      readableUri = result.localUri;
    } catch (err) {
      throw describeReadFailure(file.uri, err);
    }
  }

  try {
    const response = await fetch(readableUri);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('File was empty.');
    }
    return buffer;
  } catch (err) {
    throw describeReadFailure(file.uri, err);
  }
}

/**
 * Direct XHR upload against Supabase Storage REST. Bypasses supabase-js so we can observe
 * `xhr.upload.onprogress` byte events for the progress bar — supabase-js's storage client
 * uses fetch internally and doesn't expose progress.
 */
function uploadArrayBufferWithProgress(
  path: string,
  arrayBuffer: ArrayBuffer,
  contentType: string,
  accessToken: string,
  onProgress: UploadProgressCallback,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${TRACKS_MEDIA_BUCKET}/${path}`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', contentType);
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
      } else {
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
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload aborted.'));

    xhr.send(arrayBuffer);
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

  const arrayBuffer = await readPickedFileAsArrayBuffer(file);

  // 'cover' and 'thumbnail' are both image uploads — branch on that.
  const isImage = kind === 'cover' || kind === 'thumbnail';
  const contentType = file.type ?? `${isImage ? 'image' : kind}/*`;

  await uploadArrayBufferWithProgress(path, arrayBuffer, contentType, accessToken, onProgress);

  const { data } = supabase.storage.from(TRACKS_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
