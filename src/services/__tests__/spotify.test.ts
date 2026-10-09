/**
 * Spotify card metadata cache (ADR-0027).
 *
 * The two bugs this pins were found in review before shipping:
 *  - a FAILED call (Spotify rate-limiting us, a network blip) must not be remembered as
 *    "no such song" for the rest of the session — the card would say "Song unavailable"
 *    until the app restarts, and the song could not be reposted at all;
 *  - many cards mounting at once must cost ONE request, not one each.
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

const ID_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const ID_B = 'BBBBBBBBBBBBBBBBBBBBBB';
const TRACK_A = { id: ID_A, title: 'Blinding Lights', artists: ['The Weeknd'], album: null, imageUrl: null, durationMs: null };

// Fresh module per test: the cache is module-level by design.
function load(): typeof import('../spotify') {
  let mod: typeof import('../spotify');
  jest.isolateModules(() => { mod = require('../spotify'); });
  return mod!;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockInvoke.mockReset();
  mockRpc.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(100);
}

describe('getSpotifyTrack', () => {
  it('batches cards that ask in the same moment into one call', async () => {
    const { getSpotifyTrack } = load();
    mockInvoke.mockResolvedValue({ data: { tracks: { [ID_A]: TRACK_A, [ID_B]: null } }, error: null });
    const a = getSpotifyTrack(ID_A);
    const b = getSpotifyTrack(ID_B);
    const a2 = getSpotifyTrack(ID_A);
    await settle();
    await expect(a).resolves.toEqual(TRACK_A);
    await expect(a2).resolves.toEqual(TRACK_A);
    await expect(b).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: 'tracks', ids: [ID_A, ID_B] });
  });

  it('remembers real answers — including "no such song" — and does not ask again', async () => {
    const { getSpotifyTrack } = load();
    mockInvoke.mockResolvedValue({ data: { tracks: { [ID_A]: TRACK_A, [ID_B]: null } }, error: null });
    getSpotifyTrack(ID_A);
    getSpotifyTrack(ID_B);
    await settle();
    await expect(getSpotifyTrack(ID_A)).resolves.toEqual(TRACK_A);
    await expect(getSpotifyTrack(ID_B)).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does NOT remember a failed call — the next card retries', async () => {
    const { getSpotifyTrack } = load();
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    const first = getSpotifyTrack(ID_A);
    await settle();
    await expect(first).resolves.toBeNull();

    mockInvoke.mockResolvedValueOnce({ data: { tracks: { [ID_A]: TRACK_A } }, error: null });
    const second = getSpotifyTrack(ID_A);
    await settle();
    await expect(second).resolves.toEqual(TRACK_A);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('does NOT remember an id the server left out (its transient-failure signal)', async () => {
    const { getSpotifyTrack } = load();
    mockInvoke.mockResolvedValueOnce({ data: { tracks: {} }, error: null });
    const first = getSpotifyTrack(ID_A);
    await settle();
    await expect(first).resolves.toBeNull();

    mockInvoke.mockResolvedValueOnce({ data: { tracks: { [ID_A]: TRACK_A } }, error: null });
    const second = getSpotifyTrack(ID_A);
    await settle();
    await expect(second).resolves.toEqual(TRACK_A);
  });

  it('never calls the server for something that is not a Spotify id', async () => {
    const { getSpotifyTrack } = load();
    await expect(getSpotifyTrack('../../etc')).resolves.toBeNull();
    await settle();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('getSpotifyAvailability', () => {
  it('reads the switch from the database and search from the function', async () => {
    const { getSpotifyAvailability } = load();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockInvoke.mockResolvedValue({ data: { search: true }, error: null });
    await expect(getSpotifyAvailability()).resolves.toEqual({ reposts: true, search: true });
    expect(mockRpc).toHaveBeenCalledWith('spotify_reposts_enabled');
  });

  it('is OFF when the database function does not exist yet (migration not applied)', async () => {
    const { getSpotifyAvailability } = load();
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'not deployed' } });
    await expect(getSpotifyAvailability()).resolves.toEqual({ reposts: false, search: false });
  });
});

describe('searchSpotifyOrFail', () => {
  // The Repost-from-Spotify screen must tell "no matches" from "Spotify refused": the
  // function answers 502 when Spotify turns a search down, and showing
  // `Nothing on Spotify for "…"` for that reads as a broken feature.
  it('is null when the search FAILED, not an empty list', async () => {
    const { searchSpotifyOrFail } = load();
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } });
    await expect(searchSpotifyOrFail('taylor swift')).resolves.toBeNull();
  });

  it('is an empty list when Spotify answered with no matches', async () => {
    const { searchSpotifyOrFail } = load();
    mockInvoke.mockResolvedValue({ data: { tracks: [] }, error: null });
    await expect(searchSpotifyOrFail('zzqqxx nothing')).resolves.toEqual([]);
  });

  it('returns the matches when there are some', async () => {
    const { searchSpotifyOrFail } = load();
    mockInvoke.mockResolvedValue({ data: { tracks: [TRACK_A] }, error: null });
    await expect(searchSpotifyOrFail('blinding')).resolves.toEqual([TRACK_A]);
  });

  it('does not call Spotify for a one-letter query', async () => {
    const { searchSpotifyOrFail } = load();
    await expect(searchSpotifyOrFail('a')).resolves.toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('searchSpotify', () => {
  // The Search tab and the chat picker only ever hide their Spotify section, so a failure
  // stays an empty list for them.
  it('turns a failed search into an empty list', async () => {
    const { searchSpotify } = load();
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(searchSpotify('taylor swift')).resolves.toEqual([]);
  });
});
