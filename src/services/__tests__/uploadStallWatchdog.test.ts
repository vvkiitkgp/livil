/**
 * The upload stall watchdog.
 *
 * This exists because of a real report: an upload sat at 80% "for a very long time" and
 * the only way out was force-quitting the app. `xhr.onerror` covers a connection that
 * FAILS and `xhr.onabort` one the user cancels; a connection that simply goes quiet —
 * signal lost mid-upload, or a carrier proxy holding the socket open — fires neither, and
 * an XHR has no time limit unless one is set.
 *
 * Like the failure path in `publishTrackCleanup.test.ts`, this code only runs when
 * something breaks, so nothing would notice if it silently stopped working. And its
 * failure mode cuts both ways: too lax and the upload hangs forever again; too strict and
 * a large video on a slow connection is killed mid-flight for no reason. Both directions
 * are asserted below.
 */

// `uploads.ts` reaches the document picker's native module at import time, and the
// Supabase client at module scope. Neither is involved in the watchdog; both would
// otherwise fail the suite before a single assertion runs.
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {},
}));

import { RESPONSE_TIMEOUT_MS, STALL_TIMEOUT_MS } from '../uploads';

/** The smallest fake that behaves like the parts of XHR the uploader touches. */
class FakeXHR {
  static last: FakeXHR;
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
    onloadend?: () => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 200;
  responseText = '{}';
  aborted = false;
  sent = false;

  open() {}
  setRequestHeader() {}
  send() { this.sent = true; FakeXHR.last = this; }
  abort() { this.aborted = true; this.onabort?.(); }

  /** Drive a progress tick the way a healthy upload would. */
  tick(loaded: number, total = 100) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
}

describe('upload stall watchdog', () => {
  let uploadFile: (onProgress: (f: number) => void) => Promise<void>;

  beforeEach(() => {
    jest.useFakeTimers();
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
    jest.isolateModules(() => {
      // Required lazily so the fake XHR is in place first.
      const mod = require('../uploads') as typeof import('../uploads');
      uploadFile = (onProgress) =>
        (mod as unknown as {
          __uploadFileUriWithProgressForTest: (
            path: string, kind: string, uri: string, name: string,
            type: string, token: string, cb: (f: number) => void,
          ) => Promise<void>;
        }).__uploadFileUriWithProgressForTest(
          'p', 'audio', 'file:///a.mp3', 'a.mp3', 'audio/mpeg', 'tok', onProgress,
        );
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  it('rejects when the connection goes quiet, instead of hanging forever', async () => {
    const p = uploadFile(() => {});
    const failed = p.catch((e: Error) => e.message);

    FakeXHR.last.tick(40);                       // reaches 40%, then the signal dies
    jest.advanceTimersByTime(STALL_TIMEOUT_MS + 1);

    expect(FakeXHR.last.aborted).toBe(true);
    await expect(failed).resolves.toMatch(/connection stalled/i);
  });

  it('does NOT kill a slow upload that is still moving', async () => {
    const p = uploadFile(() => {});
    let settled = false;
    void p.then(() => { settled = true; }, () => { settled = true; });

    // Crawling, but alive: a tick just inside the window, ten times over. A total-time
    // limit (`xhr.timeout`) would have killed this; an idle limit must not.
    for (let i = 1; i <= 10; i++) {
      jest.advanceTimersByTime(STALL_TIMEOUT_MS - 1_000);
      FakeXHR.last.tick(i * 10);
    }

    expect(FakeXHR.last.aborted).toBe(false);
    expect(settled).toBe(false);

    FakeXHR.last.upload.onloadend?.();
    FakeXHR.last.onload?.();
    await expect(p).resolves.toBeUndefined();
  });

  it('gives the server longer to answer once the last byte is sent', async () => {
    const p = uploadFile(() => {});
    const failed = p.catch((e: Error) => e.message);

    FakeXHR.last.tick(100);
    FakeXHR.last.upload.onloadend?.();          // body sent; storage now writes the object

    // Past the stall window — a large file legitimately takes this long here.
    jest.advanceTimersByTime(STALL_TIMEOUT_MS + 1_000);
    expect(FakeXHR.last.aborted).toBe(false);

    // But not forever.
    jest.advanceTimersByTime(RESPONSE_TIMEOUT_MS);
    expect(FakeXHR.last.aborted).toBe(true);
    await expect(failed).resolves.toMatch(/connection stalled/i);
  });

  it('still reports a genuine user cancel as a cancel, not as a stall', async () => {
    const p = uploadFile(() => {});
    const failed = p.catch((e: Error) => e.message);

    FakeXHR.last.tick(20);
    FakeXHR.last.abort();                        // the user backed out

    await expect(failed).resolves.toBe('Upload aborted.');
  });

  it('leaves no timer running after a successful upload', async () => {
    const p = uploadFile(() => {});
    FakeXHR.last.tick(100);
    FakeXHR.last.upload.onloadend?.();
    FakeXHR.last.onload?.();
    await p;
    // A watchdog that outlives its request would abort the NEXT one.
    expect(jest.getTimerCount()).toBe(0);
  });
});
