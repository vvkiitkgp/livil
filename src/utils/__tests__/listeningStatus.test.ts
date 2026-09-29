import {
  LISTENING_HEARTBEAT_MS,
  LISTENING_LIVE_WINDOW_MS,
  listeningTrackFor,
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
