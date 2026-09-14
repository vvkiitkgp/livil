/**
 * Settings is the container the published deletion page names, so the route to
 * account deletion must stay reachable from here. It is now Settings →
 * Privacy & data → Delete account: one level deeper than the old flat list, but
 * behind a typed confirmation instead of a single modal.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Linking, Share, Text } from 'react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Spies rather than module mocks: the RN preset already provides both modules,
// and mocking them by internal path silently no-ops when that path moves.
const mockShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...a: unknown[]) => mockNavigate(...(a as [])),
    goBack: (...a: unknown[]) => mockGoBack(...(a as [])),
  }),
  // Run the effect body once on mount and honour its cleanup, which is all the
  // screen relies on — it refetches the profile on focus.
  useFocusEffect: (cb: () => undefined | (() => void)) => {
    const React_ = require('react');
    React_.useEffect(cb, [cb]);
  },
}));

const mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...(a as [])),
      signOut: (...a: unknown[]) => mockSignOut(...(a as [])),
    },
  },
}));

const mockGetMyProfile = jest.fn().mockResolvedValue({
  id: 'u1',
  username: 'vvk',
  display_name: 'Vamsi',
  avatar_url: null,
  bio: null,
  links: [],
});
jest.mock('../../../services/profileService', () => ({
  getMyProfile: (...a: unknown[]) => mockGetMyProfile(...(a as [])),
}));

const mockPauseAll = jest.fn();
jest.mock('../../../contexts/PlaybackContext', () => ({
  usePlayback: () => ({ pauseAll: mockPauseAll }),
}));

jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import SettingsScreen from '../SettingsScreen';
import { APP_VERSION_LABEL } from '../../../constants/appVersion';
import { PLAY_STORE_APP_URL, PRIVACY_POLICY_URL } from '../../../constants/links';

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<SettingsScreen />); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

/** `deep: false` collapses the Touchable and the View it renders to one node. */
function pressable(t: TestRenderer.ReactTestRenderer, label: string) {
  const found = t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  );
  if (found.length !== 1) {
    throw new Error(`expected 1 pressable labelled "${label}", found ${found.length}`);
  }
  return found[0]!;
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShare.mockResolvedValue({ action: 'sharedAction' });
    mockOpenURL.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
    mockGetMyProfile.mockResolvedValue({
      id: 'u1',
      username: 'vvk',
      display_name: 'Vamsi',
      avatar_url: null,
      bio: null,
      links: [],
    });
  });

  it('mounts under the Settings title', async () => {
    expect(texts(await mount())).toContain('Settings');
  });

  it('shows the signed-in identity in the hero card', async () => {
    const shown = texts(await mount());
    expect(shown).toContain('Vamsi');
    expect(shown).toContain('@vvk');
  });

  it('falls back to the email when the profile has no username', async () => {
    mockGetMyProfile.mockRejectedValue(new Error('offline'));
    const shown = texts(await mount());
    expect(shown).toContain('a@b.com');
  });

  it('routes to the sub-screens', async () => {
    const tree = await mount();
    act(() => { pressable(tree, 'Notifications').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('NotificationSettings');

    act(() => { pressable(tree, 'Privacy & data').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('PrivacyData');
  });

  it('offers exactly one route to Edit profile — the hero card', async () => {
    const tree = await mount();
    const edit = tree.root.findAll(
      n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Edit profile',
      { deep: false },
    );
    expect(edit).toHaveLength(1);
    act(() => { edit[0]!.props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('EditProfile');
  });

  it('goes back from the header', async () => {
    const tree = await mount();
    act(() => { pressable(tree, 'Go back').props.onPress(); });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('opens the share sheet from the invite card', async () => {
    const tree = await mount();
    await act(async () => { pressable(tree, 'Invite your friends').props.onPress(); });
    expect(mockShare).toHaveBeenCalled();
  });

  it('opens external links rather than navigating', async () => {
    const tree = await mount();
    await act(async () => { pressable(tree, 'Privacy policy').props.onPress(); });
    expect(mockOpenURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);

    await act(async () => {
      pressable(tree, 'Rate Livil on the Play Store').props.onPress();
    });
    expect(mockOpenURL).toHaveBeenCalledWith(PLAY_STORE_APP_URL);
  });

  it('falls back to the web Play Store URL when the store app is absent', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no activity'));
    const tree = await mount();
    await act(async () => {
      pressable(tree, 'Rate Livil on the Play Store').props.onPress();
    });
    expect(mockOpenURL).toHaveBeenLastCalledWith(
      expect.stringContaining('play.google.com'),
    );
  });

  it('does not sign out until the confirmation is accepted', async () => {
    const tree = await mount();
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('stamps the build so support requests carry a version', async () => {
    expect(texts(await mount())).toContain(APP_VERSION_LABEL);
  });

  it('keeps account deletion off this screen — it lives behind Privacy & data', async () => {
    const shown = texts(await mount()).join(' ').toLowerCase();
    expect(shown).not.toMatch(/delete account/);
  });
});
