import { isNetworkPlaybackError } from '../playbackErrors';

it('iOS: any NSURLErrorDomain failure is the connection', () => {
  expect(isNetworkPlaybackError({ error: { domain: 'NSURLErrorDomain', code: -1009, localizedDescription: 'The Internet connection appears to be offline.' } })).toBe(true);
  expect(isNetworkPlaybackError({ error: { domain: 'NSURLErrorDomain', code: -1020, localizedDescription: 'A data connection is not currently allowed.' } })).toBe(true);
});

it('iOS: AVFoundation wrapping the offline message', () => {
  expect(isNetworkPlaybackError({ error: { domain: 'AVFoundationErrorDomain', code: -11800, localizedDescription: 'The operation could not be completed', localizedFailureReason: 'The Internet connection appears to be offline.' } })).toBe(true);
});

it('Android: ExoPlayer network codes and messages', () => {
  expect(isNetworkPlaybackError({ error: { errorString: 'ExoPlaybackException: Source error', errorCode: '2001' } })).toBe(true);
  expect(isNetworkPlaybackError({ error: { errorString: 'Source error', errorException: 'java.net.UnknownHostException: Unable to resolve host', errorCode: '2000' } })).toBe(true);
});

it('a broken file is not the connection', () => {
  expect(isNetworkPlaybackError({ error: { domain: 'AVFoundationErrorDomain', code: -11828, localizedDescription: 'Cannot Open', localizedFailureReason: 'This media format is not supported.' } })).toBe(false);
  expect(isNetworkPlaybackError({ error: { errorString: 'Source error', errorException: 'ParserException', errorCode: '3001' } })).toBe(false);
  expect(isNetworkPlaybackError(undefined)).toBe(false);
  expect(isNetworkPlaybackError({})).toBe(false);
});
