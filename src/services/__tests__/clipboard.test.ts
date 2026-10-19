/**
 * readCopiedText: on an iPhone, a clipboard with no web link must not be READ at all — the
 * read itself is what makes iOS ask "Allow Paste?". And a build made before the clipboard
 * library was added must fall back to core's Clipboard, never crash.
 */
afterEach(() => { jest.resetModules(); });

function withLib(hasWebURL: boolean) {
  const lib = {
    hasWebURL: jest.fn(async () => hasWebURL),
    getString: jest.fn(async () => 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'),
    setString: jest.fn(),
  };
  jest.doMock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: lib }));
  return lib;
}

it('iPhone, no link copied: nothing is read, so no paste question', async () => {
  const lib = withLib(false);
  const { readCopiedText } = require('../clipboard');
  expect(await readCopiedText('ios')).toBe('');
  expect(lib.getString).not.toHaveBeenCalled();
});

it('iPhone, a link copied: it is read', async () => {
  const lib = withLib(true);
  const { readCopiedText } = require('../clipboard');
  expect(await readCopiedText('ios')).toContain('open.spotify.com');
  expect(lib.getString).toHaveBeenCalledTimes(1);
});

it('Android has no look-first check: it reads straight away', async () => {
  const lib = withLib(false);
  const { readCopiedText } = require('../clipboard');
  expect(await readCopiedText('android')).toContain('open.spotify.com');
  expect(lib.hasWebURL).not.toHaveBeenCalled();
});

it('clearing empties the clipboard', () => {
  const lib = withLib(true);
  const { clearCopiedText } = require('../clipboard');
  clearCopiedText();
  expect(lib.setString).toHaveBeenCalledWith('');
});

it('a build without the library falls back to core Clipboard instead of crashing', async () => {
  jest.doMock('@react-native-clipboard/clipboard', () => { throw new Error('RNCClipboard could not be found'); });
  const getString = jest.fn(async () => 'hello');
  jest.doMock('react-native', () => ({ Platform: { OS: 'ios' }, Clipboard: { getString, setString: jest.fn() } }));
  const { readCopiedText } = require('../clipboard');
  expect(await readCopiedText('ios')).toBe('hello');
});
