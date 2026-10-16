import { supabase } from '../../lib/supabase';
import type { Json } from '../../lib/database.types';
import type { PendingCollaborator } from '../constants/roles';
import { MAX_TAGS_PER_TRACK, normalizeTags } from '../../shared/constants/tags';
import {
  uploadTrackFile,
  resolveReadableUri,
  TRACKS_MEDIA_BUCKET,
  type PickedFile,
} from './uploads';
import {
  acknowledgeScan,
  needsAcknowledgement,
  scanUpload,
  type RightsDeclaration,
  type ScanResult,
} from '../../shared/services/copyrightScan';
import { recordUploadConsent } from '../../shared/services/uploadConsent';
import { TERMS_VERSION } from '../constants/termsContent';
import { APP_VERSION_NAME } from '../constants/appVersion';
import { analyzeWaveformPeaks, WAVEFORM_VERSION, type WaveformData } from './waveform';
import { resolveAuthorById, resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PostMode = 'audio' | 'video';

export type CreateTrackInput =
  | {
      mode: 'audio';
      title: string;
      description?: string;
      audio: PickedFile;
      cover: PickedFile;
      /**
       * What the uploader did on their own track — one or more (up to MAX_UPLOADER_ROLES),
       * each saved as its own credit, the way a collaborator with two jobs gets two.
       */
      uploaderRoles: string[];
      collaborators: PendingCollaborator[];
      /** Tags. Normalized on the way in by `shared/constants/tags.ts` — see the insert. */
      tags?: string[];
      /** Track length in seconds, captured from the upload preview's onLoad.
       *  Saved to duration_seconds so feed/profile cards show the length before
       *  the post is ever played. Omit/null if not yet known (backfills on play). */
      durationSeconds?: number | null;
      /**
       * The per-upload streaming grant, ticked by the uploader beside the post button.
       * Must be `true`: `createTrack` refuses to upload anything without it, so the
       * `terms_acceptances` row it writes is never a consent nobody was asked for.
       */
      streamingGrantAccepted: boolean;
    }
  | {
      mode: 'video';
      title: string;
      description?: string;
      /**
       * What the uploader did on their own track — one or more (up to MAX_UPLOADER_ROLES),
       * each saved as its own credit, the way a collaborator with two jobs gets two.
       */
      uploaderRoles: string[];
      video: PickedFile;
      cover?: PickedFile;
      /** Required for video uploads — the thumbnail shown in the feed PostCard
       *  preview. Validated client-side; the column is nullable so legacy rows
       *  remain readable. */
      thumbnail: PickedFile;
      collaborators: PendingCollaborator[];
      /** Tags. Normalized on the way in by `shared/constants/tags.ts` — see the insert. */
      tags?: string[];
      /** Track length in seconds, captured from the upload preview's onLoad.
       *  Saved to duration_seconds so feed/profile cards show the length before
       *  the post is ever played. Omit/null if not yet known (backfills on play). */
      durationSeconds?: number | null;
      /**
       * The per-upload streaming grant, ticked by the uploader beside the post button.
       * Must be `true`: `createTrack` refuses to upload anything without it, so the
       * `terms_acceptances` row it writes is never a consent nobody was asked for.
       */
      streamingGrantAccepted: boolean;
    };

export type CreateTrackResult = {
  trackId: string;
  postId: string;
  audioUrl?: string;
  videoUrl?: string;
  coverArtUrl?: string;
  thumbnailUrl?: string;
};

export type CreateTrackStage = 'preparing' | 'uploading' | 'checking' | 'finalizing';

export type CreateTrackProgress = {
  stage: CreateTrackStage;
  fraction: number;
};

export type CreateTrackProgressCallback = (progress: CreateTrackProgress) => void;

/**
 * Asked when an upload matches a known commercial recording — see
 * `shared/services/copyrightScan.ts`.
 *
 * Resolve with what the uploader chose. `'cancelled'` aborts the publish: it throws
 * inside `createTrack`, which routes into the existing catch and its `safeDeleteTrack`
 * cleanup, so the track is removed and NO post is ever created. That ordering is the
 * whole reason the question is asked here rather than after publishing — a post that
 * appears and is then withdrawn has already been in somebody's feed.
 *
 * A match is not a finding of infringement. The uploader may legitimately own the
 * recording or hold permission, and the answer is recorded either way.
 */
export type CopyrightMatchPrompt = (result: ScanResult) => Promise<RightsDeclaration>;

/** Thrown when the uploader backs out at the copyright question. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'UploadCancelledError';
  }
}

async function safeDeleteTrack(trackId: string): Promise<void> {
  try {
    await supabase.from('tracks').delete().eq('id', trackId);
  } catch {
    // Best-effort cleanup; the orphan row will fail RLS for everyone but the uploader anyway.
  }
}

/**
 * Remove objects uploaded by a publish that then failed or was cancelled.
 *
 * Mirrors `safeRemoveObjects` in `shared/services/publishTrack.ts`, which fixed this on
 * web and describes it as "the worst kind of leak": deleting the row leaves the FILES —
 * a full master in a public bucket with nothing referencing it. The uploader cannot see
 * it (no row), no cleanup path touches it, and account deletion does not reach storage
 * objects, so it survives indefinitely at a URL anyone holding it can fetch.
 *
 * Mobile never had this half, so every failed upload since launch has leaked. Added with
 * the copyright scan because the scan introduces a route that leaks BY DESIGN otherwise:
 * an uploader shown a match and choosing to back out is precisely the case where the
 * file must not remain fetchable.
 *
 * Best-effort. It runs while already handling a failure, so it must never throw and mask
 * the real error. Removing a path that was never written is a no-op, so the planned
 * paths can be passed without tracking which uploads actually completed.
 */
async function safeRemoveUploadedObjects(userId: string, trackId: string): Promise<void> {
  try {
    const prefix = `${userId}/${trackId}`;
    const { data } = await supabase.storage.from(TRACKS_MEDIA_BUCKET).list(prefix);
    const paths = (data ?? []).map(o => `${prefix}/${o.name}`);
    if (paths.length === 0) { return; }
    await supabase.storage.from(TRACKS_MEDIA_BUCKET).remove(paths);
  } catch {
    // Best-effort; nothing downstream depends on this having succeeded.
  }
}

/**
 * Backfill duration_seconds the first time a track's real length is known — from
 * the player's onLoad. Older rows (and any upload where the preview duration
 * wasn't captured) have a null duration_seconds, which makes feed/profile cards
 * show "0:00" until the post is the active track. The `.is(..., null)` guard
 * makes this idempotent (only the first writer sets it) so it's safe to call on
 * every play. Owner-only via RLS; a non-owner's attempt simply no-ops.
 * Fire-and-forget — never throws.
 */
export async function backfillTrackDuration(trackId: string, seconds: number): Promise<void> {
  if (!trackId || !Number.isFinite(seconds) || seconds <= 0) { return; }
  try {
    await supabase
      .from('tracks')
      .update({ duration_seconds: Math.round(seconds) })
      .eq('id', trackId)
      .is('duration_seconds', null);
  } catch {
    // Best-effort; backfills on a later play if this attempt fails.
  }
}

// ─── Waveform peaks (beat-synced visualizer, Tier B) ─────────────────────────
//
// The loudness envelope is computed on-device (react-native-audio-api decode →
// RMS buckets, see ./waveform) and stored once on tracks.waveform_peaks. The DB
// read/write + an in-memory cache live HERE so ./waveform stays a pure analyzer
// with no Supabase import (tracks → waveform only, no cycle).

/** A non-empty array of finite numbers, or undefined (for optional v2 channels). */
function numArray(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number')
    ? (v as number[])
    : undefined;
}

/** Validate the jsonb blob coming back from the DB into a WaveformData (or null).
 *  Carries the optional v2 channels (bass/flux/centroid/sr) through; a v1 row
 *  (peaks only) parses fine and is treated as stale by getOrAnalyzeWaveform. */
function parseWaveformData(raw: unknown): WaveformData | null {
  if (!raw || typeof raw !== 'object') { return null; }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.hz !== 'number' || obj.hz <= 0) { return null; }
  if (!Array.isArray(obj.peaks) || obj.peaks.length === 0) { return null; }
  if (!obj.peaks.every(p => typeof p === 'number')) { return null; }
  const peaks = obj.peaks as number[];
  // A v2 channel must match peaks length or it's dropped — a misaligned channel
  // would otherwise lerp into the wrong positions (or flatline past its end).
  const aligned = (v: unknown): number[] | undefined => {
    const a = numArray(v);
    return a && a.length === peaks.length ? a : undefined;
  };
  return {
    version: typeof obj.version === 'number' ? obj.version : 0,
    hz: obj.hz,
    peaks,
    sr: typeof obj.sr === 'number' ? obj.sr : undefined,
    bass: aligned(obj.bass),
    flux: aligned(obj.flux),
    centroid: aligned(obj.centroid),
  };
}

