/**
 * Resumable uploads to Supabase Storage over TUS.
 *
 * This is the capability the mobile app cannot have. `src/services/uploads.ts` records why:
 * React Native has no workable resumable upload — `tus-js-client` buffers the whole file
 * into memory there and OOM-crashes — so mobile streams a single multipart request with no
 * resume, and caps files at 500 MB to keep that survivable on cellular. A browser streams
 * from a `File` slice by slice, so a dropped connection costs one 6 MB chunk instead of a
 * 2 GB re-upload.
 */
import * as tus from 'tus-js-client';
import {
  MAX_WEB_UPLOAD_BYTES,
  TRACKS_MEDIA_BUCKET,
  tooLargeMessage,
  type TrackMediaKind,
} from '@shared/services/media';
import { supabase } from '../supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Supabase's TUS implementation requires exactly 6 MB chunks. This is not a tuning knob —
 * a different value is rejected by the server.
 */
const CHUNK_SIZE = 6 * 1024 * 1024;

export type UploadHandle = {
  /** Resolves with the object's public URL. */
  done: Promise<string>;
  abort: () => void;
};

export function uploadFileResumable(
  file: File,
  target: { path: string; contentType: string },
  kind: TrackMediaKind,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let upload: tus.Upload | null = null;

  const done = new Promise<string>((resolve, reject) => {
    if (file.size > MAX_WEB_UPLOAD_BYTES) {
      reject(new Error(tooLargeMessage(kind)));
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) {
        reject(new Error('Your session expired. Sign in again to upload.'));
        return;
      }

      upload = new tus.Upload(file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${token}`,
          // Never overwrite: the path is scoped by track id, so a collision means a bug
          // rather than a re-upload, and silently clobbering would destroy the original.
          'x-upsert': 'false',
        },
        // Storage derives the stored object's content type from this metadata, not from
        // the request headers.
        metadata: {
          bucketName: TRACKS_MEDIA_BUCKET,
          objectName: target.path,
          // Resolved against the bucket's MIME allowlist, NOT taken from `file.type` —
          // the browser reports an empty type for some files and the allowlist would
          // reject the octet-stream fallback.
          contentType: target.contentType,
          cacheControl: '3600',
        },
        chunkSize: CHUNK_SIZE,
        uploadDataDuringCreation: true,
        // Without this, a completed upload leaves a fingerprint in localStorage and a
        // later upload of the same file can try to resume an object that is already done.
        removeFingerprintOnSuccess: true,
        onProgress: (sent, total) => {
          if (total > 0) onProgress(sent / total);
        },
        onError: err => {
          const message = err instanceof Error ? err.message : String(err);
          if (/exceeded the maximum allowed|payload too large|entity too large|413/i.test(message)) {
            reject(new Error(tooLargeMessage(kind)));
            return;
          }
          reject(new Error(message || 'Upload failed.'));
        },
        onSuccess: () => {
          onProgress(1);
          const { data: pub } = supabase.storage
            .from(TRACKS_MEDIA_BUCKET)
            .getPublicUrl(target.path);
          resolve(pub.publicUrl);
        },
      });

      // Resume a previous attempt at the same object if one is recorded locally.
      upload
        .findPreviousUploads()
        .then(previous => {
          if (previous.length > 0 && previous[0]) {
            upload?.resumeFromPreviousUpload(previous[0]);
          }
          upload?.start();
        })
        .catch(() => {
          // A unreadable fingerprint store is not a reason to refuse the upload —
          // start fresh instead.
          upload?.start();
        });
    }, reject);
  });

  return {
    done,
    abort: () => {
      upload?.abort(true).catch(() => {
        /* nothing to recover: the caller is already tearing this down */
      });
    },
  };
}
