/**
 * The early upload ("staging"): the song (the moment it is picked) or the video (once the
 * artist moves on from its step) is uploaded and copyright-checked while the rest of the
 * form is filled in, so a match is raised early instead of after the whole form.
 *
 * WHY THESE ARE PINNED
 *
 * A staged file is a real file in a public bucket with no post pointing at it — invisible,
 * and permanent unless something removes it. So the failure paths matter more than the
 * happy one: backing out at the copyright question, the screen moving on mid-upload, a
 * failed publish and a killed app must each leave NOTHING behind. The answer to the
 * copyright question must still be recorded only for a track that was actually posted —
 * after its post exists — exactly as before staging existed. And staging must NEVER ask
 * the question itself: on iOS an unprompted dialog over the photo picker is refused, and
 * the upload would wait on it forever.
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

const mockScan = jest.fn();
const mockAck = jest.fn(async () => true);
jest.mock('../../../shared/services/copyrightScan', () => ({
  scanUpload: (...a: unknown[]) => mockScan(...a),
  acknowledgeScan: (...a: unknown[]) => mockAck(...(a as [])),
  needsAcknowledgement: (r: { status?: string; matchFound?: boolean | null } | null) =>
    r?.status === 'complete' && r.matchFound === true,
}));
jest.mock('../../../shared/services/uploadConsent', () => ({
  recordUploadConsent: jest.fn(async () => true),
}));

/** What the fake database saw. */
const mockDb = {
  trackInserts: [] as Array<Record<string, unknown>>,
  deletedTracks: [] as string[],
  removedPaths: [] as string[][],
  updates: [] as Array<Record<string, unknown>>,
  credits: [] as Array<Record<string, unknown>>,
  postsForTrack: {} as Record<string, string[]>,
  failPostInsert: false,
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    from: (table: string) => ({
      insert: (row: unknown) => {
        if (table === 'track_collaborators') { mockDb.credits.push(...(row as Array<Record<string, unknown>>)); }
        if (table === 'tracks') { mockDb.trackInserts.push(row as Record<string, unknown>); }
        const single = async () => {
          if (table === 'posts' && mockDb.failPostInsert) {
            return { data: null, error: { message: 'posts insert exploded' } };
          }
          return { data: { id: table === 'tracks' ? 't1' : 'p1' }, error: null };
        };
        return Object.assign(Promise.resolve({ error: null }), { select: () => ({ single }) });
      },
      update: (row: Record<string, unknown>) => ({
        eq: async () => { mockDb.updates.push(row); return { error: null }; },
      }),
      delete: () => ({
        eq: async (_c: string, id: string) => { mockDb.deletedTracks.push(id); return { error: null }; },
      }),
      select: () => ({
        eq: (_c: string, trackId: string) => ({
          limit: async () => ({ data: (mockDb.postsForTrack[trackId] ?? []).map(id => ({ id })), error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        list: async (prefix: string) => ({ data: [{ name: 'audio.mp3' }], error: null, prefix }),
        remove: async (paths: string[]) => { mockDb.removedPaths.push(paths); return { error: null }; },
      }),
    },
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  publishStagedTrack,
  stageMediaUpload,
  StagingAbandonedError,
  sweepStagedUploads,
  UploadCancelledError,
  type StagedUpload,
} from '../tracks';

const SONG = { uri: 'file:///c/Monsoon%20Letters.wav', name: 'Monsoon Letters.wav', type: 'audio/wav', size: 41_000_000 } as never;
const COVER = { uri: 'file:///c/cover.jpg', name: 'cover.jpg', type: 'image/jpeg', size: 200_000 } as never;
const CLIP = { uri: 'file:///c/Jailer%202.mov', name: 'Jailer 2.mov', type: 'video/quicktime', size: 180_000_000 } as never;
const THUMB = { uri: 'file:///c/thumb.jpg', name: 'thumb.jpg', type: 'image/jpeg', size: 150_000 } as never;
const NO_MATCH = { status: 'complete', matchFound: false };
const MATCH = { status: 'complete', matchFound: true, title: 'Kesariya', artist: 'Arijit Singh' };
const OWNED = { acknowledgement: 'self_recorded' } as never;

const never = () => false;

beforeEach(async () => {
  mockDb.trackInserts = [];
  mockDb.deletedTracks = [];
  mockDb.removedPaths = [];
  mockDb.updates = [];
  mockDb.credits = [];
  mockDb.postsForTrack = {};
  mockDb.failPostInsert = false;
  mockUpload.mockReset().mockImplementation(async (_f: unknown, kind: string) => `https://cdn/me/t1/${kind}`);
  mockScan.mockReset().mockResolvedValue(NO_MATCH);
  mockAck.mockClear();
  await AsyncStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('stageMediaUpload', () => {
  it('uploads the song, saves its URL, checks it, and keeps it when nothing matches', async () => {
    const progress: string[] = [];
    const staged = await stageMediaUpload(SONG, 'audio', p => progress.push(p.stage), never);

    expect(staged).toMatchObject({
      trackId: 't1',
      userId: 'me',
      mediaKind: 'audio',
      mediaUrl: 'https://cdn/me/t1/audio',
      declaration: null,
    });
    expect(mockDb.updates).toContainEqual({ audio_url: 'https://cdn/me/t1/audio' });
    expect(mockScan).toHaveBeenCalledTimes(1);
    // The whole song, not one excerpt: the check runs behind the remaining steps.
    expect(mockScan).toHaveBeenCalledWith(expect.anything(), 't1', { fullSong: true });
    // Compressed for streaming first (mediaCompression.ts), then uploaded, then checked.
    expect(progress[0]).toBe('preparing');
    expect(progress).toContain('uploading');
    expect(progress[progress.length - 1]).toBe('checking');
    expect(mockDb.deletedTracks).toEqual([]);
  });

  it('reports a match without asking about it — the screen asks on a tap', async () => {
    mockScan.mockResolvedValue(MATCH);

    const staged = await stageMediaUpload(SONG, 'audio', () => {}, never);

    expect(staged.scan).toEqual(MATCH);
    expect(staged.declaration).toBeNull();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDb.deletedTracks).toEqual([]);
  });

  it('removes what it wrote when the screen moved on during the upload', async () => {
    let gone = false;
    mockUpload.mockImplementation(async () => { gone = true; return 'https://cdn/me/t1/audio'; });

    await expect(stageMediaUpload(SONG, 'audio', () => {}, () => gone)).rejects.toBeInstanceOf(StagingAbandonedError);

    expect(mockScan).not.toHaveBeenCalled(); // never paid for a check nobody will see
    expect(mockDb.deletedTracks).toEqual(['t1']);
    // Kept for the next sweep: a stopped upload's file can still land after the removal.
    expect(JSON.parse((await AsyncStorage.getItem('livil.upload.staged.v1')) ?? '[]'))
      .toEqual([{ trackId: 't1', userId: 'me' }]);
  });

  it('sends nothing when dropped while the row was being created', async () => {
    // Still wanted at sign-in and through the preparation, dropped by the time the row exists.
    const droppedAfterInsert = () => mockDb.trackInserts.length > 0;
    await expect(stageMediaUpload(CLIP, 'video', () => {}, droppedAfterInsert)).rejects.toBeInstanceOf(StagingAbandonedError);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDb.deletedTracks).toEqual(['t1']);
  });

  it('removes what it wrote when the upload fails, and forgets it', async () => {
    mockUpload.mockRejectedValue(new Error('network'));

    await expect(stageMediaUpload(SONG, 'audio', () => {}, never)).rejects.toThrow('network');

    expect(mockDb.deletedTracks).toEqual(['t1']);
    expect(JSON.parse((await AsyncStorage.getItem('livil.upload.staged.v1')) ?? '[]')).toEqual([]);
  });

  it('stages a video as a video row, and checks its whole sound', async () => {
    const staged = await stageMediaUpload(CLIP, 'video', () => {}, never);

    // `tracks_media_shape_check`: a video row has a video_url and NO audio_url.
    expect(mockDb.trackInserts[0]).toMatchObject({
      media_kind: 'video',
      video_url: 'pending://placeholder',
      audio_url: null,
    });
    expect(mockUpload.mock.calls[0][1]).toBe('video');
    expect(mockDb.updates).toContainEqual({ video_url: 'https://cdn/me/t1/video' });
    expect(mockScan).toHaveBeenCalledWith(expect.anything(), 't1', { fullSong: true });
    expect(staged).toMatchObject({ mediaKind: 'video', mediaUrl: 'https://cdn/me/t1/video' });
  });

  it('hands the stop signal to the upload, and a stopped upload is "abandoned", not a failure', async () => {
    const controller = new AbortController();
    let gone = false;
    mockUpload.mockImplementation(async (...a: unknown[]) => {
      // The screen swaps the video mid-upload: it marks the attempt over and stops it.
      expect(a[6]).toBe(controller.signal);
      gone = true;
      controller.abort();
      throw new Error('Upload aborted.');
    });

    await expect(stageMediaUpload(CLIP, 'video', () => {}, () => gone, controller.signal))
      .rejects.toBeInstanceOf(StagingAbandonedError);

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockDb.deletedTracks).toEqual(['t1']);
  });
});

describe('publishStagedTrack', () => {
  const staged: StagedUpload = {
    trackId: 't1',
    userId: 'me',
    mediaKind: 'audio',
    mediaUrl: 'https://cdn/me/t1/audio',
    file: SONG,
    scan: MATCH as never,
    declaration: OWNED,
  };
  const input = {
    mode: 'audio' as const,
    title: '  Monsoon Letters ',
    description: 'Recorded in the rain',
    audio: SONG,
    cover: COVER,
    uploaderRoles: ['Vocals'],
    collaborators: [],
    tags: ['chill'],
    durationSeconds: 222,
    streamingGrantAccepted: true,
  };

  it('uploads only the cover, writes the real title, and records the earlier answer without re-checking', async () => {
    const result = await publishStagedTrack(staged, input, undefined, jest.fn());

    expect(result).toMatchObject({ trackId: 't1', postId: 'p1' });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][1]).toBe('cover');
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockAck).toHaveBeenCalledWith(expect.anything(), 't1', OWNED);
    expect(mockDb.updates).toContainEqual(expect.objectContaining({
      title: 'Monsoon Letters',
      description: 'Recorded in the rain',
      tags: ['chill'],
      audio_url: 'https://cdn/me/t1/audio',
      cover_art_url: 'https://cdn/me/t1/cover',
      duration_seconds: 222,
    }));
    expect(mockDb.deletedTracks).toEqual([]);
  });

  it('saves each of the uploader\'s roles as its own credit, once each', async () => {
    await publishStagedTrack(staged, { ...input, uploaderRoles: ['Vocals', ' vocals ', 'Producer', ''] }, undefined, jest.fn());

    expect(mockDb.credits.filter(c => c.user_id === 'me').map(c => c.role)).toEqual(['Vocals', 'Producer']);
    expect(mockDb.credits.every(c => c.user_id !== 'me' || c.status === 'accepted')).toBe(true);
  });

  it('refuses to publish without any role, and removes the staged song', async () => {
    await expect(publishStagedTrack(staged, { ...input, uploaderRoles: ['  '] }, undefined, jest.fn()))
      .rejects.toThrow('Choose what you did on this track.');

    expect(mockDb.deletedTracks).toEqual(['t1']);
  });

  it('asks an unanswered match at Post, and records the answer', async () => {
    const ask = jest.fn(async () => OWNED);

    await publishStagedTrack({ ...staged, declaration: null }, input, undefined, ask);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith(expect.anything(), 't1', OWNED);
  });

  it('removes the song when the uploader backs out at Post, recording nothing', async () => {
    const ask = jest.fn(async () => ({ acknowledgement: 'cancelled' }) as never);

    await expect(publishStagedTrack({ ...staged, declaration: null }, input, undefined, ask))
      .rejects.toBeInstanceOf(UploadCancelledError);

    expect(mockDb.deletedTracks).toEqual(['t1']);
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('checks again at Post when the early check could not complete', async () => {
    const ask = jest.fn();
    await publishStagedTrack({ ...staged, scan: { status: 'failed', matchFound: null }, declaration: null }, input, undefined, ask);

    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockScan).toHaveBeenCalledWith(expect.anything(), 't1', { fullSong: true });
    expect(ask).not.toHaveBeenCalled(); // the re-check found nothing
  });

  it('removes the staged song and records no answer when publishing fails', async () => {
    mockDb.failPostInsert = true;

    await expect(publishStagedTrack(staged, input, undefined, jest.fn())).rejects.toThrow('posts insert exploded');

    expect(mockDb.deletedTracks).toEqual(['t1']);
    // The answer row would outlive the track: never written for a post that never existed.
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('removes the staged song when the input is refused before anything uploads', async () => {
    await expect(publishStagedTrack(staged, { ...input, title: '  ' }, undefined, jest.fn()))
      .rejects.toThrow('Title is required.');

    expect(mockDb.deletedTracks).toEqual(['t1']);
  });

  describe('a staged video', () => {
    const stagedVideo: StagedUpload = {
      ...staged,
      mediaKind: 'video',
      mediaUrl: 'https://cdn/me/t1/video',
      scan: NO_MATCH as never,
      declaration: null,
    };
    const videoInput = {
      mode: 'video' as const,
      title: 'Jailer 2 is lit',
      description: '',
      video: CLIP,
      thumbnail: THUMB,
      cover: COVER,
      uploaderRoles: ['Director'],
      collaborators: [],
      tags: [],
      durationSeconds: 59,
      streamingGrantAccepted: true,
    };

    it('uploads only the pictures, and keeps the video it already has', async () => {
      await publishStagedTrack(stagedVideo, videoInput, undefined, jest.fn());

      expect(mockUpload.mock.calls.map(c => c[1]).sort()).toEqual(['cover', 'thumbnail']);
      expect(mockScan).not.toHaveBeenCalled();
      expect(mockDb.updates).toContainEqual(expect.objectContaining({
        video_url: 'https://cdn/me/t1/video',
        audio_url: null,
        thumbnail_url: 'https://cdn/me/t1/thumbnail',
        cover_art_url: 'https://cdn/me/t1/cover',
      }));
      expect(mockDb.deletedTracks).toEqual([]);
    });

    it('works without the optional cover', async () => {
      await publishStagedTrack(stagedVideo, { ...videoInput, cover: undefined }, undefined, jest.fn());

      expect(mockUpload.mock.calls.map(c => c[1])).toEqual(['thumbnail']);
    });

    it('refuses a post of the other type, and removes the staged video', async () => {
      await expect(publishStagedTrack(stagedVideo, input, undefined, jest.fn()))
        .rejects.toThrow('The staged file does not match this post.');

      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockDb.deletedTracks).toEqual(['t1']);
    });
  });
});

describe('sweepStagedUploads', () => {
  it("removes this account's song staged before the app was killed, and only forgets one that got its post", async () => {
    await AsyncStorage.setItem('livil.upload.staged.v1', JSON.stringify([
      { trackId: 'orphan', userId: 'me' },
      { trackId: 'posted', userId: 'me' },
    ]));
    mockDb.postsForTrack = { posted: ['p9'] };

    await sweepStagedUploads();

    expect(mockDb.deletedTracks).toEqual(['orphan']);
    expect(JSON.parse((await AsyncStorage.getItem('livil.upload.staged.v1')) ?? '[]')).toEqual([]);
  });

  it("leaves another account's leftovers for that account — the delete would be refused", async () => {
    await AsyncStorage.setItem('livil.upload.staged.v1', JSON.stringify([
      { trackId: 'theirs', userId: 'someone-else' },
    ]));

    await sweepStagedUploads();

    expect(mockDb.deletedTracks).toEqual([]);
    expect(JSON.parse((await AsyncStorage.getItem('livil.upload.staged.v1')) ?? '[]'))
      .toEqual([{ trackId: 'theirs', userId: 'someone-else' }]);
  });
});
