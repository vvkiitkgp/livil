import ImagePicker, { type Image as CroppedImage } from 'react-native-image-crop-picker';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabase';
import { AVATARS_BUCKET } from './profileService';

export type AlbumSummary = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  trackCount: number;
  releaseYear: number | null;
};

export type AlbumDetail = {
  id: string;
  title: string;
  description: string | null;
  coverArtUrl: string | null;
  releaseDate: string | null;
  uploaderId: string;
  uploaderUsername: string;
  uploaderDisplayName: string | null;
  uploaderAvatarUrl: string | null;
  createdAt: string;
  tracks: AlbumTrackItem[];
  totalDurationSec: number;
};

export type AlbumTrackItem = {
  trackId: string;
  position: number;
  title: string;
  coverArtUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  mediaKind: 'audio' | 'video';
  audioUrl: string | null;
  videoUrl: string | null;
};

export type UploaderTrackOption = {
  trackId: string;
  title: string;
  coverArtUrl: string | null;
  durationSec: number | null;
  createdAt: string;
};

export type AlbumForTrack = {
  albumId: string;
  title: string;
  coverArtUrl: string | null;
};

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) { throw new Error('Not signed in.'); }
  return data.user.id;
}

function yearFromReleaseDate(d: string | null): number | null {
  if (!d) { return null; }
  const y = Number.parseInt(d.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export async function fetchAlbumsByUser(userId: string): Promise<AlbumSummary[]> {
  const { data, error } = await supabase
    .from('albums')
    .select(`
      id,
      title,
      cover_art_url,
      release_date,
      album_tracks (
        track_id,
        track:tracks ( cover_art_url )
      )
    `)
    .eq('uploader_id', userId)
    .order('created_at', { ascending: false });
  if (error) { throw new Error(error.message); }
  return (data ?? []).map(row => {
    const tracks = (row.album_tracks ?? []) as Array<{ track_id: string; track: { cover_art_url: string | null } | null }>;
    const firstCover = tracks.find(t => t.track?.cover_art_url)?.track?.cover_art_url ?? null;
    return {
      id: row.id,
      title: row.title,
      coverArtUrl: row.cover_art_url ?? firstCover,
      trackCount: tracks.length,
      releaseYear: yearFromReleaseDate(row.release_date),
    };
  });
}

export async function fetchAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const { data, error } = await supabase
    .from('albums')
    .select(`
      id,
      title,
      description,
      cover_art_url,
      release_date,
      uploader_id,
      created_at,
      uploader:profiles!albums_uploader_id_fkey ( username, display_name, avatar_url ),
      album_tracks (
        position,
        track:tracks (
          id, title, cover_art_url, thumbnail_url, duration_seconds,
          media_kind, audio_url, video_url
        )
      )
    `)
    .eq('id', albumId)
    .maybeSingle();
  if (error) { throw new Error(error.message); }
  if (!data) { throw new Error('Album not found.'); }

  const uploader = (data.uploader ?? null) as { username: string; display_name: string | null; avatar_url: string | null } | null;
  const joinRows = (data.album_tracks ?? []) as Array<{
    position: number;
    track: {
      id: string; title: string; cover_art_url: string | null; thumbnail_url: string | null;
      duration_seconds: number | null; media_kind: string;
      audio_url: string | null; video_url: string | null;
    } | null;
  }>;
  const tracks: AlbumTrackItem[] = joinRows
    .filter(r => r.track)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      trackId: r.track!.id,
      position: r.position,
      title: r.track!.title,
      coverArtUrl: r.track!.cover_art_url,
      thumbnailUrl: r.track!.thumbnail_url,
      durationSec: r.track!.duration_seconds,
      mediaKind: r.track!.media_kind === 'video' ? 'video' : 'audio',
      audioUrl: r.track!.audio_url,
      videoUrl: r.track!.video_url,
    }));
  const totalDurationSec = tracks.reduce((acc, t) => acc + (t.durationSec ?? 0), 0);

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    coverArtUrl: data.cover_art_url ?? tracks.find(t => t.coverArtUrl)?.coverArtUrl ?? null,
    releaseDate: data.release_date,
    uploaderId: data.uploader_id,
    uploaderUsername: uploader?.username ?? 'unknown',
    uploaderDisplayName: uploader?.display_name ?? null,
    uploaderAvatarUrl: uploader?.avatar_url ?? null,
    createdAt: data.created_at,
    tracks,
    totalDurationSec,
  };
}