/*
 * There is no `getTrackTags` here on purpose. Nothing on this client reads a track's tags:
 * they are an input to search (`searchPosts` matches them server-side) and to the suggestion
 * engine, never something a listener is shown. Mobile writes them at upload and stops.
 */

/** Read a track's stored envelope. Returns null when absent/unanalyzed/malformed. */
export async function getWaveformPeaks(trackId: string): Promise<WaveformData | null> {
  if (!trackId) { return null; }
  try {
    const { data, error } = await supabase
      .from('tracks')
      .select('waveform_peaks')
      .eq('id', trackId)
      .maybeSingle();
    if (error || !data) { return null; }
    return parseWaveformData(data.waveform_peaks);
  } catch {
    return null;
  }
}

/**
 * Persist a computed envelope the first time it's known. Mirrors
 * `backfillTrackDuration`: fire-and-forget, never throws, idempotent via
 * `.is('waveform_peaks', null)` so only the first writer sets it (safe to call on
 * every play). Owner-only via RLS; a non-owner's attempt simply no-ops.
 */
export async function backfillWaveformPeaks(trackId: string, data: WaveformData): Promise<void> {
  if (!trackId || !data || !Array.isArray(data.peaks) || data.peaks.length === 0) { return; }
  try {
    await supabase
      .from('tracks')
      .update({ waveform_peaks: data as unknown as Json })
      .eq('id', trackId)
      .is('waveform_peaks', null);
  } catch {
    // Best-effort; backfills on a later play if this attempt fails.
  }
}

/**
 * OVERWRITING persist — used when re-analysis produced a NEWER version than what's
 * stored (the null-guarded `backfillWaveformPeaks` can't upgrade an existing row).
 * Owner-only via RLS (a non-owner's attempt no-ops, so they just re-analyze in
 * memory each session until the owner replays). Fire-and-forget, never throws.
 */
async function writeWaveformPeaks(trackId: string, data: WaveformData): Promise<void> {
  if (!trackId || !data || !Array.isArray(data.peaks) || data.peaks.length === 0) { return; }
  try {
    await supabase
      .from('tracks')
      .update({ waveform_peaks: data as unknown as Json })
      .eq('id', trackId);
  } catch {
    // Best-effort; re-analyzes again on a later play if this fails.
  }
}

// Session caches: successful envelopes by trackId, plus in-flight de-dup so the
// active track is never analyzed twice concurrently. Failures aren't cached, so a
// transient miss retries on the next play.
const waveformCache = new Map<string, WaveformData>();
const waveformInFlight = new Map<string, Promise<WaveformData | null>>();

/**
 * Resolve the envelope for the currently-active track: cache → DB → (if still
 * unanalyzed) decode the remote URL on-device, persist, and cache. Returns null
 * when nothing is usable yet (the wave then stays decorative). Never throws.
 */
export async function getOrAnalyzeWaveform(
  trackId: string,
  url: string | undefined,
  mediaKind: 'audio' | 'video' = 'audio',
): Promise<WaveformData | null> {
  if (!trackId) { return null; }
  // AUDIO-ONLY hard guard, enforced at the API boundary (not just at the
  // FloatingPlayer call site): decoding a video URL pulls the whole (huge) file
  // into memory → OutOfMemoryError → the process is killed. A future caller that
  // passes a video URL gets a safe null + a decorative wave instead of a crash.
  if (mediaKind !== 'audio') { return null; }
  const cached = waveformCache.get(trackId);
  if (cached) { return cached; }
  const inflight = waveformInFlight.get(trackId);
  if (inflight) { return inflight; }

  const task = (async (): Promise<WaveformData | null> => {
    const stored = await getWaveformPeaks(trackId);
    // Current-version row → use as-is. A STALE row (older analyzer version) or a
    // null row falls through to re-analysis below so old tracks upgrade on play.
    if (stored && stored.version >= WAVEFORM_VERSION) { waveformCache.set(trackId, stored); return stored; }
    if (!url) {
      // Nothing to re-analyze from — fall back to a stale row if we have one
      // (the old wave) rather than nothing.
      if (stored) { waveformCache.set(trackId, stored); return stored; }
      return null;
    }
    const computed = await analyzeWaveformPeaks(url);
    if (!computed) {
      // Re-analysis failed — keep showing the stale row if present.
      if (stored) { waveformCache.set(trackId, stored); return stored; }
      return null;
    }
    waveformCache.set(trackId, computed);
    // OVERWRITE: upgrades a stale row (and writes a first-time null row too).
    writeWaveformPeaks(trackId, computed).catch(() => {});
    return computed;
  })();

  waveformInFlight.set(trackId, task);
  try {
    return await task;
  } finally {
    waveformInFlight.delete(trackId);
  }
}

