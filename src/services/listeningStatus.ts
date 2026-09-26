/**
 * The chat "listening now" indicator — I/O.
 *
 * WRITE SIDE. The listener's device keeps its one `listen_sessions` row current:
 * `playing = true` + the track when playback starts or the track changes, a re-stamp
 * every LISTENING_HEARTBEAT_MS while it continues, `playing = false` on pause/stop.
 * `ListeningStatusReporter` feeds `setListeningTrack` from the playback state, and
 * GlobalAudioPlayer's progress callback calls `listeningTick` — progress events keep
 * arriving on the lock screen, where JS timers do not reliably fire, so the heartbeat
 * rides them rather than a setInterval. What to write and when is decided by the pure
 * `planListeningWrite` (src/utils/listeningStatus.ts).
 *
 * READ SIDE. `fetchListeningNow` calls `list_listening_now`, which returns only LIVE
 * rows plus `expires_in`, so the viewer hides a stale listener on time without
 * comparing its own clock to the server's. `subscribeListeningChanges` streams the
 * row changes (RLS-filtered per subscriber) so a pause shows within a second.
 *
 * Never throws: every failure degrades to "not shown", which is also what the
 * database converges to once the heartbeat stops.
 */
import { supabase } from '../../lib/supabase';
import {
  LISTENING_LIVE_WINDOW_MS,
  planListeningWrite,
  type ListeningTrack,
  type ReportedListening,
} from '../utils/listeningStatus';
import { getShowActivity } from './profileService';

export type { ListeningTrack } from '../utils/listeningStatus';

// ── Write side ──────────────────────────────────────────────────────────────

/** Back off this long after a failed write, so an offline phone does not retry 4×/s. */
const WRITE_RETRY_MS = 15_000;

let desired: ListeningTrack | null = null;
let reported: ReportedListening | null = null;
let reportedUserId: string | null = null;
/** The listener's "Show what I'm listening to" switch; null until read for this account. */
let shareAllowed: boolean | null = null;
let retryAfterMs = 0;
let inFlight = false;
/**
 * Writes run strictly one after another, so a `stop` can never be overtaken by an
 * older `start`, and `stopListeningNow` resolves only once its own write has landed.
 */
let chain: Promise<void> = Promise.resolve();

/** Called whenever what is playing changes. null = nothing is playing. */
export function setListeningTrack(track: ListeningTrack | null): void {
  desired = track;
  retryAfterMs = 0;
  void flush();
}

/**
 * Called from the player's progress callback (4×/s while playing). Synchronous and
 * allocation-free in the common case — it only reaches the network when a heartbeat
 * is actually due.
 */
export function listeningTick(): void {
  if (inFlight || Date.now() < retryAfterMs) { return; }
  if (planListeningWrite(desired, reported, Date.now(), shareAllowed ?? true).kind === 'none') {
    return;
  }
  void flush();
}

/**
 * The listener flipped "Show what I'm listening to" in Privacy. Off writes `playing = false`
 * immediately — but a viewer who is ALREADY looking at the pill does not receive that
 * change (RLS now hides the row from them, so realtime filters the event out too);
 * their copy expires locally within LISTENING_LIVE_WINDOW_MS. Same for unfriend/block.
 */
export function setShareListening(allowed: boolean): void {
  shareAllowed = allowed;
  retryAfterMs = 0;
  void flush();
}

/**
 * Take the status down before the session goes away (sign-out). After sign-out the
 * write would be refused, and the row would linger until it expires on its own.
 */
export async function stopListeningNow(): Promise<void> {
  desired = null;
  retryAfterMs = 0;
  await flush();
}

function flush(): Promise<void> {
  chain = chain.then(writeOnce);
  return chain;
}

