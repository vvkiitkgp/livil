/**
 * readCopiedText: on an iPhone, every READ of another app's copy makes iOS ask "Allow Paste?".
 * So the clipboard is read only for a NEW copy (the copy counter moved) that holds a web link,
 * and a build missing either native module never reads at all. Android reads straight away
 * (it never asks), falling back to core's Clipboard on a build without the library.
 */
import type * as ClipboardService from '../clipboard';

const SPOTIFY = 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b';

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => storage.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => { storage.set(k, v); }),
      removeItem: jest.fn(async (k: string) => { storage.delete(k); }),
    },
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

function withLib(hasWebURL: boolean, text = SPOTIFY) {
  const lib = {
    hasWebURL: jest.fn(async () => hasWebURL),
    getString: jest.fn(async () => text),
    setString: jest.fn(),
  };
  jest.doMock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: lib }));
  return lib;
}

/** ios/livil/LivilPasteboard.m, reporting `count` as the clipboard's copy counter. */
function withCounter(count: number) {
  const counter = { changeCount: jest.fn(async () => count) };
  require('react-native').NativeModules.LivilPasteboard = counter;
  return counter;
}

function load(): typeof ClipboardService {
  return require('../clipboard');
}

describe('iPhone', () => {
  it('a new copy with no link: nothing is read, so no paste question', async () => {
    const lib = withLib(false);
    withCounter(7);
    expect(await load().readCopiedText('ios')).toEqual({ text: '', askedToPaste: false });
    expect(lib.getString).not.toHaveBeenCalled();
  });

  it('a new copy with a link: it is read once', async () => {
    const lib = withLib(true);
    withCounter(7);
    const { text } = await load().readCopiedText('ios');
    expect(text).toBe(SPOTIFY);
    expect(lib.getString).toHaveBeenCalledTimes(1);
  });

  it('the same copy on the next open: not looked at again, so iOS does not ask again', async () => {
    const lib = withLib(true, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    withCounter(7);
    const { readCopiedText } = load();
    await readCopiedText('ios');
    expect(await readCopiedText('ios')).toEqual({ text: '', askedToPaste: false });
    expect(lib.hasWebURL).toHaveBeenCalledTimes(1);
    expect(lib.getString).toHaveBeenCalledTimes(1);
  });

  it('the handled copy survives a restart of the app', async () => {
    withLib(true);
    withCounter(7);
    await load().readCopiedText('ios');
    expect(storage.get(load().CHECKED_COPY_KEY)).toBe('7');

    jest.resetModules(); // a cold start: in-memory state gone, storage kept
    const lib = withLib(true);
    withCounter(7);
    expect((await load().readCopiedText('ios')).text).toBe('');
    expect(lib.getString).not.toHaveBeenCalled();
  });

  it('something new copied after that: read again', async () => {
    const lib = withLib(true);
    const counter = withCounter(7);
    const { readCopiedText } = load();
    await readCopiedText('ios');
    counter.changeCount.mockResolvedValue(8);
    expect((await readCopiedText('ios')).text).toBe(SPOTIFY);
    expect(lib.getString).toHaveBeenCalledTimes(2);
  });

  it('a Spotify song left unanswered: the next open looks at the same copy again', async () => {
    const lib = withLib(true);
    withCounter(7);
    const { readCopiedText, forgetCheckedCopy, CHECKED_COPY_KEY } = load();
    await readCopiedText('ios');
    forgetCheckedCopy();
    expect(storage.has(CHECKED_COPY_KEY)).toBe(false);
    expect((await readCopiedText('ios')).text).toBe(SPOTIFY);
    expect(lib.getString).toHaveBeenCalledTimes(2);
  });

  it('"Don\'t Allow" counts as handled: the copy is remembered before the read', async () => {
    const lib = withLib(true, '');
    withCounter(7);
    const { readCopiedText } = load();
    expect((await readCopiedText('ios')).text).toBe('');
    await readCopiedText('ios');
    expect(lib.getString).toHaveBeenCalledTimes(1);
  });

  it('a read that waited for a tap is reported as asked', async () => {
    const lib = withLib(true);
    withCounter(7);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    lib.getString.mockImplementation(async () => {
      now.mockReturnValue(1_000 + 1_500); // the person read the question, then tapped Allow
      return SPOTIFY;
    });
    expect(await load().readCopiedText('ios')).toEqual({ text: SPOTIFY, askedToPaste: true });
  });

  it("an instant read is not reported as asked (Livil's own copy, or Paste set to Allow)", async () => {
    withLib(true);
    withCounter(7);
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    expect(await load().readCopiedText('ios')).toEqual({ text: SPOTIFY, askedToPaste: false });
  });

  it('a build without the copy counter: nothing is read', async () => {
    const lib = withLib(true);
    delete require('react-native').NativeModules.LivilPasteboard;
    expect((await load().readCopiedText('ios')).text).toBe('');
    expect(lib.hasWebURL).not.toHaveBeenCalled();
    expect(lib.getString).not.toHaveBeenCalled();
  });

  it('the copy counter fails: nothing is read', async () => {
    const lib = withLib(true);
    withCounter(7).changeCount.mockRejectedValue(new Error('no pasteboard'));
    expect((await load().readCopiedText('ios')).text).toBe('');
    expect(lib.getString).not.toHaveBeenCalled();
  });

  it('the look-first check fails: nothing is read', async () => {
    const lib = withLib(true);
    lib.hasWebURL.mockRejectedValueOnce(new Error('detectPatterns failed'));
    withCounter(7);
    expect((await load().readCopiedText('ios')).text).toBe('');
    expect(lib.getString).not.toHaveBeenCalled();
  });
});

describe('Android', () => {
  it('has no look-first check and never asks: it reads straight away', async () => {
    const lib = withLib(false);
    expect(await load().readCopiedText('android')).toEqual({ text: SPOTIFY, askedToPaste: false });
    expect(lib.hasWebURL).not.toHaveBeenCalled();
  });
});

function withoutLib(os: 'ios' | 'android') {
  jest.doMock('@react-native-clipboard/clipboard', () => { throw new Error('RNCClipboard could not be found'); });
  const core = { getString: jest.fn(async () => 'hello'), setString: jest.fn() };
  jest.doMock('react-native', () => ({
    Platform: { OS: os },
    Clipboard: core,
    Linking: { openSettings: jest.fn(async () => {}) },
    NativeModules: { LivilPasteboard: { changeCount: jest.fn(async () => 7) } },
  }));
  return core;
}

it('iPhone build without the clipboard library: nothing is read, so no paste question on open', async () => {
  const core = withoutLib('ios');
  expect(await load().readCopiedText('ios')).toEqual({ text: '', askedToPaste: false });
  expect(core.getString).not.toHaveBeenCalled();
});

it('Android build without the library falls back to core Clipboard instead of crashing', async () => {
  const core = withoutLib('android');
  expect((await load().readCopiedText('android')).text).toBe('hello');
  expect(core.getString).toHaveBeenCalledTimes(1);
});

it('clearing empties the clipboard', () => {
  const lib = withLib(true);
  load().clearCopiedText();
  expect(lib.setString).toHaveBeenCalledWith('');
});

it('opening Paste settings is remembered, so the "not Spotify" note stops', async () => {
  withLib(true);
  const openSettings = jest.spyOn(require('react-native').Linking, 'openSettings')
    .mockResolvedValue(undefined);
  const { hasOpenedPasteSettings, openPasteSettings } = load();
  expect(await hasOpenedPasteSettings()).toBe(false);
  await openPasteSettings();
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(await hasOpenedPasteSettings()).toBe(true);
});

describe('"Detect copied Spotify links" (this phone)', () => {
  it('is on until the person turns it off, and remembers it', async () => {
    withLib(true);
    const { isCopiedLinkDetectionOn, setCopiedLinkDetection, DETECT_COPIED_LINKS_KEY } = load();
    expect(await isCopiedLinkDetectionOn()).toBe(true);
    await setCopiedLinkDetection(false);
    expect(storage.get(DETECT_COPIED_LINKS_KEY)).toBe('0');
    expect(await isCopiedLinkDetectionOn()).toBe(false);
    await setCopiedLinkDetection(true);
    expect(await isCopiedLinkDetectionOn()).toBe(true);
  });
});
