/**
 * What `scanUpload` asks the server for, and how long it waits.
 *
 * The whole-song check is a REQUEST the client makes (`fullSong: true`), so the app
 * already in the stores — which never sends it and gives up after 20 s — keeps the quick
 * check. These pin both halves: the field is sent only when asked for, and the longer
 * wait applies only to that request.
 */
import {
  FULL_SONG_SCAN_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  scanUpload,
} from '../../../shared/services/copyrightScan';

type Invoke = (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;

function clientWith(invoke: Invoke) {
  return { functions: { invoke } } as unknown as Parameters<typeof scanUpload>[0];
}

const CLEAN = { data: { status: 'complete', matchFound: false }, error: null };

describe('scanUpload request', () => {
  afterEach(() => jest.useRealTimers());

  it('sends only the track id unless the whole song is asked for', async () => {
    const invoke = jest.fn<ReturnType<Invoke>, Parameters<Invoke>>().mockResolvedValue(CLEAN);
    await scanUpload(clientWith(invoke), 't1');
    expect(invoke).toHaveBeenCalledWith('scan-upload', { body: { trackId: 't1' } });
  });

  it('asks for the whole song when told to', async () => {
    const invoke = jest.fn<ReturnType<Invoke>, Parameters<Invoke>>().mockResolvedValue(CLEAN);
    const out = await scanUpload(clientWith(invoke), 't1', { fullSong: true });
    expect(invoke).toHaveBeenCalledWith('scan-upload', { body: { trackId: 't1', fullSong: true } });
    expect(out.status).toBe('complete');
  });

  it('waits longer for a whole-song answer than for the quick one', async () => {
    jest.useFakeTimers();
    const never: Invoke = () => new Promise(() => {});

    let quick: string | null = null;
    void scanUpload(clientWith(never), 't1').then(r => { quick = r.status; });
    let whole: string | null = null;
    void scanUpload(clientWith(never), 't1', { fullSong: true }).then(r => { whole = r.status; });

    await jest.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS);
    expect(quick).toBe('failed'); // gave up, upload proceeds unchecked
    expect(whole).toBeNull(); // still waiting

    await jest.advanceTimersByTimeAsync(FULL_SONG_SCAN_TIMEOUT_MS - SCAN_TIMEOUT_MS);
    expect(whole).toBe('failed');
  });
});