/**
 * Analyze a freshly-uploaded track from its LOCAL file (no re-download) and
 * persist the envelope. Fire-and-forget from createTrack's finalizing stage —
 * never blocks or fails the upload; if it can't decode (e.g. some video
 * containers) the column stays null and the wave backfills lazily on first play.
 */
function kickoffWaveformAnalysisFromLocalFile(trackId: string, file: PickedFile | undefined): void {
  if (!file) { return; }
  (async () => {
    try {
      const readable = await resolveReadableUri(file);
      const data = await analyzeWaveformPeaks(readable);
      if (data) {
        waveformCache.set(trackId, data);
        await backfillWaveformPeaks(trackId, data);
      }
    } catch (err) {
      // Best-effort; lazy backfill on first play covers any failure here. Log it
      // so an upload-time decode/URI failure isn't completely invisible.
      console.log(`[LIVIL][WAVE] upload analyze failed trackId=${trackId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  })().catch(() => {});
}

// Re-export so callers (e.g. a future re-analysis flow) can compare versions.
export { WAVEFORM_VERSION };

/** How many roles an uploader can give themselves on one track. */
export const MAX_UPLOADER_ROLES = 5;

/**
 * The uploader's roles as they will be saved: trimmed, empty ones dropped, duplicates
 * (ignoring case) dropped, at most MAX_UPLOADER_ROLES. `track_collaborators_role_check`
 * allows 1–40 characters, and the screen caps the field at 40.
 */
function uploaderRolesOf(input: CreateTrackInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.uploaderRoles) {
    const role = raw.trim().slice(0, 40);
    const key = role.toLowerCase();
    if (!role || seen.has(key)) { continue; }
    seen.add(key);
    out.push(role);
  }
  return out.slice(0, MAX_UPLOADER_ROLES);
}

type UploadPlan = {
  audio?: PickedFile;
  video?: PickedFile;
  cover?: PickedFile;
  thumbnail?: PickedFile;
};

function planFromInput(input: CreateTrackInput): UploadPlan {
  if (input.mode === 'audio') {
    return { audio: input.audio, cover: input.cover };
  }
  return { video: input.video, cover: input.cover, thumbnail: input.thumbnail };
}

function computeWeights(plan: UploadPlan): {
  audio: number;
  video: number;
  cover: number;
  thumbnail: number;
} {
  const audioBytes = plan.audio ? plan.audio.size ?? 1_000_000 : 0;
  const videoBytes = plan.video ? plan.video.size ?? 1_000_000 : 0;
  const coverBytes = plan.cover ? plan.cover.size ?? 100_000 : 0;
  const thumbBytes = plan.thumbnail ? plan.thumbnail.size ?? 100_000 : 0;
  const total = audioBytes + videoBytes + coverBytes + thumbBytes;
  if (total <= 0) {
    return { audio: 1, video: 0, cover: 0, thumbnail: 0 };
  }
  return {
    audio: audioBytes / total,
    video: videoBytes / total,
    cover: coverBytes / total,
    thumbnail: thumbBytes / total,
  };
}

export async function createTrack(
  input: CreateTrackInput,
  onProgress?: CreateTrackProgressCallback,
  onCopyrightMatch?: CopyrightMatchPrompt,
): Promise<CreateTrackResult> {
  const title = input.title.trim();
  if (!title) {
    throw new Error('Title is required.');
  }

  if (input.mode === 'audio') {
    if (!input.audio) {throw new Error('Audio file is required.');}
    if (!input.cover) {throw new Error('Cover image is required for audio posts.');}
  } else {
    if (!input.video) {throw new Error('Video file is required.');}
    if (!input.thumbnail) {throw new Error('Thumbnail image is required for video posts.');}
  }

  if (uploaderRolesOf(input).length === 0) {
    throw new Error('Choose what you did on this track.');
  }

  // The screen disables its button until this is ticked; checked again here so a future
  // caller cannot upload — and record a consent row — without having asked.
  if (input.streamingGrantAccepted !== true) {
    throw new Error('Tick the box to let Livil stream this recording.');
  }

  // Before anything uploads, like every other check here. `normalizeTags` guarantees the
  // rest of `tracks_tags_valid` by construction, so the cap is the only rule the database
  // could still reject — and rejecting it here costs a message instead of a whole upload.
  const tags = normalizeTags(input.tags ?? []);
  if (tags.length > MAX_TAGS_PER_TRACK) {
    throw new Error(`Up to ${MAX_TAGS_PER_TRACK} tags per track.`);
  }

  onProgress?.({ stage: 'preparing', fraction: 0 });

  const [
    { data: userData, error: userError },
    { data: sessionData },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);

  const user = userData?.user;
  const accessToken = sessionData.session?.access_token;

  if (userError || !user || !accessToken) {
    throw new Error('You must be signed in to upload a track.');
  }

  const description = input.description?.trim() ? input.description.trim() : null;

  // Insert the track row up front so we have an id to scope storage paths to.
  // For video posts we leave audio_url null; the constraint allows that as long as
  // video_url is set, which we fill in once uploads finish.
  const { data: inserted, error: insertError } = await supabase
    .from('tracks')
    .insert({
      uploader_id: user.id,
      title,
      description,
      // NULL rather than an empty array when untagged — `tracks_tags_valid` allows only one
      // representation of "no tags", so every query downstream has one case to handle.
      tags: tags.length > 0 ? tags : null,
      media_kind: input.mode,
      audio_url: input.mode === 'audio' ? 'pending://placeholder' : null,
      video_url: input.mode === 'video' ? 'pending://placeholder' : null,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'Failed to create track.');
  }

  const trackId = inserted.id;
  const plan = planFromInput(input);
  const weights = computeWeights(plan);

  let audioFrac = 0;
  let videoFrac = 0;
  let coverFrac = 0;
  let thumbFrac = 0;
  const reportOverall = () => {
    const fraction =
      weights.audio * audioFrac
      + weights.video * videoFrac
      + weights.cover * coverFrac
      + weights.thumbnail * thumbFrac;
    onProgress?.({ stage: 'uploading', fraction: Math.min(1, Math.max(0, fraction)) });
  };

  try {
    onProgress?.({ stage: 'uploading', fraction: 0 });

    const [audioUrl, videoUrl, coverArtUrl, thumbnailUrl] = await Promise.all([
      plan.audio
        ? uploadTrackFile(plan.audio, 'audio', trackId, user.id, accessToken, f => {
            audioFrac = f;
            reportOverall();
          })
        : Promise.resolve<string | undefined>(undefined),
      plan.video
        ? uploadTrackFile(plan.video, 'video', trackId, user.id, accessToken, f => {
            videoFrac = f;
            reportOverall();
          })
        : Promise.resolve<string | undefined>(undefined),
      plan.cover
        ? uploadTrackFile(plan.cover, 'cover', trackId, user.id, accessToken, f => {
            coverFrac = f;
            reportOverall();
          })
        : Promise.resolve<string | undefined>(undefined),
      plan.thumbnail
        ? uploadTrackFile(plan.thumbnail, 'thumbnail', trackId, user.id, accessToken, f => {
            thumbFrac = f;
            reportOverall();
          })
        : Promise.resolve<string | undefined>(undefined),
    ]);

    return await finishTrack({
      trackId,
      userId: user.id,
      input,
      description,
      tags,
      urls: { audioUrl, videoUrl, coverArtUrl, thumbnailUrl },
      scan: onCopyrightMatch ? { kind: 'ask', onCopyrightMatch } : { kind: 'skip' },
      onProgress,
    });
  } catch (err) {
    await safeDeleteTrack(trackId);
    await safeRemoveUploadedObjects(user.id, trackId);
    throw err;
  }
}

/**
 * Everything after the files are in storage: the row's final fields, the copyright scan,
 * credits, the post, the streaming grant. Shared by `createTrack` (all files uploaded at
 * Post) and `publishStagedTrack` (the song or video was uploaded and checked while the
 * artist filled in the rest). Throws on failure; the caller owns the rollback.
 */
async function finishTrack({
  trackId,
  userId,
  input,
  description,
  tags,
  urls,
  scan,
  onProgress,
}: {
  trackId: string;
  userId: string;
  input: CreateTrackInput;
  description: string | null;
  tags: string[];
  urls: { audioUrl?: string; videoUrl?: string; coverArtUrl?: string; thumbnailUrl?: string };
  /**
   * `ask`: scan now and ask on a match (createTrack). `answered`: the song was scanned when
   * it was staged and the uploader already answered (or nothing matched) — record the answer
   * now that there is a post. `skip`: no question can be asked.
   */
  scan:
    | { kind: 'ask'; onCopyrightMatch: CopyrightMatchPrompt }
    | { kind: 'answered'; declaration: RightsDeclaration | null }
    | { kind: 'skip' };
  onProgress?: CreateTrackProgressCallback;
}): Promise<CreateTrackResult> {
  const { audioUrl, videoUrl, coverArtUrl, thumbnailUrl } = urls;
  onProgress?.({ stage: 'finalizing', fraction: 1 });

  // Persist the captured length when we have it. Conditional so an unknown
  // duration leaves the column null (it backfills on first play) rather than
  // overwriting it with 0.
  const durationSeconds =
    typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? Math.round(input.durationSeconds)
      : null;

  // Title, description and tags too: a staged song's row was inserted with a provisional
  // title before the artist had typed one.
  const { error: updateError } = await supabase
    .from('tracks')
    .update({
      title: input.title.trim(),
      description,
      tags: tags.length > 0 ? tags : null,
      audio_url: audioUrl ?? null,
      video_url: videoUrl ?? null,
      cover_art_url: coverArtUrl ?? null,
      thumbnail_url: thumbnailUrl ?? null,
      ...(durationSeconds !== null ? { duration_seconds: durationSeconds } : {}),
    })
    .eq('id', trackId);

  if (updateError) {
    throw new Error(`Failed to finalize track: ${updateError.message}`);
  }

  // ── Copyright scan ───────────────────────────────────────────────────────
  //
  // After the media has its final URL and before any post exists: earlier there is
  // nothing for the provider to fetch (the row still holds its `pending://`
  // placeholder); later the post row exists, and a post that is published and then
  // withdrawn has already been seen. A staged upload (`stageMediaUpload`) hits the same
  // moment, just earlier — while the rest of the form is being filled in, not at Post.
  //
  // Entirely fail-safe. `scanUpload` resolves rather than throwing, so a provider
  // outage or an undeployed function costs a `failed` row and nothing else — the
  // upload proceeds. The ONLY path that stops a publish is the uploader choosing to
  // stop it, and that throw reaches the caller's rollback, which already knows how to
  // undo everything written so far.
  //
  // A match is not a finding of infringement: covers do not match at all, and a
  // creator may legitimately own or be licensed for the recording. It asks; it does
  // not judge.
  // Recorded only once the post exists (below): an answer row outlives its track, so one
  // written before a failed post insert would describe an upload that never went out.
  let declarationToRecord: RightsDeclaration | null = null;
  if (scan.kind === 'answered') {
    // Scanned (and answered) when the song was staged.
    declarationToRecord = scan.declaration;
  } else if (scan.kind === 'ask') {
    // The whole song, as at staging: a staged upload whose check did not finish, or one
    // that was never staged (its early upload failed) — checked while the uploader waits.
    onProgress?.({ stage: 'checking', fraction: 1 });
    const result = await scanUpload(supabase, trackId, { fullSong: true });
    onProgress?.({ stage: 'finalizing', fraction: 1 });
    if (needsAcknowledgement(result)) {
      const answer = await scan.onCopyrightMatch(result);
      if (answer.acknowledgement === 'cancelled') {
        // Deliberately NOT recorded. The caller's rollback deletes the track, so a
        // write here would describe an upload that never happened.
        // Keeping "this person started an upload that matched, then thought better of
        // it" would mean retaining a behavioural note about somebody who published
        // nothing, which is a surveillance question and not this feature's to answer.
        throw new UploadCancelledError();
      }
      declarationToRecord = answer;
    }
  }

  // Compute the beat-synced loudness envelope from the LOCAL file (no
  // re-download) and persist it. Fire-and-forget: a slow/failed decode must
  // never delay or break the post — old/unanalyzed audio tracks backfill lazily
  // on first play instead. AUDIO ONLY: decoding a (large) video file risks OOM,
  // and the lazy remote path can't safely re-fetch a video either, so video
  // posts intentionally have no envelope (the wave stays decorative).
  if (input.mode === 'audio') {
    kickoffWaveformAnalysisFromLocalFile(trackId, input.audio);
  }

  // The uploader's own credit goes in with everybody else's. `accepted` because it is
  // self-declared — nobody confirms what you say you did on your own record, and the
  // notification trigger skips self-credits anyway.
  const collabRows = [
    ...uploaderRolesOf(input).map(role => ({
      track_id: trackId,
      user_id: userId,
      custom_name: null,
      role,
      status: 'accepted',
    })),
    ...input.collaborators.map(c => ({
      track_id: trackId,
      user_id: c.kind === 'user' ? c.userId ?? null : null,
      custom_name: c.kind === 'custom' ? c.name : null,
      role: c.role,
      status: 'pending',
    })),
  ];

  const { error: collabError } = await supabase
    .from('track_collaborators')
    .insert(collabRows);

  if (collabError) {
    throw new Error(`Failed to save collaborators: ${collabError.message}`);
  }

  // Create the matching upload-kind post. The post's caption mirrors the description so
  // the feed UI only ever has to read from posts.caption.
  const { data: postRow, error: postError } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      kind: 'upload',
      track_id: trackId,
      caption: description,
    })
    .select('id')
    .single();

  if (postError || !postRow) {
    throw new Error(`Failed to create post: ${postError?.message ?? 'unknown error'}`);
  }

  // Not awaited: an acknowledgement that fails to land must not cost a creator an upload
  // they were entitled to make. It is logged rather than surfaced, because this is the half
  // of the feature with evidential value and a silent loss here should still be visible.
  if (declarationToRecord) {
    void acknowledgeScan(supabase, trackId, declarationToRecord).then(ok => {
      if (!ok) { console.log('[LIVIL][copyright] acknowledgement not recorded', trackId); }
    });
  }

  // ── The streaming grant ──────────────────────────────────────────────────
  //
  // Recorded on EVERY upload, which is the point: the copyright form only appears when
  // a scan matches, so a grant captured there alone would cover the exception and miss
  // the rule. The uploader ticked it beside the post button — see the guard at the top.
  //
  // AFTER the post exists, not before. `terms_acceptances` is append-only with no
  // foreign key to `tracks`, so a row written earlier would outlive a track that was
  // then cancelled at the copyright question or rolled back on a failed insert —
  // recording a grant for something that was never published.
  //
  // Fire-and-forget by design: failing the publish because a consent row did not land
  // would cost a creator their upload over bookkeeping. A missing row shows as an
  // absence in the operator view, which is the honest way for this to fail.
  void recordUploadConsent(supabase, trackId, TERMS_VERSION, APP_VERSION_NAME).then(ok => {
    if (!ok) { console.log('[LIVIL][consent] upload grant not recorded', trackId); }
  });

  return {
    trackId,
    postId: postRow.id,
    audioUrl: audioUrl ?? undefined,
    videoUrl: videoUrl ?? undefined,
    coverArtUrl: coverArtUrl ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
  };
}

// ─── Early upload ("staging") ────────────────────────────────────────────────
//
// The song or video is uploaded and copyright-checked while the artist is still filling in
// the details — so a match is raised before they have typed anything, and Post at the end
// only has the pictures and the post to do. A song starts the moment it is picked. A video
// starts when the artist moves on from its step (the screen decides): it can be hundreds
// of MB, so it waits for the "yes, this one" of leaving the preview rather than uploading
// a wrong pick over mobile data — and a swap stops it mid-way (`signal`).
//
// A staged upload is a `tracks` row with a real media URL and NO post. Nothing lists a
// track without its post, so it is invisible until published — but it is a file in the
// bucket, so every way out of the upload screen has to remove it:
//   • a different file picked, or the file removed      → the screen discards it
//   • the screen closed without posting                 → the screen discards it
//   • the app killed mid-way                            → `sweepStagedUploads` on the next
//                                                          visit, from the ids remembered
//                                                          on this device
// A MATCH IS NOT ASKED ABOUT HERE. Staging resolves with the scan, and the screen asks on
// the artist's own tap (or at Post). An unprompted dialog would arrive while the photo
// picker, the collaborator picker, the album sheet or the full-screen preview is open, and
// iOS refuses to present a second one — the question would never show and Post would wait
// on it forever. The answer is recorded only at publish, after the post exists.

const STAGED_KEY = 'livil.upload.staged.v1';

type StagedRef = { trackId: string; userId: string };

async function readStaged(): Promise<StagedRef[]> {
  try {
    const raw = await AsyncStorage.getItem(STAGED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(r => r && r.trackId && r.userId) : [];
  } catch {
    return [];
  }
}

async function writeStaged(list: StagedRef[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STAGED_KEY, JSON.stringify(list));
  } catch {
    // Best-effort: worst case a killed app leaves one invisible file behind.
  }
}

// Read-modify-write on one key, from a sweep and a staging that can run at once: queued
// so one cannot write back a list that is missing the other's entry.
let stagedLock: Promise<void> = Promise.resolve();
function withStagedLock(fn: () => Promise<void>): Promise<void> {
  const next = stagedLock.then(fn, fn);
  stagedLock = next.catch(() => {});
  return next;
}

function rememberStaged(ref: StagedRef): Promise<void> {
  return withStagedLock(async () => {
    const list = await readStaged();
    await writeStaged([...list.filter(r => r.trackId !== ref.trackId), ref]);
  });
}

function forgetStaged(trackId: string): Promise<void> {
  return withStagedLock(async () => {
    const list = await readStaged();
    await writeStaged(list.filter(r => r.trackId !== trackId));
  });
}

export type StagedUpload = {
  trackId: string;
  userId: string;
  mediaKind: 'audio' | 'video';
  /** The song's `audio_url` or the video's `video_url`. */
  mediaUrl: string;
  scan: ScanResult;
  /** What the uploader answered at the copyright question; null when nothing matched. */
  declaration: RightsDeclaration | null;
};

export type StageProgress = { stage: 'uploading' | 'checking'; fraction: number };

/** The screen dropped this file (picked another, removed it, left) before staging finished. */
export class StagingAbandonedError extends Error {
  constructor() {
    super('Staging abandoned.');
    this.name = 'StagingAbandonedError';
  }
}

/** A provisional title — the column is NOT NULL, 1–120 chars — until the artist types one. */
function provisionalTitle(file: PickedFile): string {
  const base = (file.name ?? '').replace(/\.[^.]+$/, '').trim();
  return (base || 'Untitled').slice(0, 120);
}

/**
 * Upload the song or video and run the copyright check on it, now. Resolves with the staged
 * track and its scan; a match is the screen's to ask about (see above). `isAbandoned` is
 * polled between steps and `signal` stops the file upload itself: once the screen has moved
 * on, whatever was written is removed and `StagingAbandonedError` thrown. Any other failure
 * also removes what was written and rethrows — the screen then falls back to the classic
 * all-at-Post `createTrack`.
 */
export async function stageMediaUpload(
  file: PickedFile,
  mediaKind: 'audio' | 'video',
  onProgress: (p: StageProgress) => void,
  isAbandoned: () => boolean,
  signal?: AbortSignal,
): Promise<StagedUpload> {
  const [
    { data: userData, error: userError },
    { data: sessionData },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
  const user = userData?.user;
  const accessToken = sessionData.session?.access_token;
  if (userError || !user || !accessToken) {
    throw new Error('You must be signed in to upload a track.');
  }
  if (isAbandoned()) { throw new StagingAbandonedError(); }

  const { data: inserted, error: insertError } = await supabase
    .from('tracks')
    .insert({
      uploader_id: user.id,
      title: provisionalTitle(file),
      media_kind: mediaKind,
      // `tracks_media_shape_check`: a video row has a video_url and NO audio_url.
      audio_url: mediaKind === 'audio' ? 'pending://placeholder' : null,
      video_url: mediaKind === 'video' ? 'pending://placeholder' : null,
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'Failed to create track.');
  }
  const trackId = inserted.id;
  // Remembered BEFORE the upload, so a kill at any point after this line is swept.
  await rememberStaged({ trackId, userId: user.id });

  const discard = async ({ keepReference }: { keepReference: boolean }) => {
    await safeDeleteTrack(trackId);
    await safeRemoveUploadedObjects(user.id, trackId);
    // A STOPPED upload can still land: once the last byte is sent, storage finishes writing
    // the file whether or not we are still listening — after the removal above found
    // nothing. So the reference stays, and the next `sweepStagedUploads` lists the folder
    // again (a missing row is fine there) and removes what arrived late.
    if (!keepReference) { await forgetStaged(trackId); }
  };

  try {
    // Dropped while the row was being created: stop before reading the file (on Android
    // that is a full copy of a possibly 300 MB video) or sending any of it.
    if (isAbandoned()) { throw new StagingAbandonedError(); }
    onProgress({ stage: 'uploading', fraction: 0 });
    const mediaUrl = await uploadTrackFile(file, mediaKind, trackId, user.id, accessToken, f => {
      onProgress({ stage: 'uploading', fraction: f });
    }, signal);
    if (isAbandoned()) { throw new StagingAbandonedError(); }

    const { error: updateError } = await supabase
      .from('tracks')
      .update(mediaKind === 'audio' ? { audio_url: mediaUrl } : { video_url: mediaUrl })
      .eq('id', trackId);
    if (updateError) {
      throw new Error(`Failed to save the ${mediaKind === 'audio' ? 'song' : 'video'}: ${updateError.message}`);
    }

    onProgress({ stage: 'checking', fraction: 1 });
    // Every 12-second chunk, not one excerpt: the screen is still collecting the cover,
    // details and credits, so the extra seconds are hidden behind them.
    const scan = await scanUpload(supabase, trackId, { fullSong: true });
    if (isAbandoned()) { throw new StagingAbandonedError(); }

    return { trackId, userId: user.id, mediaKind, mediaUrl, scan, declaration: null };
  } catch (err) {
    const abandoned = isAbandoned();
    await discard({ keepReference: abandoned });
    // A stopped upload rejects with "Upload aborted."; to the caller that is the screen
    // having moved on, not a failure to fall back from.
    if (abandoned) { throw new StagingAbandonedError(); }
    throw err;
  }
}

/** Remove a staged upload that will not be posted. Never throws. */
export async function discardStagedUpload(staged: { trackId: string; userId: string }): Promise<void> {
  await safeDeleteTrack(staged.trackId);
  await safeRemoveUploadedObjects(staged.userId, staged.trackId);
  await forgetStaged(staged.trackId);
}

/**
 * Remove uploads this device staged and never posted — the app was killed mid-upload.
 * Run when the upload screen opens. A staged id that DID get its post is only forgotten.
 * Never throws.
 */
export async function sweepStagedUploads(): Promise<void> {
  const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const me = userData?.user?.id;
  if (!me) { return; }
  const list = await readStaged();
  // Only this account's. Another account's rows refuse the delete (owner-only), and
  // forgetting the reference anyway would strand that file for good — so it waits for
  // its own account to come back to this phone.
  for (const ref of list.filter(r => r.userId === me)) {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('id')
        .eq('track_id', ref.trackId)
        .limit(1);
      if (error) { continue; } // unknown → keep it for the next visit
      if (!data || data.length === 0) {
        await discardStagedUpload(ref);
      } else {
        await forgetStaged(ref.trackId);
      }
    } catch {
      // Next visit.
    }
  }
}

/**
 * Publish a staged song or video: upload its pictures, write the final fields, credits and
 * post, and record the copyright answer. A match still unanswered is asked about now (at
 * Post nothing else is on screen); a scan that could not complete at staging is run again,
 * as Post always did. On any failure — a cancelled question included — the staged upload is
 * removed too (as `createTrack` removes everything it wrote) and the error rethrown; the
 * screen then falls back to a full `createTrack` on the next tap.
 */
export async function publishStagedTrack(
  staged: StagedUpload,
  input: CreateTrackInput,
  onProgress?: CreateTrackProgressCallback,
  onCopyrightMatch?: CopyrightMatchPrompt,
): Promise<CreateTrackResult> {
  try {
    if (input.mode !== staged.mediaKind) { throw new Error('The staged file does not match this post.'); }
    if (!input.title.trim()) { throw new Error('Title is required.'); }
    if (input.mode === 'audio' && !input.cover) { throw new Error('Cover image is required for audio posts.'); }
    if (input.mode === 'video' && !input.thumbnail) {
      throw new Error('Thumbnail image is required for video posts.');
    }
    if (uploaderRolesOf(input).length === 0) { throw new Error('Choose what you did on this track.'); }
    if (input.streamingGrantAccepted !== true) {
      throw new Error('Tick the box to let Livil stream this recording.');
    }
    const tags = normalizeTags(input.tags ?? []);
    if (tags.length > MAX_TAGS_PER_TRACK) {
      throw new Error(`Up to ${MAX_TAGS_PER_TRACK} tags per track.`);
    }
    const description = input.description?.trim() ? input.description.trim() : null;

    onProgress?.({ stage: 'preparing', fraction: 0 });
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) { throw new Error('You must be signed in to upload a track.'); }

    let declaration = staged.declaration;
    if (needsAcknowledgement(staged.scan) && !declaration) {
      if (!onCopyrightMatch) { throw new Error('The copyright question has not been answered.'); }
      const answer = await onCopyrightMatch(staged.scan);
      if (answer.acknowledgement === 'cancelled') { throw new UploadCancelledError(); }
      declaration = answer;
    }

    // The pictures only: the song or video itself is already up. Progress is shared by size.
    const pictures: { file: PickedFile; kind: 'cover' | 'thumbnail' }[] =
      input.mode === 'audio'
        ? [{ file: input.cover, kind: 'cover' }]
        : [
            { file: input.thumbnail, kind: 'thumbnail' },
            ...(input.cover ? [{ file: input.cover, kind: 'cover' as const }] : []),
          ];
    const sizes = pictures.map(p => p.file.size ?? 100_000);
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    const fractions = pictures.map(() => 0);
    const report = () => onProgress?.({
      stage: 'uploading',
      fraction: Math.min(1, fractions.reduce((sum, f, i) => sum + f * sizes[i], 0) / total),
    });
    onProgress?.({ stage: 'uploading', fraction: 0 });
    const urls = await Promise.all(pictures.map((p, i) =>
      uploadTrackFile(p.file, p.kind, staged.trackId, staged.userId, accessToken, f => {
        fractions[i] = f;
        report();
      })));
    const urlFor = (kind: 'cover' | 'thumbnail') => {
      const i = pictures.findIndex(p => p.kind === kind);
      return i >= 0 ? urls[i] : undefined;
    };
    const result = await finishTrack({
      trackId: staged.trackId,
      userId: staged.userId,
      input,
      description,
      tags,
      urls: staged.mediaKind === 'audio'
        ? { audioUrl: staged.mediaUrl, coverArtUrl: urlFor('cover') }
        : { videoUrl: staged.mediaUrl, coverArtUrl: urlFor('cover'), thumbnailUrl: urlFor('thumbnail') },
      scan:
        staged.scan.status === 'complete' || !onCopyrightMatch
          ? { kind: 'answered', declaration }
          : { kind: 'ask', onCopyrightMatch },
      onProgress,
    });
    await forgetStaged(staged.trackId);
    return result;
  } catch (err) {
    await discardStagedUpload(staged);
    throw err;
  }
}

// ─── Collaborator fetch ──────────────────────────────────────────────────────

export type TrackCollaboratorInfo = {
  /** null for custom (no-account) collaborators, and for a deleted account */
  userId: string | null;
  role: string;
  display: AuthorDisplay;
  avatarUrl: string | null;
  /**
   * Whether the named artist has confirmed the credit.
   *
   * A pending credit still SHOWS — hiding credits until they were answered would leave
   * most tracks looking uncredited, because most people do not answer quickly. It is
   * marked instead, and confirmation verifies it. A typed-in name has nobody to confirm
   * it, so it is always 'pending' and the UI should not mark it as unconfirmed.
   */
  status: 'pending' | 'accepted';
};

type CollaboratorRow = {
  user_id: string | null;
  custom_name: string | null;
  role: string;
  status: string;
};
type CollaboratorProfile = { username: string; display_name: string | null; avatar_url: string | null };

/**
 * `(user_id null, custom_name null)` is the state account deletion made representable
 * by relaxing `collab_user_xor_custom`; a custom-name credit is a real name, not a
 * deleted author.
 */
export function toCollaboratorInfo(
  row: CollaboratorRow,
  profile: CollaboratorProfile | undefined,
): TrackCollaboratorInfo {
  if (row.user_id) {
    return {
      userId: row.user_id,
      role: row.role,
      display: resolveAuthorById(row.user_id, {
        displayName: profile?.display_name,
        username: profile?.username,
      }),
      avatarUrl: profile?.avatar_url ?? null,
      status: row.status === 'accepted' ? 'accepted' : 'pending',
    };
  }
  return {
    userId: null,
    role: row.role,
    display: resolveAuthorDisplay({ displayName: row.custom_name }),
    avatarUrl: null,
    // Nobody to confirm a typed-in name, so it is never shown as awaiting confirmation.
    status: 'accepted',
  };
}

export type PendingCredit = {
  creditId: string;
  trackId: string;
  trackTitle: string;
  coverArtUrl: string | null;
  role: string;
  createdAt: string;
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderAvatarUrl: string | null;
};

/**
 * Credits naming you that are still unanswered.
 *
 * The Livil-bot message in the activity centre is the primary place these get answered —
 * this is for a list view, and for the case where the message has scrolled away.
 */
export async function listPendingCredits(): Promise<PendingCredit[]> {
  const { data, error } = await supabase.rpc('list_pending_credits');
  if (error) { throw new Error(error.message); }
  return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    creditId: String(r.credit_id),
    trackId: String(r.track_id),
    trackTitle: String(r.track_title ?? ''),
    coverArtUrl: (r.cover_art_url as string) ?? null,
    role: String(r.role ?? ''),
    createdAt: String(r.created_at),
    uploaderId: (r.uploader_id as string) ?? null,
    uploaderName: (r.uploader_name as string) ?? null,
    uploaderAvatarUrl: (r.uploader_avatar as string) ?? null,
  }));
}

