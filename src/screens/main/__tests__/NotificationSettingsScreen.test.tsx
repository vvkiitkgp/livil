/**
 * The master toggle is the only place in the app that can turn push OFF, and
 * "on" is not a local flag — it has to survive the OS refusing the permission,
 * which Android does silently after two declines.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform, Switch, Text } from 'react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const mockIsPushEnabled = jest.fn().mockResolvedValue(true);
const mockRequestPermission = jest.fn().mockResolvedValue(true);
const mockDisablePush = jest.fn().mockResolvedValue(undefined);
const mockOpenOsSettings = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../services/pushNotifications', () => ({
  isPushEnabled: (...a: unknown[]) => mockIsPushEnabled(...(a as [])),
  requestPushPermissionInteractive: (...a: unknown[]) => mockRequestPermission(...(a as [])),
  disablePushForUser: (...a: unknown[]) => mockDisablePush(...(a as [])),
  openOsNotificationSettings: (...a: unknown[]) => mockOpenOsSettings(...(a as [])),
  NOTIFICATION_CHANNELS: [
    { id: 'social', name: 'Social', description: 'Friends', importance: 3 },
    { id: 'messages', name: 'Messages', description: 'DMs', importance: 4 },
  ],
}));

const mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } });
jest.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => mockGetUser(...(a as [])) } },
}));

const mockShowToast = jest.fn();
jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import NotificationSettingsScreen from '../NotificationSettingsScreen';

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<NotificationSettingsScreen />); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

const masterSwitch = (t: TestRenderer.ReactTestRenderer) => t.root.findAllByType(Switch)[0]!;

const pressable = (t: TestRenderer.ReactTestRenderer, label: string) =>
  t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  )[0]!;

describe('NotificationSettingsScreen', () => {
  // The jest preset reports iOS. Android is the shipping platform and the only
  // one with per-channel rows, so the suite runs as Android and the iOS branch
  // gets its own case at the bottom.
  const realOS = Platform.OS;
  beforeAll(() => { (Platform as { OS: string }).OS = 'android'; });
  afterAll(() => { (Platform as { OS: string }).OS = realOS; });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPushEnabled.mockResolvedValue(true);
    mockRequestPermission.mockResolvedValue(true);
    mockDisablePush.mockResolvedValue(undefined);
    mockOpenOsSettings.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('reflects the live push state on mount', async () => {
    mockIsPushEnabled.mockResolvedValue(false);
    expect(masterSwitch(await mount()).props.value).toBe(false);
  });

  it('lists one row per notification channel', async () => {
    const shown = texts(await mount());
    expect(shown).toContain('Social');
    expect(shown).toContain('Messages');
  });

  it('deletes the device token when turned off', async () => {
    const tree = await mount();
    await act(async () => { masterSwitch(tree).props.onValueChange(false); });
    expect(mockDisablePush).toHaveBeenCalledWith('u1');
    expect(masterSwitch(tree).props.value).toBe(false);
  });

  it('requests the OS permission when turned on', async () => {
    mockIsPushEnabled.mockResolvedValue(false);
    const tree = await mount();
    await act(async () => { masterSwitch(tree).props.onValueChange(true); });
    expect(mockRequestPermission).toHaveBeenCalledWith('u1');
    expect(masterSwitch(tree).props.value).toBe(true);
  });

  it('snaps back and points at system settings when the OS refuses', async () => {
    mockIsPushEnabled.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(false);
    const tree = await mount();
    await act(async () => { masterSwitch(tree).props.onValueChange(true); });

    expect(masterSwitch(tree).props.value).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('system settings'),
      { kind: 'info' },
    );
  });

  it('opens the OS settings for a specific channel', async () => {
    const tree = await mount();
    await act(async () => { pressable(tree, 'Messages').props.onPress(); });
    expect(mockOpenOsSettings).toHaveBeenCalledWith('messages');
  });

  it('disables the channel rows while push is off', async () => {
    mockIsPushEnabled.mockResolvedValue(false);
    const tree = await mount();
    expect(pressable(tree, 'Messages').props.accessibilityState.disabled).toBe(true);
  });

  describe('on iOS', () => {
    beforeAll(() => { (Platform as { OS: string }).OS = 'ios'; });
    afterAll(() => { (Platform as { OS: string }).OS = 'android'; });

    it('offers one system-settings row instead of per-channel rows', async () => {
      const tree = await mount();
      expect(texts(tree)).not.toContain('Social');

      await act(async () => { pressable(tree, 'Open system settings').props.onPress(); });
      // No channel id — iOS has no per-channel concept.
      expect(mockOpenOsSettings).toHaveBeenCalledWith(undefined);
    });
  });
});
