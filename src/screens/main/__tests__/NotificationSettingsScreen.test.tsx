/**
 * The master toggle is the only place in the app that can turn push OFF, and
 * "on" is not a local flag — it has to survive the OS refusing the permission,
 * which Android does silently after two declines.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform, Switch, Text } from 'react-native';

/**
 * Captured so a test can simulate returning from Android's settings screen —
 * the moment the channel state is most likely to have changed underneath us.
 */
let appStateListener: ((state: string) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _event: string,
  handler: (state: string) => void,
) => {
  appStateListener = handler;
  return { remove: () => { appStateListener = undefined; } };
}) as unknown as typeof AppState.addEventListener);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const mockIsPushEnabled = jest.fn().mockResolvedValue(true);
const mockRequestPermission = jest.fn().mockResolvedValue(true);
const mockDisablePush = jest.fn().mockResolvedValue(undefined);
const mockOpenOsSettings = jest.fn().mockResolvedValue(undefined);
const mockGetBlockedChannelIds = jest.fn().mockResolvedValue(new Set<string>());
const ALL_ON = { social: true, activity: true, messages: true, jam: true };
const mockGetPrefs = jest.fn().mockResolvedValue({ ...ALL_ON });
const mockUpdatePref = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../services/pushNotifications', () => ({
  isPushEnabled: (...a: unknown[]) => mockIsPushEnabled(...(a as [])),
  requestPushPermissionInteractive: (...a: unknown[]) => mockRequestPermission(...(a as [])),
  disablePushForUser: (...a: unknown[]) => mockDisablePush(...(a as [])),
  openOsNotificationSettings: (...a: unknown[]) => mockOpenOsSettings(...(a as [])),
  getBlockedChannelIds: (...a: unknown[]) => mockGetBlockedChannelIds(...(a as [])),
  getNotificationPreferences: (...a: unknown[]) => mockGetPrefs(...(a as [])),
  updateNotificationPreference: (...a: unknown[]) => mockUpdatePref(...(a as [])),
  ALL_CATEGORIES_ON: { social: true, activity: true, messages: true, jam: true },
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
    mockGetBlockedChannelIds.mockResolvedValue(new Set<string>());
    mockGetPrefs.mockResolvedValue({ ...ALL_ON });
    mockUpdatePref.mockResolvedValue(undefined);
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

  it('links out to the OS notification settings', async () => {
    const tree = await mount();
    await act(async () => {
      pressable(tree, 'Android notification settings').props.onPress();
    });
    // No channel id: this is the app-level page, not a per-category deep link.
    expect(mockOpenOsSettings).toHaveBeenCalledWith(undefined);
  });

  describe('category switches', () => {
    // Switch order follows NOTIFICATION_CHANNELS after the master toggle.
    const socialSwitch = (t: TestRenderer.ReactTestRenderer) => t.root.findAllByType(Switch)[1]!;
    const messagesSwitch = (t: TestRenderer.ReactTestRenderer) => t.root.findAllByType(Switch)[2]!;

    it('defaults every category on for a user who has never set one', async () => {
      const tree = await mount();
      expect(socialSwitch(tree).props.value).toBe(true);
      expect(messagesSwitch(tree).props.value).toBe(true);
    });

    it('reflects a stored preference', async () => {
      mockGetPrefs.mockResolvedValue({ ...ALL_ON, messages: false });
      const tree = await mount();
      expect(messagesSwitch(tree).props.value).toBe(false);
      expect(socialSwitch(tree).props.value).toBe(true);
    });

    it('persists only the category that changed', async () => {
      const tree = await mount();
      await act(async () => { messagesSwitch(tree).props.onValueChange(false); });
      expect(mockUpdatePref).toHaveBeenCalledWith('u1', 'messages', false);
      expect(mockUpdatePref).toHaveBeenCalledTimes(1);
      expect(messagesSwitch(tree).props.value).toBe(false);
      expect(socialSwitch(tree).props.value).toBe(true);
    });

    it('rolls back and warns when the write fails', async () => {
      mockUpdatePref.mockRejectedValueOnce(new Error('offline'));
      const tree = await mount();
      await act(async () => { messagesSwitch(tree).props.onValueChange(false); });

      expect(messagesSwitch(tree).props.value).toBe(true);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Could not update that notification setting.',
        { kind: 'error' },
      );
    });

    it('stays editable while device push is off — the preference is account-level', async () => {
      // It applies to every device the user signs in on, so turning push off on
      // this one must not lock them out of configuring it.
      mockIsPushEnabled.mockResolvedValue(false);
      const tree = await mount();
      expect(messagesSwitch(tree).props.disabled).toBe(false);
    });

    it('keeps every category on when the preference read fails', async () => {
      mockGetPrefs.mockRejectedValue(new Error('offline'));
      const tree = await mount();
      expect(socialSwitch(tree).props.value).toBe(true);
      expect(messagesSwitch(tree).props.value).toBe(true);
    });
  });

  describe('Android channel state, surfaced but never mirrored', () => {
    const OS_SILENCED = "Silenced in Android settings — these won't appear";

    it('says nothing when the OS will deliver normally', async () => {
      expect(texts(await mount())).not.toContain(OS_SILENCED);
    });

    it('warns when we would send but Android will not show it', async () => {
      mockGetBlockedChannelIds.mockResolvedValue(new Set(['messages']));
      expect(texts(await mount())).toContain(OS_SILENCED);
    });

    it('stays quiet when the user turned the category off themselves', async () => {
      // Their own switch already explains the silence; the OS note would be noise.
      mockGetBlockedChannelIds.mockResolvedValue(new Set(['messages']));
      mockGetPrefs.mockResolvedValue({ ...ALL_ON, messages: false });
      expect(texts(await mount())).not.toContain(OS_SILENCED);
    });

    it('does not let the OS state overwrite our switch', async () => {
      // The whole point of not mirroring: Android blocking the channel must not
      // silently flip the user's stored preference.
      mockGetBlockedChannelIds.mockResolvedValue(new Set(['messages']));
      const tree = await mount();
      expect(tree.root.findAllByType(Switch)[2]!.props.value).toBe(true);
      expect(mockUpdatePref).not.toHaveBeenCalled();
    });

    it('re-reads the OS state when the app returns to the foreground', async () => {
      const tree = await mount();
      expect(texts(tree)).not.toContain(OS_SILENCED);

      // The user opens Android settings, silences the channel, comes back.
      mockGetBlockedChannelIds.mockResolvedValue(new Set(['messages']));
      await act(async () => { appStateListener?.('active'); });

      expect(texts(tree)).toContain(OS_SILENCED);
    });
  });

  describe('on iOS', () => {
    beforeAll(() => { (Platform as { OS: string }).OS = 'ios'; });
    afterAll(() => { (Platform as { OS: string }).OS = 'android'; });

    it('still offers the category switches — this is where they matter most', async () => {
      // iOS has no channels, so the server-side preference is the ONLY per-category
      // control an iOS user has.
      const tree = await mount();
      expect(texts(tree)).toContain('Social');
      expect(tree.root.findAllByType(Switch).length).toBeGreaterThan(1);
    });

    it('never claims a category is silenced by Android', async () => {
      mockGetBlockedChannelIds.mockResolvedValue(new Set(['messages']));
      const tree = await mount();
      expect(texts(tree)).not.toContain("Silenced in Android settings — these won't appear");
    });
  });
});