/**
 * Answer a credit naming you.
 *
 * Goes through an RPC rather than an update because the collaborator has no UPDATE on this
 * table at all — the function writes `status` and nothing else. Before it existed, the
 * self-update policy let a tagged user rewrite their own `role` on somebody else's track,
 * since RLS is row-level and cannot restrict columns.
 *
 * Returns the new status, or null when the credit is not yours, already answered, or gone.
 * Those are deliberately indistinguishable.
 */
export async function respondToCredit(
  creditId: string,
  accept: boolean,
): Promise<'accepted' | 'declined' | null> {
  const { data, error } = await supabase.rpc('credit_respond', {
    p_credit_id: creditId,
    p_accept: accept,
  });
  if (error) { throw new Error(error.message); }
  return (data as 'accepted' | 'declined' | null) ?? null;
}

/**
 * Returns all collaborators for a track (both linked-user and custom-name).
 * Two-step query: first pull track_collaborators, then batch-fetch profiles
 * for user-linked rows (avoids relying on an explicit FK embed).
 */
export async function fetchTrackCollaborators(
  trackId: string,
): Promise<TrackCollaboratorInfo[]> {
  const { data: rows, error } = await supabase
    .from('track_collaborators')
    .select('user_id, custom_name, role, status')
    .eq('track_id', trackId)
    // A declined credit is an answer: the named artist said this is not them, so it stops
    // being shown. The uploader is told separately, so it does not vanish unexplained.
    .neq('status', 'declined');

  if (error || !rows || rows.length === 0) { return []; }

  // Batch-fetch profiles for all user-linked collaborators.
  const userIds = [...new Set(
    rows.flatMap(r => (r.user_id ? [r.user_id as string] : [])),
  )];

  const profileMap = new Map<string, { username: string; display_name: string | null; avatar_url: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p);
    }
  }

  return (rows as CollaboratorRow[]).map(r =>
    toCollaboratorInfo(r, r.user_id ? profileMap.get(r.user_id) : undefined),
  );
}

