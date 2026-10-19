import { isOfflineState } from '../network';

type Listener = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void;

describe('isOfflineState', () => {
  it('no network at all is offline on both platforms', () => {
    expect(isOfflineState({ isConnected: false, isInternetReachable: false }, 'ios')).toBe(true);
    expect(isOfflineState({ isConnected: false, isInternetReachable: null }, 'android')).toBe(true);
  });

  it('not known yet is online, so the banner never flashes on launch', () => {
    expect(isOfflineState({ isConnected: null, isInternetReachable: null }, 'ios')).toBe(false);
    expect(isOfflineState({ isConnected: null, isInternetReachable: null }, 'android')).toBe(false);
  });

  it("trusts Android's own no-internet answer", () => {
    expect(isOfflineState({ isConnected: true, isInternetReachable: false }, 'android')).toBe(true);
  });

  it("ignores iOS reachability: with the Google ping off it reads false while online", () => {
    expect(isOfflineState({ isConnected: true, isInternetReachable: false }, 'ios')).toBe(false);
  });
});

describe('subscribeToOffline', () => {
  afterEach(() => { jest.resetModules(); });

  it('turns the Google ping off and reports only changes', () => {
    let listener: Listener = () => {};
    const configure = jest.fn();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: {
        configure,
        addEventListener: (l: Listener) => { listener = l; return () => {}; },
      },
    }));
    const { subscribeToOffline } = require('../network');
    const seen: boolean[] = [];
    subscribeToOffline((offline: boolean) => seen.push(offline));

    expect(configure.mock.calls[0][0].reachabilityShouldRun()).toBe(false);
    listener({ isConnected: true, isInternetReachable: true });
    listener({ isConnected: true, isInternetReachable: true });
    listener({ isConnected: false, isInternetReachable: false });
    listener({ isConnected: true, isInternetReachable: true });
    expect(seen).toEqual([false, true, false]);
  });

  it('an app built before NetInfo was added never crashes and is never offline', () => {
    jest.doMock('@react-native-community/netinfo', () => {
      throw new Error('NativeModule.RNCNetInfo is null');
    });
    const { subscribeToOffline } = require('../network');
    const seen: boolean[] = [];
    expect(() => subscribeToOffline((offline: boolean) => seen.push(offline))()).not.toThrow();
    expect(seen).toEqual([]);
  });
});
