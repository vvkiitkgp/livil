/**
 * What an upload does when the connection, not the server, stopped it — see
 * `uploadRecovery.ts`. The screen's recovery (the copy, Try again, the one automatic retry)
 * is decided here so it can be pinned without rendering the 2,000-line upload screen.
 */
import {
  AUTO_RETRY_DELAY_MS,
  autoRetryDelay,
  interruptionCopy,
  isFetchFailure,
  isUploadNetworkError,
  UploadNetworkError,
  withTimeout,
} from '../uploadRecovery';

describe('isUploadNetworkError', () => {
  it('recognises the class, and a second copy of it by name', () => {
    expect(isUploadNetworkError(new UploadNetworkError('upload', 'stalled'))).toBe(true);
    // Jest's isolated registries and a Metro reload can load the class twice.
    const twin = Object.assign(new Error('stalled'), { name: 'UploadNetworkError' });
    expect(isUploadNetworkError(twin)).toBe(true);
  });

  it('is false for everything a retry would not fix', () => {
    expect(isUploadNetworkError(new Error('This video is over the 500 MB upload limit.'))).toBe(false);
    expect(isUploadNetworkError(new Error('Upload aborted.'))).toBe(false);
    expect(isUploadNetworkError(null)).toBe(false);
    expect(isUploadNetworkError('stalled')).toBe(false);
  });
});

describe('isFetchFailure', () => {
  it('matches what supabase-js returns when the request never reached the server', () => {
    // postgrest-js, React Native wording / an aborted request / its generic fallback
    expect(isFetchFailure({ message: 'TypeError: Network request failed' })).toBe(true);
    expect(isFetchFailure({ message: 'AbortError: Aborted' })).toBe(true);
    expect(isFetchFailure({ message: 'FetchError: socket hang up' })).toBe(true);
    // auth-js
    expect(isFetchFailure({ name: 'AuthRetryableFetchError', message: 'anything', status: 0 })).toBe(true);
  });

  it('does not match an answer the server gave', () => {
    expect(isFetchFailure({ message: 'new row violates row-level security policy for table "tracks"' })).toBe(false);
    expect(isFetchFailure({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(false);
    expect(isFetchFailure({ message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isFetchFailure(null)).toBe(false);
  });
});

describe('withTimeout', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('passes a prompt answer straight through and leaves no timer', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, () => new Error('late'))).resolves.toBe(7);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('passes a prompt failure through unchanged', async () => {
    const boom = new Error('refused');
    await expect(withTimeout(Promise.reject(boom), 1000, () => new Error('late'))).rejects.toBe(boom);
  });

  it('rejects with the timeout error when nothing comes back in time', async () => {
    const p = withTimeout(new Promise(() => {}), 1000, () => new UploadNetworkError('x', 'no answer'));
    const caught = p.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(isUploadNetworkError(await caught)).toBe(true);
  });

  it('hands a late answer to onLate (to undo a write that landed after all), and ignores a late failure', async () => {
    let land: (v: string) => void = () => {};
    let fail: (e: Error) => void = () => {};
    const onLate = jest.fn();
    const a = withTimeout(new Promise<string>(r => { land = r; }), 1000, () => new Error('t'), onLate).catch(() => 'timed out');
    const b = withTimeout(new Promise<string>((_r, j) => { fail = j; }), 1000, () => new Error('t'), onLate).catch(() => 'timed out');

    await jest.advanceTimersByTimeAsync(1000);
    await expect(a).resolves.toBe('timed out');
    await expect(b).resolves.toBe('timed out');

    land('row-42');
    fail(new Error('also late'));
    await Promise.resolve();
    expect(onLate).toHaveBeenCalledTimes(1);
    expect(onLate).toHaveBeenCalledWith('row-42');
  });
});

describe('autoRetryDelay — once, and only on a working connection', () => {
  it('retries a connection failure by itself, after a short pause, while online', () => {
    expect(autoRetryDelay({ network: true, offline: false, autoRetryUsed: false })).toBe(AUTO_RETRY_DELAY_MS);
  });

  it('waits while offline — the screen asks again when the connection is back', () => {
    expect(autoRetryDelay({ network: true, offline: true, autoRetryUsed: false })).toBeNull();
  });

  it('never twice', () => {
    expect(autoRetryDelay({ network: true, offline: false, autoRetryUsed: true })).toBeNull();
  });

  it('never for a failure the server answered (too big, wrong format…)', () => {
    expect(autoRetryDelay({ network: false, offline: false, autoRetryUsed: false })).toBeNull();
  });
});

describe('interruptionCopy — never a silent freeze', () => {
  const reason = 'The connection stalled and the upload stopped. Check your signal and try again.';

  it('offline: waiting for connection, saying it restarts by itself, with Try again', () => {
    const c = interruptionCopy({ offline: true, autoRetryUsed: false, reason });
    expect(c.title).toBe('Waiting for connection…');
    expect(c.body).toMatch(/by itself/);
    expect(c.showTryAgain).toBe(true);
  });

  it('online, retry about to start: says so, and offers nothing to press', () => {
    const c = interruptionCopy({ offline: false, autoRetryUsed: false, reason });
    expect(c.title).toMatch(/trying again/i);
    expect(c.showTryAgain).toBe(false);
  });

  it('after the automatic retry: interrupted, with the reason and Try again', () => {
    const c = interruptionCopy({ offline: false, autoRetryUsed: true, reason });
    expect(c).toEqual({ title: 'Upload interrupted', body: reason, showTryAgain: true });
  });

  it('after the automatic retry, offline: does not promise a restart it will not do', () => {
    const c = interruptionCopy({ offline: true, autoRetryUsed: true, reason });
    expect(c.title).toBe('Upload interrupted');
    expect(c.body).not.toMatch(/by itself/);
    expect(c.showTryAgain).toBe(true);
  });
});
