/**
 * The app side of the `gifs` edge function (ADR-0031). Fail-safe by contract: a missing
 * function or a failed call is "not available", never a thrown error — and a failed call
 * is never remembered as an answer.
 */
const mockInvoke = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

import {
  __resetGifsForTest,
  getGif,
  getGifsEnabled,
  prefetchGifs,
  rememberGif,
  searchGifs,
  type Gif,
} from '../gifs';

const gif = (id: string): Gif => ({
  id,
  provider: 'giphy',
  title: 'Happy Dance',
  width: 200,
  height: 150,
  url: `https://media2.giphy.com/media/${id}/200w.gif?cid=1`,
  previewUrl: `https://media2.giphy.com/media/${id}/200w_d.gif?cid=1`,
});
const ok = (data: unknown) => Promise.resolve({ data, error: null });
const fail = () => Promise.resolve({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } });

let warn: jest.SpyInstance;
beforeEach(() => {
  __resetGifsForTest();
  mockInvoke.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('availability', () => {
  it('is on only when the function says so', async () => {
    mockInvoke.mockReturnValueOnce(ok({ enabled: true }));
    expect(await getGifsEnabled()).toBe(true);
  });

  it('a missing function or no key is "off", not an error', async () => {
    mockInvoke.mockReturnValueOnce(fail());
    expect(await getGifsEnabled()).toBe(false);
    __resetGifsForTest();
    mockInvoke.mockReturnValueOnce(ok({ enabled: false }));
    expect(await getGifsEnabled()).toBe(false);
  });
});

describe('searchGifs', () => {
  it('holds the first trending page for a few minutes — every picker open starts there', async () => {
    mockInvoke.mockReturnValue(ok({ enabled: true, gifs: [gif('a1')], next: 18 }));
    await searchGifs('');
    await searchGifs('');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // A search, or a later trending page, is never served from it.
    await searchGifs('yay');
    await searchGifs('', 18);
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it('a failed trending call is not held', async () => {
    mockInvoke.mockReturnValueOnce(fail()).mockReturnValueOnce(ok({ enabled: true, gifs: [gif('a1')], next: null }));
    expect(await searchGifs('')).toBeNull();
    expect((await searchGifs(''))?.gifs).toHaveLength(1);
  });

  it('an empty query asks for trending; a query searches, trimmed', async () => {
    mockInvoke.mockReturnValue(ok({ enabled: true, gifs: [gif('a1')], next: 18 }));
    expect(await searchGifs('  ')).toEqual({ gifs: [gif('a1')], next: 18 });
    expect(mockInvoke).toHaveBeenLastCalledWith('gifs', { body: { action: 'trending', offset: 0 } });
    await searchGifs('  happy dance ', 18);
    expect(mockInvoke).toHaveBeenLastCalledWith('gifs', { body: { action: 'search', q: 'happy dance', offset: 18 } });
  });

  it('a failure is null, so the picker can say so instead of "No GIFs"', async () => {
    mockInvoke.mockReturnValueOnce(fail());
    expect(await searchGifs('yay')).toBeNull();
    mockInvoke.mockReturnValueOnce(ok({ enabled: false, gifs: [], next: null }));
    expect(await searchGifs('yay')).toBeNull();
  });

  it('drops anything without a valid id', async () => {
    mockInvoke.mockReturnValueOnce(ok({ enabled: true, gifs: [gif('a1'), gif('bad id')], next: null }));
    expect((await searchGifs('yay'))?.gifs.map(g => g.id)).toEqual(['a1']);
  });
});

describe('getGif', () => {
  it('batches cards that ask at the same moment into one lookup', async () => {
    mockInvoke.mockReturnValueOnce(ok({ gifs: { a1: gif('a1'), b2: null } }));
    const [a, b] = await Promise.all([getGif('a1'), getGif('b2')]);
    expect(a?.id).toBe('a1');
    expect(b).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('gifs', { body: { action: 'lookup', ids: ['a1', 'b2'] } });
    // Both answers are remembered — including "not available".
    await getGif('a1');
    await getGif('b2');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup is "could not ask" (undefined), not "gone" (null), and is retried', async () => {
    mockInvoke.mockReturnValueOnce(fail());
    expect(await getGif('a1')).toBeUndefined();
    mockInvoke.mockReturnValueOnce(ok({ gifs: { a1: gif('a1') } }));
    expect((await getGif('a1'))?.id).toBe('a1');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('an id the function left out (not answered) is retried too', async () => {
    mockInvoke.mockReturnValueOnce(ok({ gifs: {} }));
    expect(await getGif('a1')).toBeUndefined();
    mockInvoke.mockReturnValueOnce(ok({ gifs: { a1: gif('a1') } }));
    expect((await getGif('a1'))?.id).toBe('a1');
  });

  it('a GIF from the picker draws without a lookup', async () => {
    rememberGif(gif('a1'));
    expect((await getGif('a1'))?.id).toBe('a1');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('an id named like an object built-in is not mistaken for an answer', async () => {
    // "constructor" is valid base-62, so it can sit in a comment row; `in` would find
    // Object.prototype.constructor on the empty answer and cache it as a GIF.
    mockInvoke.mockReturnValueOnce(ok({ gifs: {} }));
    expect(await getGif('constructor')).toBeUndefined();
    mockInvoke.mockReturnValueOnce(ok({ gifs: { constructor: gif('constructor') } }));
    expect((await getGif('constructor'))?.id).toBe('constructor');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('a malformed answer is "not available", never a GIF without a URL', async () => {
    mockInvoke.mockReturnValueOnce(ok({ gifs: { a1: { id: 'a1' } } }));
    expect(await getGif('a1')).toBeNull();
  });

  it('a whole comment sheet is one lookup, however its rows mount', async () => {
    mockInvoke.mockReturnValueOnce(ok({ gifs: { a1: gif('a1'), b2: gif('b2'), c3: gif('c3') } }));
    prefetchGifs(['a1', 'b2', 'c3']);
    // Cards mounting later wait on that call instead of making their own.
    await new Promise(r => setTimeout(r, 60));
    const [a, c] = await Promise.all([getGif('a1'), getGif('c3')]);
    expect([a?.id, c?.id]).toEqual(['a1', 'c3']);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('more than one call\'s worth: an id in the second chunk is asked for once', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
    let resolveFirst!: (v: unknown) => void;
    mockInvoke
      .mockReturnValueOnce(new Promise(r => { resolveFirst = r; }))
      .mockImplementationOnce((_fn: string, { body }: { body: { ids: string[] } }) =>
        ok({ gifs: Object.fromEntries(body.ids.map(id => [id, gif(id)])) }));
    const all = Promise.all(ids.map(id => getGif(id)));
    await new Promise(r => setTimeout(r, 60));
    // While the first chunk is in flight, a card asks for an id from the second.
    const late = getGif('id55');
    await new Promise(r => setTimeout(r, 60));
    resolveFirst({ data: { gifs: Object.fromEntries(ids.slice(0, 50).map(id => [id, gif(id)])) }, error: null });
    await all;
    expect((await late)?.id).toBe('id55');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('never asks for an invalid id', async () => {
    expect(await getGif('../etc')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
