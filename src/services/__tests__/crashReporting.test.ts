/**
 * Crash reporting must never be the thing that crashes the app, and its breadcrumbs must
 * never carry route params (post/user/conversation ids). These pin both.
 */

const mockGetCrashlytics = jest.fn();
const mockLog = jest.fn();
const mockRecordError = jest.fn();
jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: () => mockGetCrashlytics(),
  log: (...a: unknown[]) => mockLog(...a),
  recordError: (...a: unknown[]) => mockRecordError(...a),
}));

export {}; // a module, so `load` doesn't collide with other suites' globals under tsc

type Reporter = typeof import('../crashReporting');

// Fresh module per test: it memoises the Crashlytics instance and the last screen.
function load(): Reporter {
  let mod!: Reporter;
  jest.isolateModules(() => {
    mod = require('../crashReporting');
  });
  return mod;
}

const fakeInstance = { app: 'crashlytics' };

beforeEach(() => {
  mockGetCrashlytics.mockReset().mockReturnValue(fakeInstance);
  mockLog.mockReset();
  mockRecordError.mockReset();
});

describe('crashReporting', () => {
  it('startCrashReporting creates the module once (that is what installs the JS handler)', () => {
    const r = load();
    r.startCrashReporting();
    r.startCrashReporting();
    r.noteScreen('Home');
    expect(mockGetCrashlytics).toHaveBeenCalledTimes(1);
  });

  it('records a caught render error as a non-fatal, component stack first', () => {
    const r = load();
    const err = new Error('undefined is not a function');
    r.reportRenderError(err, '\n    in PostCard\n    in HomeScreen');
    expect(mockLog).toHaveBeenCalledWith(fakeInstance, 'component stack:\n    in PostCard\n    in HomeScreen');
    expect(mockRecordError).toHaveBeenCalledWith(fakeInstance, err, 'ErrorBoundary');
    expect(mockLog.mock.invocationCallOrder[0]).toBeLessThan(mockRecordError.mock.invocationCallOrder[0]);
  });

  it('logs each screen once per visit, by name only', () => {
    const r = load();
    r.noteScreen('Home');
    r.noteScreen('Home'); // a state change that did not move screens
    r.noteScreen('PostDetail');
    r.noteScreen('Home');
    expect(mockLog.mock.calls.map(c => c[1])).toEqual(['screen: Home', 'screen: PostDetail', 'screen: Home']);
  });

  it('never throws when the native module is missing (an old binary without Crashlytics)', () => {
    mockGetCrashlytics.mockImplementation(() => {
      throw new Error('Native module RNFBCrashlyticsModule not found');
    });
    const r = load();
    expect(() => r.startCrashReporting()).not.toThrow();
    expect(() => r.reportRenderError(new Error('boom'), 'in X')).not.toThrow();
    expect(() => r.noteScreen('Home')).not.toThrow();
    expect(mockRecordError).not.toHaveBeenCalled();
  });

  it('never throws when recording itself fails', () => {
    mockRecordError.mockImplementation(() => {
      throw new Error('native bridge gone');
    });
    mockLog.mockImplementation(() => {
      throw new Error('native bridge gone');
    });
    const r = load();
    expect(() => r.reportRenderError(new Error('boom'), 'in X')).not.toThrow();
    expect(() => r.noteScreen('Home')).not.toThrow();
  });
});
