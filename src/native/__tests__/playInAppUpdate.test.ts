/**
 * The Play In-App Updates bridge is fail-safe. Pins: iOS never reaches the native module;
 * an Android build without it, or a Play API that rejects (debug / sideloaded build, no
 * Play Store), answers "nothing" instead of throwing — which is what sends the update
 * prompt to the store listing instead.
 */
import { NativeModules, Platform } from 'react-native';
import {
  checkPlayUpdate,
  completePlayUpdate,
  startPlayUpdate,
  subscribePlayInstallState,
} from '../playInAppUpdate';

const realOS = Platform.OS;
const native = {
  check: jest.fn(),
  start: jest.fn(),
  completeUpdate: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  NativeModules.LivilInAppUpdate = native;
});

afterEach(() => {
  Platform.OS = realOS;
  delete NativeModules.LivilInAppUpdate;
});

it('iOS never calls the native module', async () => {
  Platform.OS = 'ios';
  await expect(checkPlayUpdate()).resolves.toBeNull();
  await expect(startPlayUpdate('flexible')).resolves.toBe('unavailable');
  await expect(completePlayUpdate()).resolves.toBe(false);
  subscribePlayInstallState(() => {})();
  expect(native.check).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(native.completeUpdate).not.toHaveBeenCalled();
  expect(native.addListener).not.toHaveBeenCalled();
});

it('an Android build without the module answers "nothing"', async () => {
  delete NativeModules.LivilInAppUpdate;
  await expect(checkPlayUpdate()).resolves.toBeNull();
  await expect(startPlayUpdate('immediate')).resolves.toBe('unavailable');
  await expect(completePlayUpdate()).resolves.toBe(false);
});

it('passes Play\'s answers through', async () => {
  const info = {
    availability: 'available',
    installStatus: 'unknown',
    flexibleAllowed: true,
    immediateAllowed: true,
    availableVersionCode: 79,
  };
  native.check.mockResolvedValue(info);
  native.start.mockResolvedValue('accepted');
  native.completeUpdate.mockResolvedValue(null);
  await expect(checkPlayUpdate()).resolves.toEqual(info);
  await expect(startPlayUpdate('flexible')).resolves.toBe('accepted');
  expect(native.start).toHaveBeenCalledWith('flexible');
  await expect(completePlayUpdate()).resolves.toBe(true);
});

it('a rejection from Play (not installed from Play, no Play Store) never throws', async () => {
  native.check.mockRejectedValue(new Error('E_INSTALL_-10'));
  native.start.mockRejectedValue(new Error('E_NO_ACTIVITY'));
  native.completeUpdate.mockRejectedValue(new Error('E_INSTALL_-7'));
  await expect(checkPlayUpdate()).resolves.toBeNull();
  await expect(startPlayUpdate('immediate')).resolves.toBe('failed');
  await expect(completePlayUpdate()).resolves.toBe(false);
});
