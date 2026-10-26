/**
 * On-device compression of a song or video BEFORE it is uploaded (ADR-0034).
 *
 * WHY
 * Uploads went to storage exactly as the phone recorded them — 4K/60 HEVC at ~38 Mbps,
 * 24-bit WAV at ~2 Mbps — and played back from there with no server-side transcoding (see
 * kb/architecture/media-pipeline.md). A listener on 4G gets 5–20 Mbps, so those files
 * buffered constantly. Compressing on the uploader's phone fixes the files at the source
 * and needs no backend change.
 *
 * WHAT REACHES STORAGE
 *   video → H.264 (never HEVC), longest side ≤ 1920, ≤ 30 fps, ~3.5 Mbps, AAC audio, MP4
 *           with the `moov` atom at the front (playback starts before the download ends)
 *   audio → AAC-LC 256 kbps in an `.m4a` (MP4) container
 * Both are formats the single engine (patched `react-native-video`) and the web already
 * play today, so nothing on the playback side changes.
 *
 * WHAT PASSES THROUGH UNTOUCHED
 *   - an MP4 that is already ≤ 1080p and ≤ 4 Mbps (re-encoding it only loses quality)
 *   - a lossy song (MP3, M4A/AAC, Ogg, Opus) — MP3 cannot exceed 320 kbps by spec, and
 *     the others are small by construction
 *   - anything whose compressed output is NOT smaller than the original
 *
 * FAIL-SAFE, ALWAYS
 * Compression is a best-effort optimisation of what is uploaded, never a gate on whether
 * it is uploaded: the native module missing, a codec refusing the input, a timeout, a
 * bigger output — every one of these falls back to uploading the original file, exactly as
 * before this existed. The only way out that is NOT a fallback is the caller's own abort
 * (the artist picked another file or left the screen), which rejects with `AbortError`.
 *
 * The native work is `react-native-compressor` (Nitro module, pinned exact, patched —
 * `patches/react-native-compressor+2.0.4.patch`: Android audio re-done as AAC/M4A via
 * MediaCodec instead of LAME MP3, plus a `maxFrameRate` cap). It is loaded lazily so that
 * a build without the native side (iOS before `pod install`, Jest) degrades to "upload the
 * original" instead of failing at import.
 */
import { resolveReadableUri, type PickedFile } from './uploads';

// ── Targets ─────────────────────────────────────────────────────────────────

/** Longest side of a compressed video — 1080×1920 for a portrait phone recording. */
export const VIDEO_MAX_LONG_SIDE = 1920;
/** Bitrate a compressed video is encoded at. Phones on 4G stream this comfortably. */
export const VIDEO_TARGET_BITRATE = 3_500_000;
/** Output frame rate cap: a 60 fps recording is encoded at 30. */
export const VIDEO_MAX_FPS = 30;
/** An MP4 at or under this (and ≤ 1080p) is already fine — it is uploaded as it is. */
export const VIDEO_PASSTHROUGH_MAX_BITRATE = 4_000_000;
/** AAC bitrate a compressed song is encoded at. Transparent for streaming. */
export const AUDIO_TARGET_BITRATE = 256_000;

/** A compressed song is `name.m4a`, declared as this (bucket allowlist spelling). */
export const COMPRESSED_AUDIO_TYPE = 'audio/x-m4a';
/** A compressed video is `name.mp4`, declared as this. */
export const COMPRESSED_VIDEO_TYPE = 'video/mp4';

/**
 * Lossy containers that are uploaded as they are. `webm`/`ogg` can carry Vorbis or Opus —
 * both small. Everything else (wav, aiff, flac, caf, …) is lossless or unknown → compress.
 */
const LOSSY_AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm']);

/** Reading a file's metadata should take well under a second; this bounds a hung probe. */
const METADATA_TIMEOUT_MS = 15_000;

// ── Decisions (pure, unit-tested) ───────────────────────────────────────────

export type VideoProbe = {
  width: number;
  height: number;
  /** seconds */
  duration: number;
  /** bytes */
  size: number;
  extension: string;
};

/**
 * Whether a video is worth re-encoding. Unknown metadata (a probe that failed) errs on
 * compressing — that is the whole point of this module — the native side then decides.
 */
export function videoNeedsCompression(probe: VideoProbe | null): boolean {
  if (!probe) { return true; }
  const longSide = Math.max(probe.width, probe.height);
  if (longSide > VIDEO_MAX_LONG_SIDE) { return true; }
  if (probe.extension.toLowerCase() !== 'mp4') { return true; }
  if (!(probe.duration > 0) || !(probe.size > 0)) { return true; }
  const bitsPerSecond = (probe.size * 8) / probe.duration;
  return bitsPerSecond > VIDEO_PASSTHROUGH_MAX_BITRATE;
}