export type ProfileSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export async function searchProfiles(
  query: string,
  options: { excludeUserIds?: string[]; limit?: number } = {},
): Promise<ProfileSearchResult[]> {
  const trimmed = query.trim();
  const limit = options.limit ?? 20;
  const exclude = options.excludeUserIds ?? [];
  const columns = 'id, username, display_name, avatar_url';

  type Row = { id: string; username: string; display_name: string | null; avatar_url: string | null };

  if (trimmed.length === 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select(columns)
      .order('username', { ascending: true })
      .limit(limit);
    if (error) { throw new Error(error.message); }
    return ((data ?? []) as Row[])
      .filter(p => !exclude.includes(p.id))
      .map(toResult);
  }

  // Two parallel ilike queries — username matches rank above display-name
  // matches in the merged list. Avoids the .or() filter-string fragility.
  const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
  const [usernameRes, displayNameRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(columns)
      .ilike('username', pattern)
      .order('username', { ascending: true })
      .limit(limit),
    supabase
      .from('profiles')
      .select(columns)
      .ilike('display_name', pattern)
      .order('display_name', { ascending: true })
      .limit(limit),
  ]);

  if (usernameRes.error) { throw new Error(usernameRes.error.message); }
  if (displayNameRes.error) { throw new Error(displayNameRes.error.message); }

  const seen = new Set<string>();
  const merged: Row[] = [];
  for (const row of [...((usernameRes.data ?? []) as Row[]), ...((displayNameRes.data ?? []) as Row[])]) {
    if (seen.has(row.id) || exclude.includes(row.id)) { continue; }
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) { break; }
  }
  return merged.map(toResult);
}

