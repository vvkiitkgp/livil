/**
 * The exit survey must never be the reason someone cannot delete their account.
 *
 * `submitExitFeedback` runs immediately before `deleteMyAccount`, awaited. If it threw,
 * a backend that has not been migrated yet (no function), a network blip, or a value the
 * CHECK rejects would surface as "could not delete your account". If it hung, the delete
 * button would spin forever. Both are pinned here. What the server stores is asserted in
 * supabase/tests/rls/account-exit-feedback.test.sql, against a real Postgres.
 */

const mockRpc = jest.fn();

// Native modules imported at module scope by the service graph.
jest.mock('react-native-image-crop-picker', () => ({ openPicker: jest.fn(), openCamera: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));

jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) },
}));

import { Platform } from 'react-native';
import { submitExitFeedback } from '../profileService';

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('submitExitFeedback', () => {
  it('makes no request when nothing was chosen or written (a skip)', async () => {
    await submitExitFeedback(null, '   ');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends the reason, the trimmed note and the platform', async () => {
    await submitExitFeedback('bugs', '  Upload kept failing  ');
    expect(mockRpc).toHaveBeenCalledWith('submit_account_exit_feedback', {
      p_reason: 'bugs',
      p_note: 'Upload kept failing',
      p_platform: Platform.OS,
    });
  });

  it('omits absent fields rather than sending null', async () => {
    await submitExitFeedback(null, 'Just a note');
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_reason: undefined,
      p_note: 'Just a note',
      p_platform: Platform.OS,
    });
  });

  it('resolves when the server returns an error (e.g. the function does not exist yet)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    await expect(submitExitFeedback('privacy', '')).resolves.toBeUndefined();
  });

  it('resolves when the request itself throws', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(submitExitFeedback('privacy', '')).resolves.toBeUndefined();
  });

  it('gives up instead of hanging the deletion', async () => {
    jest.useFakeTimers();
    mockRpc.mockReturnValue(new Promise(() => {}));
    const done = jest.fn();
    const pending = submitExitFeedback('break', '').then(done);

    await jest.advanceTimersByTimeAsync(3999);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalled();
  });
});