/** Whether a song is worth re-encoding: lossless (or unknown) formats are, lossy ones are not. */
export function audioNeedsCompression(file: Pick<PickedFile, 'name' | 'type'>): boolean {
  const ext = extensionOf(file.name);
  if (ext && LOSSY_AUDIO_EXTENSIONS.has(ext)) { return false; }
  const type = file.type?.toLowerCase() ?? '';
  if (!ext && (type.includes('mpeg') || type.includes('mp3') || type.includes('m4a') || type.includes('aac') || type.includes('ogg'))) {
    return false;
  }
  return true;
}

/** The compressed file as the uploader sees it: the artist's name, the new extension. */
export function compressedPickedFile(
  original: PickedFile,
  kind: 'audio' | 'video',
  uri: string,
  size: number | null,
): PickedFile {
  const base = baseNameOf(original.name) ?? kind;
  return kind === 'video'
    ? { uri, name: `${base}.mp4`, type: COMPRESSED_VIDEO_TYPE, size }
    : { uri, name: `${base}.m4a`, type: COMPRESSED_AUDIO_TYPE, size };
}

function extensionOf(name: string | null): string | null {
  if (!name) { return null; }
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) { return null; }
  return name.slice(dot + 1).toLowerCase();
}

function baseNameOf(name: string | null): string | null {
  if (!name) { return null; }
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).trim();
  return base || null;
}

// ── The native module, loaded lazily ────────────────────────────────────────

type CompressorModule = {
  Video: {
    compress(
      fileUrl: string,
      options?: {
        compressionMethod?: 'auto' | 'manual';
        maxSize?: number;
        bitrate?: number;
        maxFrameRate?: number;
        getCancellationId?: (id: string) => void;
      },
      onProgress?: (fraction: number) => void,
    ): Promise<string>;
    cancelCompression(id: string): void;
  };
  Audio: {
    compress(fileUrl: string, options?: { bitrate?: number }): Promise<string>;
  };
  getVideoMetaData(path: string): Promise<VideoProbe>;
  getFileSize(path: string): Promise<string>;
};

let compressorModule: CompressorModule | null | undefined;

function loadCompressor(): CompressorModule | null {
  if (compressorModule !== undefined) { return compressorModule; }
  try {
    // Throws when the native side is not linked (iOS before `pod install`; a build that
    // predates the dependency). Loaded lazily so that is a missing feature, not a crash.
    compressorModule = require('react-native-compressor') as CompressorModule;
  } catch (err) {
    console.log(`[LIVIL][compress] unavailable: ${err instanceof Error ? err.message : String(err)}`);
    compressorModule = null;
  }
  return compressorModule;
}

/** Test seam: forget the loaded module so the next call re-requires it. */
export function __resetCompressorForTests(): void {
  compressorModule = undefined;
  prepared.clear();
}

// ── Preparing a file for upload ─────────────────────────────────────────────

export type PrepareOptions = {
  /** 0..1 while a video is being re-encoded; null while the fraction is unknown. */
  onProgress?: (fraction: number | null) => void;
  /** The caller no longer wants this file: a running re-encode is cancelled. */
  signal?: AbortSignal;
};

export class AbortError extends Error {
  constructor() {
    super('Preparation aborted.');
    this.name = 'AbortError';
  }
}

/**
 * The result is remembered per picked file, so a file that was prepared for the early
 * upload is not re-encoded when Post has to fall back to uploading everything itself.
 */
const prepared = new Map<string, Promise<PickedFile>>();

function cacheKey(file: PickedFile, kind: 'audio' | 'video'): string {
  return `${kind}:${file.uri}`;
}

/**
 * Returns the file to upload in place of `file`: a compressed copy when that is worth it
 * and succeeded, otherwise `file` itself (with an on-disk `file://` URI either way, so the
 * upload never has to copy it again). Rejects ONLY with `AbortError`, and only when
 * `signal` fired; every other problem resolves with the original file.
 */
export function prepareMediaForUpload(
  file: PickedFile,
  kind: 'audio' | 'video',
  options: PrepareOptions = {},
): Promise<PickedFile> {
  const key = cacheKey(file, kind);
  const existing = prepared.get(key);
  if (existing) { return existing; }
  const task = prepareUncached(file, kind, options).catch(err => {
    // Nothing to remember about an attempt that was cut short.
    prepared.delete(key);
    throw err;
  });
  prepared.set(key, task);
  return task;
}

async function prepareUncached(
  file: PickedFile,
  kind: 'audio' | 'video',
  { onProgress, signal }: PrepareOptions,
): Promise<PickedFile> {
  if (signal?.aborted) { throw new AbortError(); }
  // A `content://` pick becomes a real file first — the compressor and the upload both
  // read it from disk. Read failures carry their own user-facing message and would fail
  // the upload identically, so they are not swallowed here.
  const localUri = await resolveReadableUri(file);
  const local: PickedFile = localUri === file.uri ? file : { ...file, uri: localUri };
  if (signal?.aborted) { throw new AbortError(); }

  const compressor = loadCompressor();
  if (!compressor) { return local; }

  try {
    return kind === 'video'
      ? await prepareVideo(compressor, local, onProgress, signal)
      : await prepareAudio(compressor, local);
  } catch (err) {
    if (signal?.aborted) { throw new AbortError(); }
    console.log(`[LIVIL][compress] ${kind} fell back to the original: ${err instanceof Error ? err.message : String(err)}`);
    return local;
  }
}