export type CreateAlbumInput = {
  title: string;
  description?: string | null;
  coverArtUrl?: string | null;
  releaseDate?: string | null;
};

export async function createAlbum(input: CreateAlbumInput): Promise<{ id: string }> {
  const me = await getCurrentUserId();
  const { data, error } = await supabase
    .from('albums')
    .insert({
      uploader_id: me,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      cover_art_url: input.coverArtUrl ?? null,
      release_date: input.releaseDate ?? null,
    })
    .select('id')
    .single();
  if (error || !data) { throw new Error(error?.message ?? 'Failed to create album.'); }
  return { id: data.id };
}

export type UpdateAlbumInput = Partial<CreateAlbumInput>;

export async function updateAlbum(albumId: string, patch: UpdateAlbumInput): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) { update.title = patch.title.trim(); }
  if (patch.description !== undefined) { update.description = patch.description?.trim() || null; }
  if (patch.coverArtUrl !== undefined) { update.cover_art_url = patch.coverArtUrl; }
  if (patch.releaseDate !== undefined) { update.release_date = patch.releaseDate; }
  if (Object.keys(update).length === 0) { return; }
  const { error } = await supabase.from('albums').update(update).eq('id', albumId);
  if (error) { throw new Error(error.message); }
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const { error } = await supabase.from('albums').delete().eq('id', albumId);
  if (error) { throw new Error(error.message); }
}

async function nextAlbumPosition(albumId: string): Promise<number> {
  const { data, error } = await supabase
    .from('album_tracks')
    .select('position')
    .eq('album_id', albumId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { throw new Error(error.message); }
  return data ? data.position + 1 : 0;
}

export async function addTrackToAlbum(albumId: string, trackId: string): Promise<void> {
  const position = await nextAlbumPosition(albumId);
  const { error } = await supabase
    .from('album_tracks')
    .insert({ album_id: albumId, track_id: trackId, position });
  if (error) { throw new Error(error.message); }
}

export async function removeTrackFromAlbum(trackId: string): Promise<void> {
  const { error } = await supabase.from('album_tracks').delete().eq('track_id', trackId);
  if (error) { throw new Error(error.message); }
}

export async function moveTrackToAlbum(trackId: string, newAlbumId: string): Promise<void> {
  await removeTrackFromAlbum(trackId);
  await addTrackToAlbum(newAlbumId, trackId);
}

// Two-pass reorder to satisfy the (album_id, position) unique index — we move
// every track to a negative-numbered position first, then to its final value.
export async function reorderAlbumTracks(albumId: string, orderedTrackIds: string[]): Promise<void> {
  await Promise.all(
    orderedTrackIds.map((trackId, idx) =>
      supabase.from('album_tracks').update({ position: -1 - idx }).eq('album_id', albumId).eq('track_id', trackId)
    )
  );
  await Promise.all(
    orderedTrackIds.map((trackId, idx) =>
      supabase.from('album_tracks').update({ position: idx }).eq('album_id', albumId).eq('track_id', trackId)
    )
  );
}

// My tracks not yet in any album — feeds the CreateAlbum picker and the
// "Add to album" sheet when the row is shown for a track without a current
// album mapping.
export async function fetchUploaderAvailableTracks(): Promise<UploaderTrackOption[]> {
  const me = await getCurrentUserId();
  const { data: taggedRows, error: taggedErr } = await supabase
    .from('album_tracks')
    .select('track_id');
  if (taggedErr) { throw new Error(taggedErr.message); }
  const tagged = new Set((taggedRows ?? []).map(r => r.track_id));

  const { data, error } = await supabase
    .from('tracks')
    .select('id, title, cover_art_url, duration_seconds, created_at')
    .eq('uploader_id', me)
    .order('created_at', { ascending: false });
  if (error) { throw new Error(error.message); }

  return (data ?? [])
    .filter(t => !tagged.has(t.id))
    .map(t => ({
      trackId: t.id,
      title: t.title,
      coverArtUrl: t.cover_art_url,
      durationSec: t.duration_seconds,
      createdAt: t.created_at,
    }));
}

export type AlbumSearchResult = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  trackCount: number;
  releaseYear: number | null;
  uploaderId: string;
  uploaderUsername: string;
  uploaderDisplayName: string | null;
};

