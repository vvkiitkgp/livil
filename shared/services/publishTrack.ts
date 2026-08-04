/**
 * Publishing a track: the database side, shared by both clients.
 *
 * This mirrors the row choreography in `src/services/tracks.ts::createTrack` exactly,
 * because both clients write into one database and a divergence here produces rows the
 * other client cannot render. What is NOT here is how bytes reach storage — React Native
 * streams from a file URI through XHR, the browser uses resumable TUS — so the upload
 * mechanism is injected and only the orchestration is shared.
 *
 * The order matters and is not arbitrary:
 *
 *   1. INSERT the track first, with a `pending://placeholder` URL. The row's id is what
 *      scopes the storage path, so it has to exist before anything is uploaded. The
 *      placeholder exists because the table requires one of audio_url/video_url to be set.
 *   2. Upload every asset in parallel.
 *   3. UPDATE the row with real URLs (and duration, only when known — writing 0 would
 *      defeat the lazy backfill on first play).
 *   4. INSERT the `posts` row, kind 'upload', caption mirroring the description so feed UI
 *      only ever reads posts.caption.
 *
 * Any failure after step 1 deletes the track row, so a half-published track never reaches
 * a feed. Deletion is best-effort: an orphan row fails RLS for everyone but its uploader.
 */
import { livil } from '../client';
import {
  resolveContentType,
  resolveExtension,
  storagePathFor,
  type TrackMediaKind,
} from './media';

export type PublishStage = 'preparing' | 'uploading' | 'finalizing';

export type PublishProgress = {
  stage: PublishStage;
  /** 0..1 across all assets, weighted by byte size. */
  fraction: number;
};

/** One file to upload, described without reference to how it is read. */
export type PublishAsset = {
  kind: TrackMediaKind;
  fileName: string | null;
  contentType: string | null;
  /** Used to weight progress. Unknown sizes fall back to an equal share. */
  sizeBytes: number | null;
};

export type PublishTrackInput = {
  mode: 'audio' | 'video';
  title: string;
  description?: string | null;
  durationSeconds?: number | null;
  assets: PublishAsset[];
};

/**
 * Uploads one asset and resolves with its public URL.
 *
 * `contentType` is resolved here rather than by the caller because the bucket enforces a
 * server-side MIME allowlist — see `resolveContentType`.
 */
export type AssetUploader = (
  asset: PublishAsset,
  target: { path: string; contentType: string },
  onProgress: (fraction: number) => void,
) => Promise<string>;

export type PublishTrackResult = {
  trackId: string;
  postId: string;
  urls: Partial<Record<TrackMediaKind, string>>;
};

function validate(input: PublishTrackInput): string | null {
  if (!input.title.trim()) return 'Title is required.';
  const kinds = new Set(input.assets.map(a => a.kind));
  if (input.mode === 'audio') {
    if (!kinds.has('audio')) return 'Audio file is required.';
    if (!kinds.has('cover')) return 'Cover image is required for audio posts.';
  } else {
    if (!kinds.has('video')) return 'Video file is required.';
    if (!kinds.has('thumbnail')) return 'Thumbnail image is required for video posts.';
  }
  return null;
}

/**
 * Byte-weighted progress. Equal weighting would make a 2 GB master and a 40 kB cover move
 * the bar the same amount, so the bar would sit at 50% for the entire real upload.
 */
function weightsFor(assets: PublishAsset[]): Map<TrackMediaKind, number> {
  const known = assets.map(a => (a.sizeBytes && a.sizeBytes > 0 ? a.sizeBytes : null));
  const total = known.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const weights = new Map<TrackMediaKind, number>();
  if (total <= 0) {
    for (const a of assets) weights.set(a.kind, 1 / assets.length);
    return weights;
  }
  // An unknown size gets an equal share of what is left rather than zero, so its asset
  // still visibly contributes.
  const fallback = total / assets.length;
  const adjusted = assets.map(a => (a.sizeBytes && a.sizeBytes > 0 ? a.sizeBytes : fallback));
  const adjustedTotal = adjusted.reduce((s, n) => s + n, 0);
  assets.forEach((a, i) => weights.set(a.kind, adjusted[i]! / adjustedTotal));
  return weights;
}

async function safeDeleteTrack(trackId: string): Promise<void> {
  try {
    await livil().from('tracks').delete().eq('id', trackId);
  } catch {
    /* best-effort; an orphan row fails RLS for everyone but its uploader */
  }
}

export async function publishTrack(
  input: PublishTrackInput,
  uploadAsset: AssetUploader,
  onProgress?: (p: PublishProgress) => void,
): Promise<PublishTrackResult> {
  const problem = validate(input);
  if (problem) throw new Error(problem);

  const db = livil();
  onProgress?.({ stage: 'preparing', fraction: 0 });

  const { data: userData, error: userError } = await db.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new Error('You must be signed in to upload a track.');

  const title = input.title.trim();
  const description = input.description?.trim() ? input.description.trim() : null;

  const { data: inserted, error: insertError } = await db
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

  try {
    const weights = weightsFor(input.assets);
    const progressByKind = new Map<TrackMediaKind, number>();
    const report = () => {
      let fraction = 0;
      for (const [kind, w] of weights) fraction += w * (progressByKind.get(kind) ?? 0);
      onProgress?.({ stage: 'uploading', fraction: Math.min(1, Math.max(0, fraction)) });
    };

    report();

    const uploaded = await Promise.all(
      input.assets.map(async asset => {
        const ext = resolveExtension(asset.kind, asset.fileName, asset.contentType);
        const path = storagePathFor(user.id, trackId, asset.kind, ext);
        const contentType = resolveContentType(asset.kind, ext, asset.contentType);
        const url = await uploadAsset(asset, { path, contentType }, fraction => {
          progressByKind.set(asset.kind, fraction);
          report();
        });
        return [asset.kind, url] as const;
      }),
    );

    const urls = Object.fromEntries(uploaded) as Partial<Record<TrackMediaKind, string>>;
    onProgress?.({ stage: 'finalizing', fraction: 1 });

    const duration =
      typeof input.durationSeconds === 'number' &&
      Number.isFinite(input.durationSeconds) &&
      input.durationSeconds > 0
        ? Math.round(input.durationSeconds)
        : null;

    const { error: updateError } = await db
      .from('tracks')
      .update({
        audio_url: urls.audio ?? null,
        video_url: urls.video ?? null,
        cover_art_url: urls.cover ?? null,
        thumbnail_url: urls.thumbnail ?? null,
        ...(duration !== null ? { duration_seconds: duration } : {}),
      })
      .eq('id', trackId);

    if (updateError) throw new Error(`Failed to finalize track: ${updateError.message}`);

    // No clip window is written: the dashboard has no player, and choosing an excerpt you
    // cannot hear is guesswork. The columns stay null, which means "play the full track" —
    // reposting with a clip is still available in the app, where you can listen first.
    const { data: postRow, error: postError } = await db
      .from('posts')
      .insert({ author_id: user.id, kind: 'upload', track_id: trackId, caption: description })
      .select('id')
      .single();

    if (postError || !postRow) {
      throw new Error(`Failed to create post: ${postError?.message ?? 'unknown error'}`);
    }

    return { trackId, postId: postRow.id, urls };
  } catch (err) {
    await safeDeleteTrack(trackId);
    throw err;
  }
}
