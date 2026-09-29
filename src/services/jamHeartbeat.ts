import { supabase } from '../../lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** How often the host's app records "I'm still here" in the database. */
export const JAM_HEARTBEAT_MS = 30_000;

let target: string | null = null;
let lastBeatAt = 0;

/** The jam this device HOSTS, or null. Set by JamRealtimeProvider. */
export function setJamHeartbeatTarget(jamRoomId: string | null): void {
  if (jamRoomId !== target) { lastBeatAt = 0; }
  target = jamRoomId;
}

/**
 * Record the host heartbeat (jam_host_heartbeat) at most once per JAM_HEARTBEAT_MS.
 *
 * Called from two places on purpose: a JS interval (covers the host sitting paused in
 * the app) AND GlobalAudioPlayer's progress callback — progress events keep arriving
 * with the screen locked, when JS timers may not, and a host listening on a locked phone
 * must not have their jam ended as "away". A no-op when this device hosts nothing.
 */
export function jamHeartbeatTick(isPlaying: boolean): void {
  if (!target) { return; }
  const now = Date.now();
  if (now - lastBeatAt < JAM_HEARTBEAT_MS) { return; }
  lastBeatAt = now;
  void db.rpc('jam_host_heartbeat', { p_jam_room_id: target, p_is_playing: isPlaying });
}
