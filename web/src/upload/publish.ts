/**
 * Glue between the browser's `File` objects and the shared, platform-agnostic
 * `publishTrack` orchestration.
 *
 * `shared/` deliberately knows nothing about `File` or TUS — it owns the row choreography
 * both clients must agree on, and nothing else.
 */
import {
  publishTrack,
  type PublishProgress,
  type PublishTrackResult,
} from '@shared/services/publishTrack';
import type { TrackMediaKind } from '@shared/services/media';
import { backfillWaveformPeaks } from '@shared/services/waveformStore';
import { uploadFileResumable } from './tusUpload';
import { analyzeLocalFile } from './waveform';

export type PickedMedia = {
  mode: 'audio' | 'video';
  /** The audio or video master. */
  media: File;
  /** Cover art for audio, or the feed thumbnail for video. Required either way. */
  image: File;
  title: string;
  description: string;
};

/**
 * Reads a media file's duration in the browser, without uploading it.
 *
 * Mobile captures this from the upload preview's `onLoad`; here a detached element does the
 * same job. Resolves null rather than rejecting — duration is optional on the row and
 * backfills on first play, so a file the browser cannot probe must not block publishing.
 */
export function readDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
    const cleanup = () => URL.revokeObjectURL(url);

    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const value = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      cleanup();
      resolve(value);
    };
    el.onerror = () => {
      cleanup();
      resolve(null);
    };
    el.src = url;
  });
}

export type PublishHandle = {
  result: Promise<PublishTrackResult>;
  abort: () => void;
};

export function startPublish(
  picked: PickedMedia,
  onProgress: (p: PublishProgress) => void,
): PublishHandle {
  const imageKind: TrackMediaKind = picked.mode === 'audio' ? 'cover' : 'thumbnail';
  const files = new Map<TrackMediaKind, File>([
    [picked.mode, picked.media],
    [imageKind, picked.image],
  ]);

  const inFlight: Array<{ abort: () => void }> = [];

  const result = (async () => {
    const durationSeconds = await readDuration(picked.media);

    // Started here, not awaited, so the CPU-bound decode+FFT overlaps the network-bound
    // upload instead of adding to it. Analysis runs for VIDEO too, unlike mobile — see
    // `analyzeLocalFile`.
    const analysis = analyzeLocalFile(picked.media).catch(() => null);

    const published = await publishTrack(
      {
        mode: picked.mode,
        title: picked.title,
        description: picked.description,
        durationSeconds,
        assets: [...files.entries()].map(([kind, file]) => ({
          kind,
          fileName: file.name,
          contentType: file.type || null,
          sizeBytes: file.size,
        })),
      },
      (asset, target, progress) => {
        const file = files.get(asset.kind);
        if (!file) throw new Error(`No file for ${asset.kind}`);
        const handle = uploadFileResumable(file, target, asset.kind, progress);
        inFlight.push(handle);
        return handle.done;
      },
      onProgress,
    );

    // Fire-and-forget: the track is already published and playable. A missing envelope
    // means the decorative wave, never a failed upload. The shared writer is idempotent
    // (`.is('waveform_peaks', null)`), so this cannot clobber a lazy backfill that landed
    // first from a phone.
    analysis
      .then(data => backfillWaveformPeaks(published.trackId, data))
      .catch(() => {
        /* already best-effort inside the writer */
      });

    return published;
  })();

  return {
    result,
    abort: () => {
      for (const h of inFlight) h.abort();
    },
  };
}
