/**
 * `profiles.show_activity` already gates presence in conversations.ts — this
 * screen is the first UI that can write it, so the optimistic toggle and its
 * rollback are the behaviour worth pinning.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Switch, Text } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...a: unknown[]) => mockNavigate(...(a as [])),
    goBack: jest.fn(),
  }),
}));

const mockGetShowActivity = jest.fn().mockResolvedValue(true);
const mockUpdateShowActivity = jest.fn().mockResolvedValue(undefined);
const mockGetCommentsFriendsOnly = jest.fn().mockResolvedValue(false);
const mockUpdateCommentsFriendsOnly = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../services/profileService', () => ({
  getShowActivity: (...a: unknown[]) => mockGetShowActivity(...(a as [])),
  updateShowActivity: (...a: unknown[]) => mockUpdateShowActivity(...(a as [])),
  getCommentsFriendsOnly: (...a: unknown[]) => mockGetCommentsFriendsOnly(...(a as [])),
  updateCommentsFriendsOnly: (...a: unknown[]) => mockUpdateCommentsFriendsOnly(...(a as [])),
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

import PrivacyDataScreen from '../PrivacyDataScreen';

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<PrivacyDataScreen />); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

const activitySwitch = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Switch)[0]!;

const commentsSwitch = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Switch)[1]!;

const pressable = (t: TestRenderer.ReactTestRenderer, label: string) =>
  t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  )[0]!;

describe('PrivacyDataScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetShowActivity.mockResolvedValue(true);
    mockUpdateShowActivity.mockResolvedValue(undefined);
    mockGetCommentsFriendsOnly.mockResolvedValue(false);
    mockUpdateCommentsFriendsOnly.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('reflects the stored activity-status value', async () => {
    mockGetShowActivity.mockResolvedValue(false);
    const tree = await mount();
    expect(activitySwitch(tree).props.value).toBe(false);
  });

  it('persists a change to activity status', async () => {
    const tree = await mount();
    await act(async () => { activitySwitch(tree).props.onValueChange(false); });
    expect(mockUpdateShowActivity).toHaveBeenCalledWith('u1', false);
    expect(activitySwitch(tree).props.value).toBe(false);
  });

  it('rolls the switch back and warns when the write fails', async () => {
    mockUpdateShowActivity.mockRejectedValueOnce(new Error('offline'));
    const tree = await mount();
    await act(async () => { activitySwitch(tree).props.onValueChange(false); });

    expect(activitySwitch(tree).props.value).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Could not update your activity status.',
      { kind: 'error' },
    );
  });

  it('defaults to visible rather than opted-out when the read fails', async () => {
    mockGetShowActivity.mockRejectedValue(new Error('offline'));
    const tree = await mount();
    expect(activitySwitch(tree).props.value).toBe(true);
  });

  describe('comment audience', () => {
    it('defaults to everyone, not friends-only', async () => {
      const tree = await mount();
      expect(commentsSwitch(tree).props.value).toBe(false);
    });

    it('reflects the stored preference', async () => {
      mockGetCommentsFriendsOnly.mockResolvedValue(true);
      const tree = await mount();
      expect(commentsSwitch(tree).props.value).toBe(true);
    });

    it('persists a change', async () => {
      const tree = await mount();
      await act(async () => { commentsSwitch(tree).props.onValueChange(true); });
      expect(mockUpdateCommentsFriendsOnly).toHaveBeenCalledWith('u1', true);
      expect(commentsSwitch(tree).props.value).toBe(true);
    });

    it('rolls back and warns when the write fails', async () => {
      mockUpdateCommentsFriendsOnly.mockRejectedValueOnce(new Error('offline'));
      const tree = await mount();
      await act(async () => { commentsSwitch(tree).props.onValueChange(true); });

      expect(commentsSwitch(tree).props.value).toBe(false);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Could not update who can comment.',
        { kind: 'error' },
      );
    });

    it('stays usable when only the comments column is unreadable', async () => {
      // Exactly the shape of shipping this screen before its migration is
      // applied: one read fails, the other must still load and stay writable.
      mockGetCommentsFriendsOnly.mockRejectedValue(
        new Error("column profiles.comments_friends_only does not exist"),
      );
      mockGetShowActivity.mockResolvedValue(false);
      const tree = await mount();

      expect(activitySwitch(tree).props.value).toBe(false);
      expect(activitySwitch(tree).props.disabled).toBe(false);
      expect(commentsSwitch(tree).props.value).toBe(false);

      await act(async () => { activitySwitch(tree).props.onValueChange(true); });
      expect(mockUpdateShowActivity).toHaveBeenCalledWith('u1', true);
    });

    it('leaves the activity switch alone', async () => {
      const tree = await mount();
      await act(async () => { commentsSwitch(tree).props.onValueChange(true); });
      expect(mockUpdateShowActivity).not.toHaveBeenCalled();
      expect(activitySwitch(tree).props.value).toBe(true);
    });
  });

  // REPLACES 'offers no blocking control — reporting is the moderation path',
  // which asserted the opposite and failed the moment blocking shipped. It was
  // right to fail: it encoded a product decision, that decision was reversed, and
  // the assertion is what noticed. Inverted rather than deleted, because the
  // route out of here is the part worth protecting — blocking severs the
  // friendship, so this screen is the only reliable way back to a blocked
  // account, and losing the row would quietly make blocking one-way.
  it('routes to the blocked-accounts screen', async () => {
    const tree = await mount();
    expect(texts(tree).join(' ')).toContain('Blocked accounts');
    act(() => { pressable(tree, 'Blocked accounts').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('BlockedAccounts');
  });

  it('routes to the delete-account screen', async () => {
    const tree = await mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('DeleteAccount');
  });

  it('names the data-protection contact', async () => {
    expect(texts(await mount()).join(' ')).toContain('@');
  });
});
