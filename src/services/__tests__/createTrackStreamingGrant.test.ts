/**
 * The streaming grant on mobile uploads.
 *
 * `createTrack` records a `terms_acceptances` row saying the uploader granted Livil the
 * right to stream this track. That row is only honest if somebody was actually asked, so
 * the screen shows a required checkbox — and `createTrack` refuses to start without it, so
 * no future caller can skip the question and still write the row.
 *
 * Asserted here: the refusal happens BEFORE anything touches the network — no session
 * read, no track row, no bytes.
 */
// Native modules `tracks.ts` reaches at import time; none is involved in this check.
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));

const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a), getSession: (...a: unknown[]) => mockGetSession(...a) },
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

import { createTrack, type CreateTrackInput } from '../tracks';

const FILE = { uri: 'file:///a.mp3', name: 'a.mp3', type: 'audio/mpeg', size: 100 } as never;

const audioInput = (streamingGrantAccepted: boolean): CreateTrackInput => ({
  mode: 'audio',
  title: 'Monsoon Letters',
  audio: FILE,
  cover: FILE,
  uploaderRole: 'Vocals',
  collaborators: [],
  streamingGrantAccepted,
});

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetSession.mockReset();
  mockFrom.mockReset();
});

describe('createTrack — streaming grant', () => {
  it('refuses to upload without the grant, before touching the network', async () => {
    await expect(createTrack(audioInput(false))).rejects.toThrow(/stream this recording/);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('proceeds past the check when the grant is ticked', async () => {
    // Signed out, so it stops at the next gate — which proves the grant check let it by.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(createTrack(audioInput(true))).rejects.toThrow(/signed in/);
    expect(mockGetUser).toHaveBeenCalled();
  });
});
