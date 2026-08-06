import { supabase } from '../../lib/supabase';
import type { Json } from '../../lib/database.types';
import type { PendingCollaborator } from '../constants/roles';
import { uploadTrackFile, resolveReadableUri, type PickedFile } from './uploads';
import { analyzeWaveformPeaks, WAVEFORM_VERSION, type WaveformData } from './waveform';
import { resolveAuthorById, resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';

export type PostMode = 'audio' | 'video';

export type CreateTrackInput =
  | {
      mode: 'audio';
      title: string;
      description?: string;
      audio: PickedFile;
      cover: PickedFile;
      /** What the uploader did on their own track. Required — see the insert below. */
      uploaderRole: string;
      collaborators: PendingCollaborator[];
      /** Track length in seconds, captured from the upload preview's onLoad.
       *  Saved to duration_seconds so feed/profile cards show the length before
       *  the post is ever played. Omit/null if not yet known (backfills on play). */
      durationSeconds?: number | null;
    }
  | {
      mode: 'video';
      title: string;
      description?: string;
      /** What the uploader did on their own track. Required — see the insert below. */
      uploaderRole: string;
      video: PickedFile;
      cover?: PickedFile;
      /** Required for video uploads — the thumbnail shown in the feed PostCard
       *  preview. Validated client-side; the column is nullable so legacy rows
       *  remain readable. */
      thumbnail: PickedFile;
      collaborators: PendingCollaborator[];
      /** Track length in seconds, captured from the upload preview's onLoad.
       *  Saved to duration_seconds so feed/profile cards show the length before
       *  the post is ever played. Omit/null if not yet known (backfills on play). */
      durationSeconds?: number | null;
    };

export type CreateTrackResult = {
  trackId: string;
  postId: string;
  audioUrl?: string;
  videoUrl?: string;
  coverArtUrl?: string;
  thumbnailUrl?: string;
};

export type CreateTrackStage = 'preparing' | 'uploading' | 'finalizing';

export type CreateTrackProgress = {
  stage: CreateTrackStage;
  fraction: number;
};

export type CreateTrackProgressCallback = (progress: CreateTrackProgress) => void;

async function safeDeleteTrack(trackId: string): Promise<void> {
  try {
    await supabase.from('tracks').delete().eq('id', trackId);
  } catch {
    // Best-effort cleanup; the orphan row will fail RLS for everyone but the uploader anyway.
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

    onProgress?.({ stage: 'finalizing', fraction: 1 });

    // Persist the captured length when we have it. Conditional so an unknown
    // duration leaves the column null (it backfills on first play) rather than
    // overwriting it with 0.
    const durationSeconds =
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
        ? Math.round(input.durationSeconds)
        : null;

    const { error: updateError } = await supabase
      .from('tracks')
      .update({
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
      {
        track_id: trackId,
        user_id: user.id,
        custom_name: null,
        role: input.uploaderRole.trim(),
        status: 'accepted',
      },
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
        author_id: user.id,
        kind: 'upload',
        track_id: trackId,
        caption: description,
      })
      .select('id')
      .single();

    if (postError || !postRow) {
      throw new Error(`Failed to create post: ${postError?.message ?? 'unknown error'}`);
    }

    return {
      trackId,
      postId: postRow.id,
      audioUrl: audioUrl ?? undefined,
      videoUrl: videoUrl ?? undefined,
      coverArtUrl: coverArtUrl ?? undefined,
      thumbnailUrl: thumbnailUrl ?? undefined,
    };
  } catch (err) {
    await safeDeleteTrack(trackId);
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
  title: string;
  artistLabel: string;
  coverArtUrl: string | null;
  playedAt: string;
};

/**
 * Recently played rows for the Library tab (server-backed so history survives
 * reinstall once playback hooks write to `user_recent_tracks`).
 */
export async function listRecentTracksForLibrary(limit = 24): Promise<LibraryRecentTrack[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error('You must be signed in to view your library.');
  }

  const me = userData.user.id;

  const { data, error } = await supabase
    .from('user_recent_tracks')
    .select(
      `
      played_at,
      track:tracks (
        id,
        title,
        cover_art_url,
        uploader:profiles!tracks_uploader_id_fkey (
          username,
          display_name
        )
      )
    `,
    )
    .eq('user_id', me)
    .order('played_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  type Row = {
    played_at: string;
    track: {
      id: string;
      title: string;
      cover_art_url: string | null;
      uploader: { username: string; display_name: string | null } | null;
    } | null;
  };

  return (data ?? [])
    .map((raw: Row) => {
      const t = raw.track;
      if (!t) {
        return null;
      }
      const up = t.uploader;
      const artistLabel = up?.display_name?.trim() || up?.username || 'Artist';
      return {
        trackId: t.id,
        title: t.title,
        artistLabel,
        coverArtUrl: t.cover_art_url,
        playedAt: raw.played_at,
      } satisfies LibraryRecentTrack;
    })
    .filter(Boolean) as LibraryRecentTrack[];
}
