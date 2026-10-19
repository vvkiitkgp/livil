/**
 * The chat list's "Turn on notifications" card shows while this phone cannot get pushes,
 * and only then: not once they work, not after Livil's own switch was turned off, not
 * within a week of "Not now".
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let mockEnabled = false;
let mockStatus = 'pending';
let mockCanAsk = true;
const mockStore = new Map<string, string>();
const mockRequest = jest.fn(async () => true);
const mockRegisterIfNewlyAllowed = jest.fn(async (_userId: string) => {});

jest.mock('../../services/pushNotifications', () => ({
  isPushEnabled: async () => mockEnabled,
  getPushPromptStatus: async () => mockStatus,
  isPushOffFor: async () => mockStatus === 'off',
  canShowPermissionDialog: async () => mockCanAsk,
  registerIfNewlyAllowed: (id: string) => mockRegisterIfNewlyAllowed(id),
  requestPushPermissionInteractive: () => mockRequest(),
  openOsNotificationSettings: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
  },
}));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});
const mockShowToast = jest.fn();
jest.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock('../GradientBorder', () => ({ GradientBorder: () => null }));
jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../Button', () => {
  const { Text } = require('react-native');
  return { Button: ({ label, onPress }: { label: string; onPress: () => void }) => <Text onPress={onPress}>{label}</Text> };
});

import NotificationNudge from '../NotificationNudge';

const texts = (r: ReactTestRenderer) =>
  r.root.findAll(n => String(n.type) === 'Text').map(n => [n.props.children].flat().join(''));

async function render(userId: string | null = 'me') {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<NotificationNudge userId={userId} />); });
  await act(async () => {});
  return r;
}

beforeEach(() => {
  mockEnabled = false;
  mockStatus = 'pending';
  mockCanAsk = true;
  mockStore.clear();
  mockRequest.mockClear();
  mockShowToast.mockClear();
});

it('asks when the phone cannot get pushes and the dialog can still be shown', async () => {
  const r = await render();
  expect(texts(r)).toEqual(expect.arrayContaining(['Turn on notifications', 'Turn on']));
});

it('points straight at the phone\'s settings when its dialog will not show again', async () => {
  mockCanAsk = false;
  const r = await render();
  expect(texts(r)).toEqual(expect.arrayContaining(['Settings']));
});

it('stays hidden once notifications work, after Livil\'s own switch was turned off, or with no account', async () => {
  mockEnabled = true;
  expect((await render()).toJSON()).toBeNull();
  mockEnabled = false;
  mockStatus = 'off';
  expect((await render()).toJSON()).toBeNull();
  mockStatus = 'pending';
  expect((await render(null)).toJSON()).toBeNull();
});

it('"Not now" hides it for a week', async () => {
  mockStore.set('livil.notifyNudge.dismissedAt.v1', String(Date.now() - 2 * 24 * 3600 * 1000));
  expect((await render()).toJSON()).toBeNull();
  mockStore.set('livil.notifyNudge.dismissedAt.v1', String(Date.now() - 8 * 24 * 3600 * 1000));
  expect((await render()).toJSON()).not.toBeNull();
});

it('turning on: the phone\'s dialog, then the card goes', async () => {
  const r = await render();
  const button = r.root.findAll(n => String(n.type) === 'Text' && n.props.children === 'Turn on')[0];
  await act(async () => { button.props.onPress(); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(r.toJSON()).toBeNull();
  expect(mockShowToast).toHaveBeenCalledWith('Notifications are on', { kind: 'success' });
});
