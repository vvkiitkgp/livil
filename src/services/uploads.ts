import { supabase } from '../../lib/supabase';

export const TRACKS_MEDIA_BUCKET = 'tracks-media';

export type TrackMediaKind = 'audio' | 'video' | 'cover';

export type PickedFile = {
  uri: string;
  name: string | null;
  type: string | null;
  size: number | null;
};

function extensionFromName(name: string | null, fallback: string): string {
  if (!name) {return fallback;}
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) {return fallback;}
  return name.slice(dot + 1).toLowerCase();
}

function defaultExtensionFor(kind: TrackMediaKind, mime: string | null): string {
  if (mime) {
    if (mime.includes('mpeg')) {return 'mp3';}
    if (mime.includes('aac')) {return 'aac';}
    if (mime.includes('wav')) {return 'wav';}
    if (mime.includes('ogg')) {return 'ogg';}
    if (mime.includes('flac')) {return 'flac';}
    if (mime.includes('mp4') && kind === 'audio') {return 'm4a';}
    if (mime.includes('mp4')) {return 'mp4';}
    if (mime.includes('quicktime')) {return 'mov';}
    if (mime.includes('webm')) {return 'webm';}
    if (mime.includes('jpeg')) {return 'jpg';}
    if (mime.includes('png')) {return 'png';}
    if (mime.includes('webp')) {return 'webp';}
    if (mime.includes('heic')) {return 'heic';}
  }
  if (kind === 'audio') {return 'mp3';}
  if (kind === 'video') {return 'mp4';}
  return 'jpg';
}

export async function uploadTrackFile(
  file: PickedFile,
  kind: TrackMediaKind,
  trackId: string,
  userId: string,
): Promise<string> {
  const ext = extensionFromName(file.name, defaultExtensionFor(kind, file.type));
  const path = `${userId}/${trackId}/${kind}.${ext}`;

  const response = await fetch(file.uri);
  if (!response.ok && response.status !== 0) {
    throw new Error(`Failed to read local file (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const contentType = file.type ?? `${kind === 'cover' ? 'image' : kind}/*`;

  const { error: uploadError } = await supabase.storage
    .from(TRACKS_MEDIA_BUCKET)
    .upload(path, arrayBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed (${kind}): ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(TRACKS_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
