import { Platform } from 'react-native';
import { keepLocalCopy } from '@react-native-documents/picker';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../../lib/supabase';
import { canonicalContentType } from '../../shared/services/media';
import { UploadNetworkError } from '../utils/uploadRecovery';
import { subscribeToNetworkChange, type NetworkSnapshot } from './network';

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

/**
 * How long the upload may make NO progress before it is treated as dead.
 *
 * This is an idle limit, not a total one — see the watchdog in
 * `uploadFileUriWithProgress`. A 500 MB video on a poor connection is fine; a connection
 * that has moved zero bytes for this long is not coming back, and waiting on it silently
 * is what left an upload frozen at 80% with no way out but force-quitting.
 *
 * 45s rather than something tighter because mobile networks stall for real during a
 * handover between cells, and a spurious failure costs the user the whole upload.
 */
export const STALL_TIMEOUT_MS = 45_000;

/**
 * How long the server may take to answer AFTER the last byte is sent.
 *
 * Progress events stop at that point while storage finishes writing the object, so the
 * stall watchdog would otherwise fire during normal, healthy work on a large file. Longer
 * than STALL_TIMEOUT_MS for exactly that reason.
 */
export const RESPONSE_TIMEOUT_MS = 120_000;

/**
 * The stall window right after the phone switches network (Wi-Fi → mobile data, or on/off).
 *
 * A request keeps the socket it opened on the OLD network. If that network is gone the socket
 * may say nothing at all — no error, no progress — so the upload would sit out the full
 * STALL_TIMEOUT_MS before anyone noticed. After a switch, a socket that is still alive shows
 * progress within seconds (and every progress event restores the normal window), so a
 * shorter window here only ends uploads that are really dead.
 */
export const NETWORK_CHANGE_STALL_MS = 15_000;

/** One `[LIVIL][upload]` line. Never the access token — paths and numbers only. */
function log(...parts: unknown[]): void {
  console.log('[LIVIL][upload]', ...parts);
}

const secondsSince = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

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

/**
 * User-facing "we don't take this format" copy, for when the bucket's MIME allowlist refuses
 * a file. Storage's own text ("mime type audio/vnd.wave is not supported") was shown to an
 * artist verbatim on 2026-10-11; it names an internal label, not anything they can act on.
 */
