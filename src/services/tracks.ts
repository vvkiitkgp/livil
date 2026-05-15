import { supabase } from '../../lib/supabase';
import type { PendingCollaborator } from '../constants/roles';
import { uploadTrackFile, type PickedFile } from './uploads';

export type PostMode = 'audio' | 'video';

export type CreateTrackInput =
  | {
      mode: 'audio';
      title: string;
      description?: string;
      audio: PickedFile;
      cover: PickedFile;
      collaborators: PendingCollaborator[];
    }
  | {
      mode: 'video';
      title: string;
      description?: string;
      video: PickedFile;
      collaborators: PendingCollaborator[];
    };

export type CreateTrackResult = {
  trackId: string;
  postId: string;
  audioUrl?: string;
  videoUrl?: string;
  coverArtUrl?: string;
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

type UploadPlan = {
  audio?: PickedFile;
  video?: PickedFile;
  cover?: PickedFile;
};

function planFromInput(input: CreateTrackInput): UploadPlan {
  if (input.mode === 'audio') {
    return { audio: input.audio, cover: input.cover };
  }
  return { video: input.video };
}

function computeWeights(plan: UploadPlan): {
  audio: number;
  video: number;
  cover: number;
} {
  const audioBytes = plan.audio ? plan.audio.size ?? 1_000_000 : 0;
  const videoBytes = plan.video ? plan.video.size ?? 1_000_000 : 0;
  const coverBytes = plan.cover ? plan.cover.size ?? 100_000 : 0;
  const total = audioBytes + videoBytes + coverBytes;
  if (total <= 0) {
    return { audio: 1, video: 0, cover: 0 };
  }
  return {
    audio: audioBytes / total,
    video: videoBytes / total,
    cover: coverBytes / total,
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
      audio_url: null,
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
  const reportOverall = () => {
    const fraction =
      weights.audio * audioFrac + weights.video * videoFrac + weights.cover * coverFrac;
    onProgress?.({ stage: 'uploading', fraction: Math.min(1, Math.max(0, fraction)) });
  };

  try {
    onProgress?.({ stage: 'uploading', fraction: 0 });

    const [audioUrl, videoUrl, coverArtUrl] = await Promise.all([
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
    ]);

    onProgress?.({ stage: 'finalizing', fraction: 1 });

    const { error: updateError } = await supabase
      .from('tracks')
      .update({
        audio_url: audioUrl ?? null,
        video_url: videoUrl ?? null,
        cover_art_url: coverArtUrl ?? null,
      })
      .eq('id', trackId);

    if (updateError) {
      throw new Error(`Failed to finalize track: ${updateError.message}`);
    }

    if (input.collaborators.length > 0) {
      const rows = input.collaborators.map(c => ({
        track_id: trackId,
        user_id: c.kind === 'user' ? c.userId ?? null : null,
        custom_name: c.kind === 'custom' ? c.name : null,
        role: c.role,
      }));

      const { error: collabError } = await supabase
        .from('track_collaborators')
        .insert(rows);

      if (collabError) {
        throw new Error(`Failed to save collaborators: ${collabError.message}`);
      }
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
    };
  } catch (err) {
    await safeDeleteTrack(trackId);
    throw err;
  }
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

  let req = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .order('username', { ascending: true })
    .limit(limit);

  if (trimmed.length > 0) {
    const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
    req = req.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
  }

  const { data, error } = await req;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .filter(p => !exclude.includes(p.id))
    .map(p => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
    }));
}
