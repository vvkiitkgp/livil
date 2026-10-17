/**
 * Lossless masters are never decoded from the network.
 *
 * Remote `decodeAudioData` downloads the whole file into memory through RN networking.
 * Fine for an MP3; for a WAV — ~10 MB a minute, up to the 500 MB mobile cap — it is the
 * same OutOfMemoryError that rules out analyzing video, and it would happen on a
 * LISTENER's phone, on every play, because failures are not cached.
 *
 * WAV uploads from iPhone were refused by storage until 2026-10-11, so this path had never
 * met a lossless file in production. Pinned here before it does.
 */
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const mockDecode = jest.fn();
jest.mock('react-native-audio-api', () => ({ decodeAudioData: (...a: unknown[]) => mockDecode(...a) }));

// A track with no stored envelope yet, so the only way to a synced wave is to analyze.
const mockUnanalyzed = {
  select: () => mockUnanalyzed,
  eq: () => mockUnanalyzed,
  maybeSingle: async () => ({ data: { waveform_peaks: null }, error: null }),
};
jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: { from: () => mockUnanalyzed },
}));

import { getOrAnalyzeWaveform } from '../tracks';

const CDN = 'https://example.test/storage/v1/object/public/tracks-media/u';

beforeEach(() => {
  mockDecode.mockReset();
  mockDecode.mockRejectedValue(new Error('not decoded in this test'));
});

describe('getOrAnalyzeWaveform — lossless guard', () => {
  it.each(['wav', 'WAV', 'aiff', 'aif', 'aifc', 'flac'])('never downloads a .%s to analyze it', async ext => {
    const result = await getOrAnalyzeWaveform(`track-${ext}`, `${CDN}/track-${ext}/audio.${ext}`);
    expect(result).toBeNull();
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('also sees through a query string', async () => {
    await getOrAnalyzeWaveform('track-q', `${CDN}/track-q/audio.wav?t=1`);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it.each(['mp3', 'm4a', 'aac'])('still analyzes a compressed .%s', async ext => {
    await getOrAnalyzeWaveform(`track-c-${ext}`, `${CDN}/track-c-${ext}/audio.${ext}`);
    expect(mockDecode).toHaveBeenCalledTimes(1);
  });
});