export function unsupportedTypeMessage(kind: TrackMediaKind): string {
  if (kind === 'video') {
    return "Livil can't take this video format yet. Try an MP4 or MOV file.";
  }
  if (kind === 'audio') {
    return "Livil can't take this audio format yet. Try an MP3, M4A, WAV, FLAC or AIFF file.";
  }
  return "Livil can't take this image format. Try a JPG or PNG.";
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
export async function resolveReadableUri(file: PickedFile): Promise<string> {
  if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
    // Logged with its time: the screen already says "Uploading · 0%" here, and for a file
    // that lives in Google Drive this copy is a download — the one step before the upload
    // that has no time limit, because a large file legitimately takes a while.
    const startedAt = Date.now();
    log('copying the picked file into the app before sending it');
    try {
      const [result] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name ?? 'upload' }],
        destination: 'cachesDirectory',
      });
      if (result.status !== 'success') {
        throw new Error(result.copyError);
      }
      log(`copied in ${secondsSince(startedAt)}`);
      return result.localUri;
    } catch (err) {
      log(`copy failed after ${secondsSince(startedAt)}`, err);
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
  signal?: AbortSignal,
  bucket: string = TRACKS_MEDIA_BUCKET,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Stopped by the caller before it started (the screen moved on): send nothing.
    if (signal?.aborted) {
      reject(new Error('Upload aborted.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');

    // ── STALL DETECTION ──────────────────────────────────────────────────────
    //
    // `onerror` catches a connection that FAILS and `onabort` one the user cancels. A
    // connection that simply goes quiet — phone loses signal mid-upload, or a carrier
    // proxy holds the socket open — fires neither, and an XHR has no time limit unless
    // one is set. The upload sat at whatever percent it had reached, forever, with no
    // error and no way out but force-quitting the app. That is a real report, at 80%.
    //
    // `xhr.timeout` is deliberately NOT used: it caps the TOTAL request, so any value
    // safe for a 500 MB video on a slow connection is far too long to be useful, and any
    // value that feels responsive would kill legitimate large uploads. What matters is
    // not how long the upload takes but whether it is still MOVING.
    //
    // So: a watchdog re-armed on every progress event. It fires only when nothing has
    // moved for STALL_MS, which a healthy upload never triggers no matter how slow.
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    // What the request is doing, for the logs and for which window applies.
    let phase: 'connecting' | 'sending' | 'answer' = 'connecting';
    let percent = 0;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    // The caller's stop (a swapped or removed file) ends the request at once, instead of
    // letting a file nobody wants finish uploading over mobile data before it is deleted.
    const onCallerAbort = () => xhr.abort();
    signal?.addEventListener('abort', onCallerAbort);
    const clearWatchdog = () => {
      if (watchdog) { clearTimeout(watchdog); watchdog = undefined; }
    };
    const armWatchdog = (ms: number) => {
      clearWatchdog();
      watchdog = setTimeout(() => {
        stalled = true;
        log(`stalled at ${percent}% (${phase}): nothing moved for ${secondsSince(lastProgressAt)} — stopping`, path);
        // Aborting routes into `onabort`, which reads `stalled` to tell a dead connection
        // apart from a user cancelling.
        xhr.abort();
      }, ms);
    };

    // A Wi-Fi → mobile data switch (or a drop) mid-upload: logged, and while bytes are still
    // going out the stall window shortens to NETWORK_CHANGE_STALL_MS — see there. The first
    // call is the network the upload started on, not a change.
    let network: NetworkSnapshot | null = null;
    const describe = (n: NetworkSnapshot) => (n.offline ? `${n.type} (offline)` : n.type);
    const stopWatchingNetwork = subscribeToNetworkChange(next => {
      const prev = network;
      network = next;
      if (!prev) { return; }
      log(`network changed ${describe(prev)} → ${describe(next)} at ${percent}% (${phase})`, path);
      if (phase !== 'answer') { armWatchdog(NETWORK_CHANGE_STALL_MS); }
    });

    // Every way the request ends: the watchdog, the caller's stop and the network watch go.
    const settle = () => {
      clearWatchdog();
      signal?.removeEventListener('abort', onCallerAbort);
      stopWatchingNetwork();
    };

    // The response budget, once the last byte is out: progress events stop there while
    // storage writes the object, which for a large file legitimately takes longer than the
    // stall window.
    const enterAnswerPhase = () => {
      if (phase === 'answer') { return; }
      phase = 'answer';
      log(`all bytes sent after ${secondsSince(startedAt)} — waiting for storage to answer`, path);
    };

    xhr.upload.onprogress = event => {
      lastProgressAt = Date.now();
      if (phase === 'connecting') {
        phase = 'sending';
        log(
          `first bytes out after ${secondsSince(startedAt)}`
          + (event.lengthComputable && event.total > 0 ? ` (${megabytes(event.total)})` : ''),
          path,
        );
      }
      if (event.lengthComputable && event.total > 0) {
        percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(Math.min(1, event.loaded / event.total));
        // React Native never fires `upload.onloadend` (its XHR dispatches only `progress` on
        // `xhr.upload`), so the end of the body is read off the progress event that reaches
        // the total. Without this the 45s stall window stayed armed while storage wrote a
        // large file, and a healthy upload could be killed at 100%.
        if (event.loaded >= event.total) { enterAnswerPhase(); }
      }
      // Still idle-based in the answer phase: should Android's total (read from the stream's
      // `available()`) ever come up short, bytes that keep moving keep the request alive.
      armWatchdog(phase === 'answer' ? RESPONSE_TIMEOUT_MS : STALL_TIMEOUT_MS);
    };

    // Standard XHR (and the tests) fire this; React Native does not — see `onprogress`.
    xhr.upload.onloadend = () => {
      enterAnswerPhase();
      armWatchdog(RESPONSE_TIMEOUT_MS);
    };

    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        log(`stored (HTTP ${xhr.status}) after ${secondsSince(startedAt)}`, path);
        onProgress(1);
        resolve();
        return;
      }
      log(`storage refused it (HTTP ${xhr.status}) after ${secondsSince(startedAt)}`, path);
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
      // The bucket's MIME allowlist refused the file. storage-api answers 400 with
      // `error: "invalid_mime_type"` (its own statusCode field says 415).
      if (/invalid_mime_type|mime type .* is not supported/i.test(xhr.responseText)) {
        reject(new Error(unsupportedTypeMessage(kind)));
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
    xhr.onerror = () => {
      settle();
      log(`connection failed at ${percent}% (${phase}) after ${secondsSince(startedAt)}`, path);
      reject(new UploadNetworkError(
        'upload',
        'The connection dropped and the upload stopped. Check your signal and try again.',
      ));
    };
    xhr.onabort = () => {
      settle();
      // Worth distinguishing: "aborted" reads as something the user did, and someone
      // whose signal died would be left wondering what they pressed.
      if (stalled) {
        reject(new UploadNetworkError(
          'upload',
          'The connection stalled and the upload stopped. Check your signal and try again.',
        ));
        return;
      }
      log(`stopped by the app at ${percent}%`, path);
      reject(new Error('Upload aborted.'));
    };

    // Field order matters: cacheControl before the file part, mirroring supabase-js — storage-api's
    // streaming multipart parser reads the leading fields, then the trailing file stream.
    const formData = new FormData();
    formData.append('cacheControl', '3600');
    formData.append('', { uri: fileUri, name: fileName, type: contentType } as any);
    // Armed before the first byte: a connection that never opens at all produces no
    // progress event, so without this the watchdog would never start.
    armWatchdog(STALL_TIMEOUT_MS);
    log(`sending to ${bucket}`, path);
    try {
      xhr.send(formData);
    } catch (err) {
      // React Native builds the request body inside `send`; a throw there would otherwise
      // leave the watchdog and the network watch running for a request that never existed.
      settle();
      log('could not start the request', path, err);
      reject(err instanceof Error ? err : new Error('Upload failed to start.'));
    }
  });
}

