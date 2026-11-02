/**
 * The network steps AROUND an upload: the sign-in check, creating the track row, and the
 * clean-up after a failure.
 *
 * WHY THESE ARE PINNED
 *
 * An upload sat at 0% with no way forward after the phone's network went bad / switched
 * from Wi-Fi to mobile data (2026-11-02). The file upload has its own stall watchdog
 * (`uploadStallWatchdog.test.ts`), but React Native's Android networking has no time limits
 * at all and supabase-js sets none — so the requests before the upload, and the clean-up
 * after a stalled one, could wait for minutes over a dead connection while the screen said
 * "Uploading · 0%" and could not be left. Every one of those paths only runs when the
 * network misbehaves, so nothing else would notice it coming back.
 *
 * Also pinned: a step that could not reach the server is an `UploadNetworkError` — what the
 * screen retries and offers Try again for — and never "You must be signed in".
 */
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../waveform', () => ({
  analyzeWaveformPeaks: jest.fn(async () => null),
  WAVEFORM_VERSION: 2,
}));

const mockUpload = jest.fn();
jest.mock('../uploads', () => ({
  uploadTrackFile: (...a: unknown[]) => mockUpload(...a),
  resolveReadableUri: jest.fn(async (f: { uri: string }) => f.uri),
  TRACKS_MEDIA_BUCKET: 'tracks-media',
}));
jest.mock('../../../shared/services/copyrightScan', () => ({
  scanUpload: jest.fn(async () => ({ status: 'complete', matchFound: false })),
  acknowledgeScan: jest.fn(async () => true),
  needsAcknowledgement: () => false,
}));

/** A promise that never settles: a request over a dead connection. */
const hang = <T,>() => new Promise<T>(() => {});