/** Re-plans from the latest state at the moment it runs, so queued extras are no-ops. */
async function writeOnce(): Promise<void> {
  inFlight = true;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id ?? null;
    if (!uid) { reported = null; reportedUserId = null; return; }
    if (uid !== reportedUserId) {
      // Account switch: nothing has been told to the server for THIS account yet.
      reported = null;
      reportedUserId = uid;
      shareAllowed = null;
    }
    if (shareAllowed === null && desired) {
      // The server enforces the switch on READ as well (can_see_listening), so a
      // wrong guess here can never expose anything — it only costs a write.
      shareAllowed = await getShowActivity(uid).catch(() => true);
    }

    const now = Date.now();
    const plan = planListeningWrite(desired, reported, now, shareAllowed ?? true);
    if (plan.kind === 'none') { return; }

    const { error } = plan.kind === 'stop'
      ? await supabase.from('listen_sessions').update({ playing: false }).eq('user_id', uid)
      : await supabase.from('listen_sessions').upsert(
        {
          user_id: uid,
          // listen_sessions_text_len caps both at 200.
          track_title: plan.track.title.slice(0, 200),
          artist_name: plan.track.artistName.slice(0, 200),
          post_id: plan.track.postId,
          playing: true,
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      retryAfterMs = now + WRITE_RETRY_MS;
      return;
    }
    reported = plan.kind === 'stop'
      ? { postId: reported?.postId ?? null, playing: false, lastWriteMs: now }
      : { postId: plan.track.postId, playing: true, lastWriteMs: now };
  } catch {
    retryAfterMs = Date.now() + WRITE_RETRY_MS;
  } finally {
    inFlight = false;
  }
}

// ── Read side ───────────────────────────────────────────────────────────────

export type ListeningNow = {
  userId: string;
  title: string;
  artistName: string;
  /** What "Listen" opens. Null when the post was deleted. */
  postId: string | null;
  coverArtUrl: string | null;
  /** Local-clock time at which to stop showing this, absent a newer update. */
  expiresAtMs: number;
};

export async function fetchListeningNow(userIds: string[]): Promise<ListeningNow[]> {
  if (userIds.length === 0) { return []; }
  const { data, error } = await supabase.rpc('list_listening_now', { p_user_ids: userIds });
  if (error || !data) { return []; }
  const now = Date.now();
  return data.map(row => ({
    userId: row.user_id,
    title: row.track_title,
    artistName: row.artist_name,
    postId: row.post_id ?? null,
    coverArtUrl: row.cover_art_url ?? null,
    expiresAtMs: now + (row.expires_in ?? 0) * 1000,
  }));
}

export type ListeningRowChange = {
  userId: string;
  playing: boolean;
  postId: string | null;
  title: string;
  artistName: string;
};

/**
 * Stream changes to these users' rows. The payload carries the whole row, so the
 * caller can apply a heartbeat or a pause locally and only refetch (for cover art)
 * when the track actually changes. Returns the unsubscribe function.
 */
export function subscribeListeningChanges(
  userIds: string[],
  onChange: (change: ListeningRowChange) => void,
): () => void {
  if (userIds.length === 0) { return () => {}; }
  const channel = supabase
    .channel(`listening:${userIds.join(',').slice(0, 64)}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'listen_sessions', filter: `user_id=in.(${userIds.join(',')})` },
      (payload: { new?: Record<string, unknown> }) => {
        const row = payload.new;
        if (!row || typeof row.user_id !== 'string') { return; }
        onChange({
          userId: row.user_id,
          playing: row.playing === true,
          postId: typeof row.post_id === 'string' ? row.post_id : null,
          title: typeof row.track_title === 'string' ? row.track_title : '',
          artistName: typeof row.artist_name === 'string' ? row.artist_name : '',
        });
      },
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

/** A heartbeat for a track already on screen: keep it up for another live window. */
export function extendListening(entry: ListeningNow, change: ListeningRowChange): ListeningNow {
  return {
    ...entry,
    title: change.title || entry.title,
    artistName: change.artistName || entry.artistName,
    expiresAtMs: Date.now() + LISTENING_LIVE_WINDOW_MS,
  };
}
