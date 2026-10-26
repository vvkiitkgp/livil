/**
 * Jest manual mock for react-native-compressor.
 *
 * WHY THIS FILE EXISTS
 * The library is a Nitro module: its entry point calls
 * `NitroModules.createHybridObject('Compressor')` at import time, which throws when no
 * native binary is present. `src/services/mediaCompression.ts` loads it lazily and treats a
 * throw as "no compressor here" (the upload then sends the original file), so suites would
 * still pass without this — but every one of them would pay for loading Nitro's JS first,
 * and a suite that wants to assert on compression would have no surface to drive.
 *
 * It lives in `<rootDir>/__mocks__/` because Jest applies a manual mock for a node_modules
 * package automatically, with no `jest.mock()` call: nothing importing `tracks.ts` has to
 * know the compressor exists.
 *
 * DEFAULT BEHAVIOUR: a compressor that is present but cannot compress — `Video.compress`
 * and `Audio.compress` reject, `getVideoMetaData` rejects. That is the fail-safe path, so
 * a suite that does not care about compression sees exactly the original file uploaded.
 * `mediaCompression.test.ts` overrides these per test.
 */
const notAvailable = () => Promise.reject(new Error('mock: compression unavailable'));

const Video = {
  compress: jest.fn(notAvailable),
  cancelCompression: jest.fn(),
  activateBackgroundTask: jest.fn(() => Promise.resolve('')),
  deactivateBackgroundTask: jest.fn(() => Promise.resolve('')),
};
const Audio = { compress: jest.fn(notAvailable) };
const Image = { compress: jest.fn(notAvailable) };
const getVideoMetaData = jest.fn(notAvailable);
const getFileSize = jest.fn(notAvailable);
const getRealPath = jest.fn(path => Promise.resolve(path));
const clearCache = jest.fn(() => Promise.resolve(''));

module.exports = {
  __esModule: true,
  Video,
  Audio,
  Image,
  getVideoMetaData,
  getFileSize,
  getRealPath,
  clearCache,
  default: { Video, Audio, Image, getVideoMetaData, getFileSize, getRealPath, clearCache },
};
