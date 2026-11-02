import {
  LISTENING_EXPIRY_GRACE_MS,
  LISTENING_HEARTBEAT_MS,
  LISTENING_LIVE_WINDOW_MS,
  dropExpiredListeners,
  listeningExpiryAt,
  listeningTrackFor,
  nextListeningCheckMs,
  planListeningWrite,
  type ListeningTrack,
  type ReportedListening,
} from '../listeningStatus';

const KESARIYA: ListeningTrack = { postId: 'p1', title: 'Kesariya', artistName: 'Arijit Singh' };
const TUM_HI_HO: ListeningTrack = { postId: 'p2', title: 'Tum Hi Ho', artistName: 'Arijit Singh' };
const T0 = 1_000_000;

const playing = (postId: string, lastWriteMs = T0): ReportedListening =>
  ({ postId, playing: true, lastWriteMs });

describe('planListeningWrite', () => {
  it('starts when playback begins and nothing was reported yet', () => {
    expect(planListeningWrite(KESARIYA, null, T0, true)).toEqual({ kind: 'start', track: KESARIYA });
  });

  it('starts again after a pause', () => {
    const paused: ReportedListening = { postId: 'p1', playing: false, lastWriteMs: T0 };
    expect(planListeningWrite(KESARIYA, paused, T0 + 5_000, true))
      .toEqual({ kind: 'start', track: KESARIYA });
  });

  it('re-sends on a track change even inside the heartbeat window', () => {
    expect(planListeningWrite(TUM_HI_HO, playing('p1'), T0 + 1_000, true))
      .toEqual({ kind: 'start', track: TUM_HI_HO });
  });

  it('writes nothing for the same track before the heartbeat is due', () => {
    // This is the bound on cost: progress events arrive 4×/s, writes at most 1×/min.
    expect(planListeningWrite(KESARIYA, playing('p1'), T0 + LISTENING_HEARTBEAT_MS - 1, true))
      .toEqual({ kind: 'none' });
  });

  it('beats once the heartbeat is due', () => {
    expect(planListeningWrite(KESARIYA, playing('p1'), T0 + LISTENING_HEARTBEAT_MS, true))
      .toEqual({ kind: 'beat', track: KESARIYA });
  });

  it('stops when playback stops', () => {
    expect(planListeningWrite(null, playing('p1'), T0, true)).toEqual({ kind: 'stop' });
  });

  it('writes nothing when nothing is playing and nothing was reported', () => {
    expect(planListeningWrite(null, null, T0, true)).toEqual({ kind: 'none' });
    const paused: ReportedListening = { postId: 'p1', playing: false, lastWriteMs: T0 };
    expect(planListeningWrite(null, paused, T0, true)).toEqual({ kind: 'none' });
  });

  describe('"Show what I\'m listening to" OFF', () => {
    it('never starts', () => {
      expect(planListeningWrite(KESARIYA, null, T0, false)).toEqual({ kind: 'none' });
    });

    it('takes down a status that was already showing', () => {
      expect(planListeningWrite(KESARIYA, playing('p1'), T0 + 1_000, false)).toEqual({ kind: 'stop' });
    });
  });

  it('heartbeats well inside the live window, so one dropped beat is survivable', () => {
    expect(LISTENING_HEARTBEAT_MS).toBeLessThan(LISTENING_LIVE_WINDOW_MS / 2);
  });
});

describe('listeningTrackFor', () => {
  const base = { title: 'Test 3', artistName: 'Vvk' };

  it('publishes an upload as itself', () => {
    expect(listeningTrackFor({ ...base, postId: 'up1', kind: 'upload', originalPostId: null }))
      .toEqual({ postId: 'up1', title: 'Test 3', artistName: 'Vvk' });
  });

  it('publishes a repost as its ORIGINAL upload, so a friend of the listener can open it', () => {
    // Reposts are visible only to the reposter's friends; the original upload is public.
    expect(listeningTrackFor({ ...base, postId: 'rp1', kind: 'repost', originalPostId: 'up1' }).postId)
      .toBe('up1');
  });

  it('falls back to the repost itself when the original is gone', () => {
    expect(listeningTrackFor({ ...base, postId: 'rp1', kind: 'repost', originalPostId: null }).postId)
      .toBe('rp1');
  });
});

// The chat list kept a listener's bars up after their iPhone app was swiped away (owner,
// 2026-11-02): a killed app never writes "stopped", so the viewer's own expiry is all there is.
describe('listeningExpiryAt', () => {
  const NOW = 5_000_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  it('a fresh heartbeat keeps the listener up for one full window', () => {
    expect(listeningExpiryAt(iso(NOW), NOW, NOW)).toBe(NOW + LISTENING_LIVE_WINDOW_MS);
  });

  it('a heartbeat delivered late keeps them up only for what is left of its window', () => {
    // Written 100 s ago (buffered while the app was frozen): 50 s left, not another 150.
    expect(listeningExpiryAt(iso(NOW - 100_000), NOW, NOW)).toBe(NOW + 50_000);
  });

  it('a heartbeat older than the window is already over', () => {
    expect(listeningExpiryAt(iso(NOW - 200_000), NOW, NOW)).toBe(NOW);
  });

  it('works on this phone\'s clock when it differs from the server\'s', () => {
    // Phone 3 minutes slow; the server stamped it 10 s ago by the server's clock.
    const phoneNow = NOW - 180_000;
    expect(listeningExpiryAt(iso(NOW - 10_000), phoneNow, NOW)).toBe(phoneNow + 140_000);
  });

  it('never more than one window from now, even for a stamp from the future', () => {
    expect(listeningExpiryAt(iso(NOW + 60_000), NOW, NOW)).toBe(NOW + LISTENING_LIVE_WINDOW_MS);
  });

  it('without a known server clock or a readable stamp, one window from receipt (as before)', () => {
    expect(listeningExpiryAt(iso(NOW - 100_000), NOW, null)).toBe(NOW + LISTENING_LIVE_WINDOW_MS);
    expect(listeningExpiryAt(null, NOW, NOW)).toBe(NOW + LISTENING_LIVE_WINDOW_MS);
    expect(listeningExpiryAt('not a time', NOW, NOW)).toBe(NOW + LISTENING_LIVE_WINDOW_MS);
  });
});

describe('dropExpiredListeners / nextListeningCheckMs', () => {
  const riya = { expiresAtMs: 1_000 };
  const sam = { expiresAtMs: 5_000 };

  it('drops only the expired, and keeps the same map when nobody expired', () => {
    const map = new Map([['riya', riya], ['sam', sam]]);
    expect([...dropExpiredListeners(map, 1_000).keys()]).toEqual(['sam']);
    expect(dropExpiredListeners(map, 999)).toBe(map);
  });

  it('looks again just after the soonest expiry, and not at all for an empty list', () => {
    const map = new Map([['riya', riya], ['sam', sam]]);
    expect(nextListeningCheckMs(map, 400)).toBe(600 + LISTENING_EXPIRY_GRACE_MS);
    // Already past: look at once (plus the grace), never a negative wait.
    expect(nextListeningCheckMs(map, 2_000)).toBe(LISTENING_EXPIRY_GRACE_MS);
    expect(nextListeningCheckMs(new Map(), 0)).toBeNull();
  });
});
