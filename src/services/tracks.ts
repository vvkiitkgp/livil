import { supabase } from '../../lib/supabase';
import type { PendingCollaborator } from '../constants/roles';
import { uploadTrackFile, type PickedFile } from './uploads';

export type CreateTrackInput = {
  title: string;
  description?: string;
  audio: PickedFile;
  video?: PickedFile;
  cover?: PickedFile;
  collaborators: PendingCollaborator[];
};

export type CreateTrackResult = {
  trackId: string;
  audioUrl: string;
  videoUrl?: string;
  coverArtUrl?: string;
};

async function safeDeleteTrack(trackId: string): Promise<void> {
  try {
    await supabase.from('tracks').delete().eq('id', trackId);
  } catch {
    // Best-effort cleanup; the orphan row will fail RLS for everyone but the uploader anyway.
  }
}

export async function createTrack(input: CreateTrackInput): Promise<CreateTrackResult> {
  const title = input.title.trim();
  if (!title) {
    throw new Error('Title is required.');
  }
  if (!input.audio) {
    throw new Error('Audio file is required.');
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('You must be signed in to upload a track.');
  }

  const { data: inserted, error: insertError } = await supabase
    .from('tracks')
    .insert({
      uploader_id: user.id,
      title,
      description: input.description?.trim() ? input.description.trim() : null,
      audio_url: 'pending://placeholder',
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'Failed to create track.');
  }

  const trackId = inserted.id;

  try {
    const [audioUrl, videoUrl, coverArtUrl] = await Promise.all([
      uploadTrackFile(input.audio, 'audio', trackId, user.id),
      input.video
        ? uploadTrackFile(input.video, 'video', trackId, user.id)
        : Promise.resolve<string | undefined>(undefined),
      input.cover
        ? uploadTrackFile(input.cover, 'cover', trackId, user.id)
        : Promise.resolve<string | undefined>(undefined),
    ]);

    const { error: updateError } = await supabase
      .from('tracks')
      .update({
        audio_url: audioUrl,
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

    return {
      trackId,
      audioUrl,
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