export async function searchAlbums(q: string, limit = 20): Promise<AlbumSearchResult[]> {
  const trimmed = q.trim();
  let query = supabase
    .from('albums')
    .select(`
      id,
      title,
      cover_art_url,
      release_date,
      uploader_id,
      uploader:profiles!albums_uploader_id_fkey ( username, display_name ),
      album_tracks ( track_id, track:tracks ( cover_art_url ) )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (trimmed.length > 0) {
    query = query.ilike('title', `%${trimmed}%`);
  }
  const { data, error } = await query;
  if (error) { throw new Error(error.message); }
  return (data ?? []).map(row => {
    const tracks = (row.album_tracks ?? []) as Array<{ track_id: string; track: { cover_art_url: string | null } | null }>;
    const firstCover = tracks.find(t => t.track?.cover_art_url)?.track?.cover_art_url ?? null;
    const uploader = (row.uploader ?? null) as { username: string; display_name: string | null } | null;
    return {
      id: row.id,
      title: row.title,
      coverArtUrl: row.cover_art_url ?? firstCover,
      trackCount: tracks.length,
      releaseYear: yearFromReleaseDate(row.release_date),
      uploaderId: row.uploader_id,
      uploaderUsername: uploader?.username ?? 'unknown',
      uploaderDisplayName: uploader?.display_name ?? null,
    };
  });
}

// ── Album cover image — pick + upload ────────────────────────────────────────

export type PickedAlbumCover = { uri: string; mime: string };

const ALBUM_COVER_CROP_OPTIONS = {
  width: 1024,
  height: 1024,
  cropping: true,
  mediaType: 'photo' as const,
  cropperToolbarTitle: 'Edit album cover',
  cropperChooseText: 'Use photo',
  cropperCancelText: 'Cancel',
  compressImageQuality: 0.85,
  includeBase64: false,
  forceJpg: true,
};

function isPickerCancel(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
  return code === 'E_PICKER_CANCELLED' || code === 'E_PERMISSION_MISSING';
}

export async function pickAlbumCoverFromLibrary(): Promise<PickedAlbumCover | null> {
  try {
    const img: CroppedImage = await ImagePicker.openPicker(ALBUM_COVER_CROP_OPTIONS);
    return { uri: img.path, mime: img.mime || 'image/jpeg' };
  } catch (err) {
    if (isPickerCancel(err)) { return null; }
    throw err;
  }
}

export async function pickAlbumCoverFromCamera(): Promise<PickedAlbumCover | null> {
  try {
    const img: CroppedImage = await ImagePicker.openCamera({
      ...ALBUM_COVER_CROP_OPTIONS,
      useFrontCamera: false,
    });
    return { uri: img.path, mime: img.mime || 'image/jpeg' };
  } catch (err) {
    if (isPickerCancel(err)) { return null; }
    throw err;
  }
}

/**
 * Multipart upload to the same `avatars` bucket profileService uses — the
 * bucket's RLS just requires the first path segment to be the authenticated
 * user's id, which holds for `{userId}/album_cover_{ts}.jpg` paths. Returns
 * the public URL of the uploaded object.
 */
export async function uploadAlbumCover(
  userId: string,
  cover: PickedAlbumCover,
  accessToken: string,
): Promise<string> {
  const ext = cover.mime.includes('png') ? 'png' : cover.mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/album_cover_${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append('cacheControl', '3600');
  formData.append('', { uri: cover.uri, name: `cover.${ext}`, type: cover.mime } as unknown as Blob);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${AVATARS_BUCKET}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        'x-upsert': 'false',
      },
      body: formData,
    },
  );

  if (!res.ok) {
    let message = `Cover upload failed (HTTP ${res.status})`;
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed.message === 'string') { message = parsed.message; }
    } catch {}
    throw new Error(message);
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Used by FullScreenPlayer to show the "Album" row in its Info card.
// Returns null if the track is not in any album.
export async function fetchAlbumForTrack(trackId: string): Promise<AlbumForTrack | null> {
  const { data, error } = await supabase
    .from('album_tracks')
    .select(`
      album_id,
      album:albums ( id, title, cover_art_url )
    `)
    .eq('track_id', trackId)
    .maybeSingle();
  if (error) { throw new Error(error.message); }
  if (!data?.album) { return null; }
  const album = data.album as { id: string; title: string; cover_art_url: string | null };
  return { albumId: album.id, title: album.title, coverArtUrl: album.cover_art_url };
}
