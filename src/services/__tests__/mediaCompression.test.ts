/**
 * On-device compression before upload (mediaCompression.ts, ADR-0034).
 *
 * WHY THESE ARE PINNED
 *
 * Compression is an optimisation of WHAT is uploaded and must never decide WHETHER it is:
 * a phone whose codec refuses the file, a build without the native module, a re-encode
 * that comes out bigger — each must quietly upload the original, exactly as before this
 * existed. The one exception is the caller's own abort, which must NOT fall back (a file
 * the artist just removed must not be uploaded anyway). And a file that is already fine —
 * a small MP4, any lossy song — must not be re-encoded, because that only loses quality.
 *
 * `react-native-compressor` is the manual mock in `<rootDir>/__mocks__`, overridden here
 * per test.
 */
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: { storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: path } }) }) } },
}));

import * as compressor from 'react-native-compressor';
import {
  __resetCompressorForTests,
  AbortError,
  audioNeedsCompression,
  compressedPickedFile,
  prepareMediaForUpload,
  videoNeedsCompression,
  VIDEO_MAX_FPS,
  VIDEO_MAX_LONG_SIDE,
  VIDEO_TARGET_BITRATE,
  AUDIO_TARGET_BITRATE,
} from '../mediaCompression';
import type { PickedFile } from '../uploads';

const Video = compressor.Video as unknown as { compress: jest.Mock; cancelCompression: jest.Mock };
const Audio = compressor.Audio as unknown as { compress: jest.Mock };
const getVideoMetaData = compressor.getVideoMetaData as unknown as jest.Mock;
const getFileSize = compressor.getFileSize as unknown as jest.Mock;

const MB = 1024 * 1024;

/** A 27 s 4K/60 phone recording at ~38 Mbps. */
const PHONE_4K: PickedFile = { uri: 'file:///cache/IMG_0421.MOV', name: 'IMG_0421.MOV', type: 'video/quicktime', size: 127 * MB };
const PHONE_4K_META = { width: 2160, height: 3840, duration: 27, size: 127 * MB, extension: 'mov' };
/** What the re-encode produces: 1080×1920 at ~3.5 Mbps. */
const PHONE_4K_OUT = { width: 1080, height: 1920, duration: 27, size: 12 * MB, extension: 'mp4' };

const WAV: PickedFile = { uri: 'file:///cache/master.wav', name: 'Monsoon Letters (master).wav', type: 'audio/wav', size: 50 * MB };

beforeEach(() => {
  jest.clearAllMocks();
  __resetCompressorForTests();
  const notAvailable = () => Promise.reject(new Error('mock: compression unavailable'));
  Video.compress.mockImplementation(notAvailable);
  Audio.compress.mockImplementation(notAvailable);
  getVideoMetaData.mockImplementation(notAvailable);
  getFileSize.mockImplementation(notAvailable);
});

describe('videoNeedsCompression — what is already fine passes through', () => {
  it('leaves an MP4 that is ≤ 1080p and ≤ 4 Mbps alone', () => {
    // 1080×1920, 29 s, 5 MB → ~1.4 Mbps
    expect(videoNeedsCompression({ width: 1080, height: 1920, duration: 29, size: 5 * MB, extension: 'mp4' })).toBe(false);
  });

  it('re-encodes a 4K recording however small its bitrate', () => {
    expect(videoNeedsCompression({ ...PHONE_4K_META, extension: 'mp4', size: 10 * MB })).toBe(true);
  });

  it('re-encodes a 1080p MP4 whose bitrate is over 4 Mbps', () => {
    // 1080×1920, 37 s at 15 Mbps ≈ 70 MB
    expect(videoNeedsCompression({ width: 1080, height: 1920, duration: 37, size: 70 * MB, extension: 'mp4' })).toBe(true);
  });

  it('re-encodes a .mov even when small — the container is normalised too', () => {
    expect(videoNeedsCompression({ width: 1080, height: 1920, duration: 29, size: 5 * MB, extension: 'mov' })).toBe(true);
  });

  it('re-encodes when the probe failed: unknown errs on compressing', () => {
    expect(videoNeedsCompression(null)).toBe(true);
    expect(videoNeedsCompression({ width: 1080, height: 1920, duration: 0, size: 0, extension: 'mp4' })).toBe(true);
  });
});