function toResult(p: { id: string; username: string; display_name: string | null; avatar_url: string | null }): ProfileSearchResult {
  return {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
  };
}

export type LibraryRecentTrack = {
  trackId: string;
  /**
   * The post this track was last played through — what a tap opens. Null when that
   * post has since been deleted; the caller then has nothing to open.
   */
  postId: string | null;
  title: string;
  artistLabel: string;
  coverArtUrl: string | null;
  playedAt: string;
};

/**
 * Recently played rows for the Library tab, newest first. Server-backed, so history
 * survives a reinstall: every counted play (post_views) writes its row via the
 * `trg_post_views_recent_tracks` trigger (20260929000000_recently_played_is_recorded.sql).
 *
 * `before` pages backwards by `playedAt` for "See all".
 */
export async function listRecentTracksForLibrary(
  limit = 24,
  before?: string,
): Promise<LibraryRecentTrack[]> {
  return (await listRecentTracksPage(limit, before)).items;
}

/**
 * One page of Recently Played, plus the cursor for the next page. Rows whose track you
 * can no longer read (taken down, uploader blocked) are dropped from `items`, so the
 * paging decision must come from the RAW rows: `nextBefore` is the last raw row's
 * `played_at`, or null when the database returned a short page (no more history).
 */
export async function listRecentTracksPage(
  limit = 24,
  before?: string,
): Promise<{ items: LibraryRecentTrack[]; nextBefore: string | null }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error('You must be signed in to view your library.');
  }

  const me = userData.user.id;

  const TRACK = `
    track:tracks (
      id,
      title,
      cover_art_url,
      uploader:profiles!tracks_uploader_id_fkey (
        username,
        display_name
      )
    )`;
  const run = (withPost: boolean) => {
    let query = supabase
      .from('user_recent_tracks')
      .select(withPost ? `played_at, last_post_id, ${TRACK}` : `played_at, ${TRACK}`)
      .eq('user_id', me);
    if (before) { query = query.lt('played_at', before); }
    return query.order('played_at', { ascending: false }).limit(limit);
  };

  // `last_post_id` arrives with 20260929000000_recently_played_is_recorded.sql. If the
  // app ships before that migration is applied, read the list without it (rows just
  // aren't tappable) rather than failing the whole strip with a column error.
  let { data, error } = await run(true);
  if (error && /last_post_id/.test(error.message)) {
    ({ data, error } = await run(false));
  }

  if (error) {
    throw new Error(error.message);
  }

  type Row = {
    played_at: string;
    last_post_id?: string | null;
    track: {
      id: string;
      title: string;
      cover_art_url: string | null;
      uploader: { username: string; display_name: string | null } | null;
    } | null;
  };

  const raws = (data ?? []) as unknown as Row[];
  const nextBefore = raws.length < limit ? null : raws[raws.length - 1]!.played_at;
  const items = raws
    .map((raw: Row) => {
      const t = raw.track;
      if (!t) {
        return null;
      }
      const up = t.uploader;
      const artistLabel = up?.display_name?.trim() || up?.username || 'Artist';
      return {
        trackId: t.id,
        postId: raw.last_post_id ?? null,
        title: t.title,
        artistLabel,
        coverArtUrl: t.cover_art_url,
        playedAt: raw.played_at,
      } satisfies LibraryRecentTrack;
    })
    .filter(Boolean) as LibraryRecentTrack[];
  return { items, nextBefore };
}