async function prepareVideo(
  compressor: CompressorModule,
  local: PickedFile,
  onProgress: PrepareOptions['onProgress'],
  signal: AbortSignal | undefined,
): Promise<PickedFile> {
  const probe = await probeVideo(compressor, local.uri);
  if (!videoNeedsCompression(probe)) {
    console.log(`[LIVIL][compress] video passes through: ${describeVideo(probe, local.size)}`);
    return local;
  }
  onProgress?.(0);

  let cancellationId: string | null = null;
  const onAbort = () => { if (cancellationId) { compressor.Video.cancelCompression(cancellationId); } };
  signal?.addEventListener('abort', onAbort);
  let outputUri: string;
  try {
    outputUri = await compressor.Video.compress(
      local.uri,
      {
        compressionMethod: 'manual',
        maxSize: VIDEO_MAX_LONG_SIDE,
        bitrate: VIDEO_TARGET_BITRATE,
        maxFrameRate: VIDEO_MAX_FPS,
        getCancellationId: id => { cancellationId = id; },
      },
      fraction => onProgress?.(Math.min(1, Math.max(0, fraction))),
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) { throw new AbortError(); }
  if (!outputUri || outputUri === local.uri) {
    // The native side decided there was nothing to do.
    return local;
  }
  const output = await probeVideo(compressor, outputUri);
  const outputSize = output?.size ?? await fileSize(compressor, outputUri);
  if (!isSmaller(outputSize, local.size)) {
    console.log(`[LIVIL][compress] video output not smaller (${outputSize ?? '?'} vs ${local.size ?? '?'} bytes); keeping the original`);
    return local;
  }
  console.log(`[LIVIL][compress] video ${describeVideo(probe, local.size)} → ${describeVideo(output, outputSize)}`);
  onProgress?.(1);
  return compressedPickedFile(local, 'video', outputUri, outputSize);
}

async function prepareAudio(compressor: CompressorModule, local: PickedFile): Promise<PickedFile> {
  if (!audioNeedsCompression(local)) {
    console.log(`[LIVIL][compress] audio passes through: ${local.name ?? local.uri}`);
    return local;
  }
  const outputUri = await compressor.Audio.compress(local.uri, { bitrate: AUDIO_TARGET_BITRATE });
  if (!outputUri || outputUri === local.uri) { return local; }
  const outputSize = await fileSize(compressor, outputUri);
  if (!isSmaller(outputSize, local.size)) {
    console.log(`[LIVIL][compress] audio output not smaller (${outputSize ?? '?'} vs ${local.size ?? '?'} bytes); keeping the original`);
    return local;
  }
  console.log(`[LIVIL][compress] audio ${local.name ?? ''} ${formatMb(local.size)} → m4a ${formatMb(outputSize)}`);
  return compressedPickedFile(local, 'audio', outputUri, outputSize);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function probeVideo(compressor: CompressorModule, uri: string): Promise<VideoProbe | null> {
  try {
    const meta = await withTimeout(compressor.getVideoMetaData(uri), METADATA_TIMEOUT_MS);
    const width = Number(meta?.width);
    const height = Number(meta?.height);
    if (!(width > 0) || !(height > 0)) { return null; }
    return {
      width,
      height,
      duration: Number(meta?.duration) || 0,
      size: Number(meta?.size) || 0,
      extension: String(meta?.extension ?? '').toLowerCase(),
    };
  } catch {
    return null;
  }
}

async function fileSize(compressor: CompressorModule, uri: string): Promise<number | null> {
  try {
    const n = Number(await withTimeout(compressor.getFileSize(uri), METADATA_TIMEOUT_MS));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * "Smaller" only when both sizes are known. An unknown original size happens (the picker
 * gave none) and then the compressed copy is trusted — it was made to the targets above.
 * An unknown OUTPUT size is not trusted: a file we cannot even measure is not uploaded.
 */
function isSmaller(output: number | null, original: number | null): boolean {
  if (output == null) { return false; }
  if (original == null) { return true; }
  return output < original;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

function formatMb(bytes: number | null): string {
  return bytes == null ? '? MB' : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeVideo(probe: VideoProbe | null, size: number | null): string {
  if (!probe) { return `unknown ${formatMb(size)}`; }
  const mbps = probe.duration > 0 && probe.size > 0 ? `${((probe.size * 8) / probe.duration / 1_000_000).toFixed(1)} Mbps` : '? Mbps';
  return `${probe.width}×${probe.height} ${probe.extension} ${formatMb(size ?? probe.size)} ${mbps}`;
}