describe('audioNeedsCompression — lossless is re-encoded, lossy is not', () => {
  it.each(['song.wav', 'song.WAV', 'song.aiff', 'song.aif', 'song.flac', 'song.caf'])('compresses %s', name => {
    expect(audioNeedsCompression({ name, type: null })).toBe(true);
  });

  it.each(['song.mp3', 'song.m4a', 'song.aac', 'song.ogg', 'song.opus'])('passes %s through', name => {
    expect(audioNeedsCompression({ name, type: null })).toBe(false);
  });

  it('falls back to the declared type when there is no file name', () => {
    expect(audioNeedsCompression({ name: null, type: 'audio/mpeg' })).toBe(false);
    expect(audioNeedsCompression({ name: null, type: 'audio/wav' })).toBe(true);
    expect(audioNeedsCompression({ name: null, type: null })).toBe(true);
  });
});

describe('compressedPickedFile — the artist keeps their file name', () => {
  it('names a video <original base>.mp4 and declares video/mp4', () => {
    expect(compressedPickedFile(PHONE_4K, 'video', 'file:///cache/out.mp4', 12 * MB)).toEqual({
      uri: 'file:///cache/out.mp4',
      name: 'IMG_0421.mp4',
      type: 'video/mp4',
      size: 12 * MB,
    });
  });

  it('names a song <original base>.m4a and declares the bucket spelling audio/x-m4a', () => {
    expect(compressedPickedFile(WAV, 'audio', 'file:///cache/out.m4a', 6 * MB)).toEqual({
      uri: 'file:///cache/out.m4a',
      name: 'Monsoon Letters (master).m4a',
      type: 'audio/x-m4a',
      size: 6 * MB,
    });
  });
});

describe('prepareMediaForUpload — video', () => {
  it('re-encodes a 4K/60 recording to the streaming targets and uploads the smaller MP4', async () => {
    getVideoMetaData
      .mockResolvedValueOnce(PHONE_4K_META)
      .mockResolvedValueOnce(PHONE_4K_OUT);
    Video.compress.mockImplementation(async (_uri: string, _opts: unknown, onProgress?: (f: number) => void) => {
      onProgress?.(0.5);
      return 'file:///cache/abc.mp4';
    });
    const progress: Array<number | null> = [];

    const out = await prepareMediaForUpload(PHONE_4K, 'video', { onProgress: f => progress.push(f) });

    expect(out).toEqual({ uri: 'file:///cache/abc.mp4', name: 'IMG_0421.mp4', type: 'video/mp4', size: 12 * MB });
    expect(Video.compress).toHaveBeenCalledWith(
      PHONE_4K.uri,
      expect.objectContaining({
        compressionMethod: 'manual',
        maxSize: VIDEO_MAX_LONG_SIDE,
        bitrate: VIDEO_TARGET_BITRATE,
        maxFrameRate: VIDEO_MAX_FPS,
      }),
      expect.any(Function),
    );
    expect(progress).toEqual([0, 0.5, 1]);
  });

  it('uploads the original when the re-encode throws', async () => {
    getVideoMetaData.mockResolvedValueOnce(PHONE_4K_META);
    Video.compress.mockRejectedValueOnce(new Error('codec refused'));

    await expect(prepareMediaForUpload(PHONE_4K, 'video')).resolves.toBe(PHONE_4K);
  });

  it('uploads the original when the re-encode is not smaller', async () => {
    getVideoMetaData
      .mockResolvedValueOnce({ ...PHONE_4K_META, extension: 'mov', size: 10 * MB })
      .mockResolvedValueOnce({ ...PHONE_4K_OUT, size: 11 * MB });
    Video.compress.mockResolvedValueOnce('file:///cache/abc.mp4');

    const out = await prepareMediaForUpload({ ...PHONE_4K, size: 10 * MB }, 'video');

    expect(out.uri).toBe(PHONE_4K.uri);
  });

  it('does not touch an MP4 that is already small enough', async () => {
    const fine: PickedFile = { uri: 'file:///cache/clip.mp4', name: 'clip.mp4', type: 'video/mp4', size: 5 * MB };
    getVideoMetaData.mockResolvedValueOnce({ width: 1080, height: 1920, duration: 29, size: 5 * MB, extension: 'mp4' });

    await expect(prepareMediaForUpload(fine, 'video')).resolves.toBe(fine);
    expect(Video.compress).not.toHaveBeenCalled();
  });

  it('cancels a running re-encode on abort and rejects — it does NOT fall back to the original', async () => {
    getVideoMetaData.mockResolvedValueOnce(PHONE_4K_META);
    const controller = new AbortController();
    Video.compress.mockImplementation((_uri: string, opts: { getCancellationId?: (id: string) => void }) => {
      opts.getCancellationId?.('job-1');
      return new Promise<string>((_resolve, reject) => {
        // The screen moves on mid-encode; the native side then rejects the cancelled job.
        controller.signal.addEventListener('abort', () => reject(new Error('compression has been cancelled')));
      });
    });

    const task = prepareMediaForUpload(PHONE_4K, 'video', { signal: controller.signal });
    await new Promise(r => setTimeout(r, 0));
    controller.abort();

    await expect(task).rejects.toBeInstanceOf(AbortError);
    expect(Video.compress).toHaveBeenCalledTimes(1);
    expect(Video.cancelCompression).toHaveBeenCalledWith('job-1');
  });

  it('remembers the result per file, so Post does not re-encode what the early upload prepared', async () => {
    getVideoMetaData
      .mockResolvedValueOnce(PHONE_4K_META)
      .mockResolvedValueOnce(PHONE_4K_OUT);
    Video.compress.mockResolvedValueOnce('file:///cache/abc.mp4');

    const first = await prepareMediaForUpload(PHONE_4K, 'video');
    const second = await prepareMediaForUpload(PHONE_4K, 'video');

    expect(second).toBe(first);
    expect(Video.compress).toHaveBeenCalledTimes(1);
  });
});