/** How each request answers in this test. */
const mockNet = {
  getUser: (): Promise<unknown> => Promise.resolve({ data: { user: { id: 'me' } }, error: null }),
  insert: (): Promise<unknown> => Promise.resolve({ data: { id: 't1' }, error: null }),
  deleteTrack: (): Promise<unknown> => Promise.resolve({ error: null }),
  deleted: [] as string[],
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockNet.getUser(),
      getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
    },
    from: () => ({
      insert: () => ({ select: () => ({ single: () => mockNet.insert() }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({
        eq: (_c: string, id: string) => {
          mockNet.deleted.push(id);
          return mockNet.deleteTrack();
        },
      }),
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CLEANUP_TIMEOUT_MS,
  createTrack,
  NETWORK_STEP_TIMEOUT_MS,
  stageMediaUpload,
} from '../tracks';
import { isUploadNetworkError, UploadNetworkError } from '../../utils/uploadRecovery';

const SONG = { uri: 'file:///c/song.wav', name: 'song.wav', type: 'audio/wav', size: 41_000_000 } as never;
const COVER = { uri: 'file:///c/cover.jpg', name: 'cover.jpg', type: 'image/jpeg', size: 200_000 } as never;
const never = () => false;
const stalled = () => new UploadNetworkError('upload', 'The connection stalled and the upload stopped.');
const remembered = async () => JSON.parse((await AsyncStorage.getItem('livil.upload.staged.v1')) ?? '[]');

/** Settles `p` into a value the test can inspect without an unhandled rejection. */
function outcome<T>(p: Promise<T>) {
  const box: { done: boolean; error?: unknown; value?: T } = { done: false };
  p.then(v => { box.done = true; box.value = v; }, e => { box.done = true; box.error = e; });
  return box;
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockNet.getUser = () => Promise.resolve({ data: { user: { id: 'me' } }, error: null });
  mockNet.insert = () => Promise.resolve({ data: { id: 't1' }, error: null });
  mockNet.deleteTrack = () => Promise.resolve({ error: null });
  mockNet.deleted = [];
  mockUpload.mockReset().mockImplementation(async (_f: unknown, kind: string) => `https://cdn/me/t1/${kind}`);
  await AsyncStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the steps before the upload', () => {
  it('gives up on a sign-in check that never answers, as a connection problem', async () => {
    mockNet.getUser = hang;
    const result = outcome(stageMediaUpload(SONG, 'audio', () => {}, never));

    await jest.advanceTimersByTimeAsync(NETWORK_STEP_TIMEOUT_MS - 1);
    expect(result.done).toBe(false);
    await jest.advanceTimersByTimeAsync(2);

    expect(result.done).toBe(true);
    expect(isUploadNetworkError(result.error)).toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('reports an offline sign-in check as no connection — not "You must be signed in"', async () => {
    // What auth-js answers when its fetch fails: no user, and a retryable fetch error.
    mockNet.getUser = async () => ({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
    });

    const err = await stageMediaUpload(SONG, 'audio', () => {}, never).catch(e => e);

    expect(isUploadNetworkError(err)).toBe(true);
    expect((err as Error).message).not.toMatch(/signed in/i);
  });

  it('still says "signed in" when the server really has no session', async () => {
    mockNet.getUser = async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } });

    const err = await stageMediaUpload(SONG, 'audio', () => {}, never).catch(e => e);

    expect(isUploadNetworkError(err)).toBe(false);
    expect((err as Error).message).toMatch(/signed in/i);
  });

  it('treats a row insert that never reached the server as no connection', async () => {
    mockNet.insert = async () => ({ data: null, error: { message: 'TypeError: Network request failed' } });

    const err = await createTrack({
      mode: 'audio', title: 'Song', audio: SONG, cover: COVER,
      uploaderRoles: ['Vocals'], collaborators: [], streamingGrantAccepted: true,
    }).catch(e => e);

    expect(isUploadNetworkError(err)).toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('removes a track row that lands after the insert was given up on', async () => {
    let land: (v: unknown) => void = () => {};
    mockNet.insert = () => new Promise(resolve => { land = resolve; });
    const result = outcome(stageMediaUpload(SONG, 'audio', () => {}, never));

    await jest.advanceTimersByTimeAsync(NETWORK_STEP_TIMEOUT_MS + 1);
    expect(isUploadNetworkError(result.error)).toBe(true);

    land({ data: { id: 't-late' }, error: null });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockNet.deleted).toContain('t-late');
  });
});

describe('the clean-up after a failed upload never holds the error back', () => {
  it('staging: reports the stall within the clean-up limit, and leaves the rest to the sweep', async () => {
    mockUpload.mockRejectedValue(stalled());
    mockNet.deleteTrack = hang; // the delete goes out over the same dead connection
    const result = outcome(stageMediaUpload(SONG, 'audio', () => {}, never));

    await jest.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS + 1);

    expect(result.done).toBe(true);
    expect(isUploadNetworkError(result.error)).toBe(true);
    // Not removed yet, so still remembered: the next visit's sweep finishes the job.
    expect(await remembered()).toEqual([{ trackId: 't1', userId: 'me' }]);
  });

  it('staging: a clean-up that finishes still forgets the reference, as before', async () => {
    mockUpload.mockRejectedValue(stalled());

    await expect(stageMediaUpload(SONG, 'audio', () => {}, never)).rejects.toThrow(/stalled/);

    expect(mockNet.deleted).toEqual(['t1']);
    expect(await remembered()).toEqual([]);
  });

  it('Post: reports the stall within the clean-up limit, and remembers the track for the sweep', async () => {
    mockUpload.mockImplementation(async (_f: unknown, kind: string) => {
      if (kind === 'audio') { throw stalled(); }
      return `https://cdn/me/t1/${kind}`;
    });
    mockNet.deleteTrack = hang;
    const result = outcome(createTrack({
      mode: 'audio', title: 'Song', audio: SONG, cover: COVER,
      uploaderRoles: ['Vocals'], collaborators: [], streamingGrantAccepted: true,
    }));

    await jest.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS + 1);

    expect(result.done).toBe(true);
    expect(isUploadNetworkError(result.error)).toBe(true);
    expect(await remembered()).toEqual([{ trackId: 't1', userId: 'me' }]);
  });

  it('Post: one file failing stops the others', async () => {
    const signals: AbortSignal[] = [];
    mockUpload.mockImplementation((_f: unknown, kind: string, ...rest: unknown[]) => {
      signals.push(rest[rest.length - 1] as AbortSignal);
      return kind === 'audio' ? Promise.reject(stalled()) : hang();
    });

    await expect(createTrack({
      mode: 'audio', title: 'Song', audio: SONG, cover: COVER,
      uploaderRoles: ['Vocals'], collaborators: [], streamingGrantAccepted: true,
    })).rejects.toThrow(/stalled/);

    expect(signals).toHaveLength(2);
    expect(signals.every(s => s.aborted)).toBe(true);
  });
});
