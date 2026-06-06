import { supabase } from '../../lib/supabase';
import { sendMessage } from './messages';
import type { NowPlayingInfo } from '../contexts/PlaybackContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type JamPermissions = {
  can_play_pause: boolean;
  can_seek: boolean;
  can_skip: boolean;
  can_change_track: boolean;
  can_suggest: boolean;
};

export type JamRoomState = {
  jamRoomId: string;
  hostId: string;
  hostUsername: string;
  playbackPositionMs: number;
  isPlaying: boolean;
  hostClockAt: string | null;
};

export type QueueItem = {
  id: string;
  trackId: string;
  suggestedBy: string | null;
  suggestedByUsername: string | null;
  position: number;
  upvotes: number;
  trackTitle: string | null;
  trackArtist: string | null;
  trackCoverArt: string | null;
};

export async function createJamRoom(
  conversationId: string,
  nowPlaying?: NowPlayingInfo | null,
): Promise<string> {
  const { data, error } = await db.rpc('create_jam_room', {
    p_conversation_id: conversationId,
  });
  if (error) { throw error; }
  const jamRoomId = data as string;

  // If currently playing, snapshot the track id into the room
  if (nowPlaying?.trackId) {
    await db
      .from('jam_rooms')
      .update({ current_track_id: nowPlaying.trackId })
      .eq('id', jamRoomId);
  }

  // Send a jam_invite message so conversation members can join
  try {
    await sendMessage(conversationId, {
      kind: 'jam_invite',
      metadata: { jam_room_id: jamRoomId },
    });
  } catch {
    // Non-fatal — jam still created
  }

  return jamRoomId;
}

export async function joinJamRoom(jamRoomId: string): Promise<JamRoomState> {
  const { data, error } = await db.rpc('get_jam_snapshot', {
    p_jam_room_id: jamRoomId,
  });
  if (error) { throw error; }
  const row = data as Record<string, unknown>;
  return {
    jamRoomId: row.jam_room_id as string,
    hostId: row.host_id as string,
    hostUsername: (row.host_username as string | null) ?? 'Unknown',
    playbackPositionMs: Number(row.playback_position_ms ?? 0),
    isPlaying: Boolean(row.is_playing),
    hostClockAt: (row.host_clock_at as string | null) ?? null,
  };
}

export async function getMyJamPermissions(jamRoomId: string): Promise<JamPermissions> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {
    return { can_play_pause: false, can_seek: false, can_skip: false, can_change_track: false, can_suggest: true };
  }

  const { data } = await db
    .from('jam_room_members')
    .select('permissions')
    .eq('jam_room_id', jamRoomId)
    .eq('user_id', me)
    .maybeSingle();

  if (!data) {
    return { can_play_pause: false, can_seek: false, can_skip: false, can_change_track: false, can_suggest: true };
  }

  const p = (data as { permissions: JamPermissions }).permissions;
  return p;
}

export async function leaveJamRoom(jamRoomId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('jam_room_members')
    .delete()
    .eq('jam_room_id', jamRoomId)
    .eq('user_id', me);
}

export async function isJamRoomEnded(jamRoomId: string): Promise<boolean> {
  const { data } = await db
    .from('jam_rooms')
    .select('status')
    .eq('id', jamRoomId)
    .single();
  return data?.status === 'ended';
}

export async function endJamRoom(
  jamRoomId: string,
  conversationId: string,
): Promise<void> {
  await db
    .from('jam_rooms')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', jamRoomId);

  try {
    await sendMessage(conversationId, {
      kind: 'system' as never,
      body: 'The Jam Room has ended.',
      metadata: null,
    } as never);
  } catch {
    // Non-fatal
  }
}

export async function updatePlaybackState(
  jamRoomId: string,
  state: { positionMs: number; isPlaying: boolean },
): Promise<void> {
  await db
    .from('jam_rooms')
    .update({
      playback_position_ms: state.positionMs,
      is_playing: state.isPlaying,
      host_clock_at: new Date().toISOString(),
    })
    .eq('id', jamRoomId);
}

export async function getJamQueue(jamRoomId: string): Promise<QueueItem[]> {
  const { data: queueRows, error } = await db
    .from('jam_queue')
    .select('id, track_id, suggested_by, position, upvotes')
    .eq('jam_room_id', jamRoomId)
    .order('position', { ascending: true });

  if (error || !queueRows || queueRows.length === 0) { return []; }

  const rows = queueRows as { id: string; track_id: string; suggested_by: string | null; position: number; upvotes: number }[];

  const trackIds = rows.map(r => r.track_id).filter(Boolean);
  const suggesterIds = rows.map(r => r.suggested_by).filter((id): id is string => !!id);

  // tracks.artist_name doesn't exist — artist comes from tracks.uploader_id → profiles
  const { data: tracksData } = trackIds.length > 0
    ? await db.from('tracks').select('id, title, cover_art_url, uploader_id').in('id', trackIds)
    : { data: [] };

  const tracks = (tracksData ?? []) as {
    id: string; title: string | null; cover_art_url: string | null; uploader_id: string | null;
  }[];

  const uploaderIds = [...new Set(tracks.map(t => t.uploader_id).filter((id): id is string => !!id))];
  const allProfileIds = [...new Set([...uploaderIds, ...suggesterIds])];

  const { data: profilesData } = allProfileIds.length > 0
    ? await db.from('profiles').select('id, username, display_name').in('id', allProfileIds)
    : { data: [] };

  const trackMap = new Map<string, { title: string | null; cover_art_url: string | null; uploader_id: string | null }>();
  for (const t of tracks) { trackMap.set(t.id, t); }

  const profileMap = new Map<string, { username: string; displayName: string | null }>();
  for (const p of (profilesData ?? []) as { id: string; username: string; display_name: string | null }[]) {
    profileMap.set(p.id, { username: p.username, displayName: p.display_name });
  }

  return rows.map(r => {
    const track = trackMap.get(r.track_id);
    const uploader = track?.uploader_id ? profileMap.get(track.uploader_id) : null;
    const suggester = r.suggested_by ? profileMap.get(r.suggested_by) : null;
    return {
      id: r.id,
      trackId: r.track_id,
      suggestedBy: r.suggested_by,
      suggestedByUsername: suggester?.username ?? null,
      position: r.position,
      upvotes: r.upvotes,
      trackTitle: track?.title ?? null,
      trackArtist: uploader ? (uploader.displayName ?? uploader.username) : null,
      trackCoverArt: track?.cover_art_url ?? null,
    };
  });
}

export async function addToQueue(jamRoomId: string, trackId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  // Get next position
  const { data: last } = await db
    .from('jam_queue')
    .select('position')
    .eq('jam_room_id', jamRoomId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPos = ((last as { position: number } | null)?.position ?? 0) + 1;

  await db.from('jam_queue').insert({
    jam_room_id: jamRoomId,
    track_id: trackId,
    suggested_by: me,
    position: nextPos,
    upvotes: 0,
  });
}

export async function bulkAddToQueue(jamRoomId: string, trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) { return; }
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  const rows = trackIds.map((trackId, i) => ({
    jam_room_id: jamRoomId,
    track_id: trackId,
    suggested_by: me,
    position: i + 1,
    upvotes: 0,
  }));

  await db.from('jam_queue').insert(rows);
}

export async function upvoteQueue(queueItemId: string): Promise<void> {
  await db.rpc('upvote_queue_item', { p_item_id: queueItemId });
}