describe('prepareMediaForUpload — audio', () => {
  it('re-encodes a WAV to AAC 256 kbps and uploads the .m4a', async () => {
    Audio.compress.mockResolvedValueOnce('file:///cache/abc.m4a');
    getFileSize.mockResolvedValueOnce(String(6 * MB));

    const out = await prepareMediaForUpload(WAV, 'audio');

    expect(out).toEqual({ uri: 'file:///cache/abc.m4a', name: 'Monsoon Letters (master).m4a', type: 'audio/x-m4a', size: 6 * MB });
    expect(Audio.compress).toHaveBeenCalledWith(WAV.uri, { bitrate: AUDIO_TARGET_BITRATE });
  });

  it('leaves an MP3 alone', async () => {
    const mp3: PickedFile = { uri: 'file:///cache/song.mp3', name: 'song.mp3', type: 'audio/mpeg', size: 4 * MB };

    await expect(prepareMediaForUpload(mp3, 'audio')).resolves.toBe(mp3);
    expect(Audio.compress).not.toHaveBeenCalled();
  });

  it('uploads the original WAV when the encoder fails', async () => {
    Audio.compress.mockRejectedValueOnce(new Error('No audio track'));

    await expect(prepareMediaForUpload(WAV, 'audio')).resolves.toBe(WAV);
  });

  it('uploads the original when the output cannot even be measured', async () => {
    Audio.compress.mockResolvedValueOnce('file:///cache/abc.m4a');
    getFileSize.mockRejectedValueOnce(new Error('FILE_SIZE_ERROR'));

    await expect(prepareMediaForUpload(WAV, 'audio')).resolves.toBe(WAV);
  });
});

describe('prepareMediaForUpload — without the native module', () => {
  it('uploads the original when react-native-compressor cannot be loaded', async () => {
    jest.isolateModules(() => {
      jest.doMock('react-native-compressor', () => { throw new Error("The package 'react-native-compressor' doesn't seem to be linked."); });
    });
    const fresh = jest.requireActual('../mediaCompression') as typeof import('../mediaCompression');
    fresh.__resetCompressorForTests();

    await expect(fresh.prepareMediaForUpload(WAV, 'audio')).resolves.toBe(WAV);
  });
});
