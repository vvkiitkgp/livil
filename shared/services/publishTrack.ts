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
import { MAX_TAGS_PER_TRACK, normalizeTags } from '../constants/tags';
import {
  resolveContentType,
  resolveExtension,
  storagePathFor,
  TRACKS_MEDIA_BUCKET,
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

/**
 * One credit, in the shape the table stores rather than the shape the picker holds.
 *
 * `userId` XOR `customName` — the database enforces it (`collab_user_xor_custom`), and a
 * violation here surfaces as a constraint error after the media has already uploaded, so
 * it is checked before any of that happens.
 */
export type PublishCollaborator = {
  /** A real profile, or null for a name typed by hand. */
  userId: string | null;
  /** A name typed by hand, or null when a profile was picked. */
  customName: string | null;
  role: string;
};

export type PublishTrackInput = {
  mode: 'audio' | 'video';
  title: string;
  description?: string | null;
  durationSeconds?: number | null;
  assets: PublishAsset[];
  /**
   * What the UPLOADER did on their own track. Required.
   *
   * A credit list that names the guitarist and the mixer but not the person who made the
   * record is not a credit list. It is stored as an ordinary `track_collaborators` row
   * pointing at the uploader, so it renders, sorts and reads exactly like any other credit
   * — and lands `accepted`, because you do not confirm your own credit.
   */
  uploaderRole: string;
  /** Credits for everyone else. Omitted or empty means the uploader worked alone. */
  collaborators?: PublishCollaborator[];
  /**
   * Tags, in whatever shape the caller holds them.
   *
   * Re-normalized here rather than trusted. A caller that writes a tag without going through
   * `shared/constants/tags.ts` stores something the search box can never reconstruct from the
   * same typed text, and that failure is invisible — the tag is on the track, the query looks
   * right, the results are empty. Empty means an untagged track and is written as NULL, so
   * "no tags" has one representation rather than two.
   */
  tags?: string[];
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

/** Mirrors `track_collaborators_role_check`. */
export const ROLE_MAX_LENGTH = 40;

function validate(input: PublishTrackInput): string | null {
  if (!input.title.trim()) return 'Title is required.';
  const own = input.uploaderRole?.trim() ?? '';
  if (!own) return 'Choose what you did on this track.';
  if (own.length > ROLE_MAX_LENGTH) {
    return `A role must be ${ROLE_MAX_LENGTH} characters or fewer.`;
  }
  const kinds = new Set(input.assets.map(a => a.kind));
  if (input.mode === 'audio') {
    if (!kinds.has('audio')) return 'Audio file is required.';
    if (!kinds.has('cover')) return 'Cover image is required for audio posts.';
  } else {
    if (!kinds.has('video')) return 'Video file is required.';
    if (!kinds.has('thumbnail')) return 'Thumbnail image is required for video posts.';
  }
  // Only the cap can fail: `normalizeTags` drops anything unusable and de-duplicates, so
  // every other rule is satisfied by construction rather than by checking.
  if (normalizeTags(input.tags ?? []).length > MAX_TAGS_PER_TRACK) {
    return `Up to ${MAX_TAGS_PER_TRACK} tags per track.`;
  }
  // Checked up front, not at insert time. Every one of these is a constraint the database
  // will reject — and by then a full master has uploaded and the rollback throws it away,
  // which is an expensive way to learn that a role string was blank.
  for (const c of input.collaborators ?? []) {
    const named = Boolean(c.userId) !== Boolean(c.customName?.trim());
    if (!named) return 'Each credit needs either a Livil profile or a name, not both.';
    const role = c.role?.trim() ?? '';
    if (!role) return 'Every credit needs a role.';
    if (role.length > ROLE_MAX_LENGTH) return `A role must be ${ROLE_MAX_LENGTH} characters or fewer.`;
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

/**
 * Remove objects uploaded by a publish that then failed.
 *
 * Without this the row is deleted and the FILES stay — a full audio master sitting in a
 * public bucket with nothing referencing it. The artist cannot see it (no row), no cleanup
 * path touches it, and it survives until the account is deleted. For an unreleased master
 * that is the worst kind of leak: silent, permanent, and produced by an ordinary error.
 *
 * Best-effort by design. This runs while already handling a failure, so it must not throw
 * and mask the real error. Removing a path that was never written is a no-op, so the
 * planned paths can be passed without tracking which uploads actually completed — and a
 * partial TUS upload leaves an object too, which is exactly what needs removing.
 */
async function safeRemoveObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await livil().storage.from(TRACKS_MEDIA_BUCKET).remove(paths);
  } catch {
    /* best-effort; account deletion is the backstop */
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
  const tags = normalizeTags(input.tags ?? []);

  const { data: inserted, error: insertError } = await db
    .from('tracks')
    .insert({
      uploader_id: user.id,
      title,
      description,
      // Written with the row rather than in the finalize UPDATE: tags are metadata the
      // artist typed, not something the upload discovers, so there is no reason for them to
      // exist only after the bytes land.
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
  // Recorded as each upload starts, so the catch below can remove whatever reached
  // storage — including a partially written object from an upload that failed midway.
  const uploadedPaths: string[] = [];

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
        uploadedPaths.push(path);
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

    // The primary media object's size — audio or video, never the artwork. We already hold
    // it on the file handle, so storing it costs nothing and saves the dashboard a
    // per-row storage round trip later. Conditional like duration: unknown stays null
    // rather than being written as a misleading 0.
    const primary = input.assets.find(a => a.kind === input.mode);
    const sizeBytes =
      primary && typeof primary.sizeBytes === 'number' && primary.sizeBytes > 0
        ? primary.sizeBytes
        : null;

    const { error: updateError } = await db
      .from('tracks')
      .update({
        audio_url: urls.audio ?? null,
        video_url: urls.video ?? null,
        cover_art_url: urls.cover ?? null,
        thumbnail_url: urls.thumbnail ?? null,
        ...(duration !== null ? { duration_seconds: duration } : {}),
        ...(sizeBytes !== null ? { file_size_bytes: sizeBytes } : {}),
      })
      .eq('id', trackId);

    if (updateError) throw new Error(`Failed to finalize track: ${updateError.message}`);

    /*
     * Credits go in BEFORE the post row, and that ordering is the point.
     *
     * `createTrack` on mobile writes them after the post is already live, so a failed
     * insert leaves a published, uncredited track and an error on screen with nothing to
     * retry. Here the post does not exist yet, so a failure falls into the same catch as
     * everything else: objects removed, track row deleted, nothing ever reached a feed.
     * Publishing a track and crediting the people on it is one operation or neither.
     *
     * Every row lands as `pending`. The tagged artist accepts in the app — the uploader
     * does not get to assert someone else's involvement on their behalf.
     */
    // The uploader's own credit goes in with everybody else's, in one insert, so a
    // half-credited track is not a state that can exist. `accepted` because it is
    // self-declared — nobody has to confirm what you say you did on your own record, and
    // the notification trigger already skips self-credits.
    const rows = [
      {
        track_id: trackId,
        user_id: user.id,
        custom_name: null,
        role: input.uploaderRole.trim(),
        status: 'accepted',
      },
      ...(input.collaborators ?? []).map(c => ({
        track_id: trackId,
        user_id: c.userId,
        custom_name: c.userId ? null : c.customName?.trim() ?? null,
        role: c.role.trim(),
        status: 'pending',
      })),
    ];

    const { error: collabError } = await db.from('track_collaborators').insert(rows);
    if (collabError) throw new Error(`Failed to save credits: ${collabError.message}`);

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
    // Objects first, then the row. If only the row went and the objects stayed, the files
    // would be unreachable AND unreferenced — the exact orphan this exists to prevent.
    await safeRemoveObjects(uploadedPaths);
    await safeDeleteTrack(trackId);
    throw err;
  }
}