/**
 * Exported for `uploadStallWatchdog.test.ts` ONLY.
 *
 * The watchdog is the half of this file that runs only when a connection misbehaves, so
 * it cannot be reached through `uploadTrackFile` without a real network. Named so that
 * nothing reaches for it by accident.
 */
export const __uploadFileUriWithProgressForTest = uploadFileUriWithProgress;

export const CHAT_MEDIA_BUCKET = 'chat-media';

/**
 * A disappearing chat photo or video (PROP-0011) into the PRIVATE `chat-media` bucket, streamed
 * the same way. `path` is `<conversation_id>/<uuid>.<ext>`; the bucket's insert policy checks
 * that the caller may write in that chat. There is no public URL — nobody reads it by path;
 * recipients get a short-lived link from the `chat-media` function.
 */
export function uploadChatMediaObject(
  path: string,
  fileUri: string,
  fileName: string,
  contentType: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const kind: TrackMediaKind = contentType.startsWith('video/') ? 'video' : 'cover';
  return uploadFileUriWithProgress(
    path, kind, fileUri, fileName, contentType, accessToken, () => {}, signal, CHAT_MEDIA_BUCKET,
  );
}

export async function uploadTrackFile(
  file: PickedFile,
  kind: TrackMediaKind,
  trackId: string,
  userId: string,
  accessToken: string,
  onProgress: UploadProgressCallback,
  /** Aborts the upload mid-way (see uploadFileUriWithProgress). */
  signal?: AbortSignal,
): Promise<string> {
  const ext = extensionFromName(file.name, defaultExtensionFor(kind, file.type));
  const path = `${userId}/${trackId}/${kind}.${ext}`;

  const readableUri = await resolveReadableUri(file);

  // The picker's type, under the spelling the bucket's allowlist is written against — iOS
  // calls WAV `audio/vnd.wave`, which the allowlist did not list (incident 2026-10-11) — or
  // the extension's when the picker gave none. Neither known: a wildcard the bucket refuses,
  // so an unplayable format is turned away at upload instead of guessed at (and stored
  // mislabelled) like the web client does. 'cover' and 'thumbnail' are both images.
  const isImage = kind === 'cover' || kind === 'thumbnail';
  const contentType = canonicalContentType(ext, file.type) ?? `${isImage ? 'image' : kind}/*`;
  const fileName = file.name ?? `${kind}.${ext}`;

  await uploadFileUriWithProgress(path, kind, readableUri, fileName, contentType, accessToken, onProgress, signal);

  const { data } = supabase.storage.from(TRACKS_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
