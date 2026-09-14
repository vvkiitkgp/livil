/**
 * Sending a message to the team, from the app.
 *
 * The mirror of `web/src/data/__tests__/teamMessages.test.ts`, and mirrored for the same
 * reason the code is: both clients write one `team_messages`, so a drift here shows up as a
 * row the ops list reads wrong rather than as an error anyone sees. The mobile side matters
 * more, not less — it replaced a `mailto:`, where a message that never arrived left no trace
 * at all, so a regression that silently drops or misattributes a send reproduces exactly the
 * fault the screen was built to remove.
 */
import { sendTeamMessage } from '../teamMessages';
import { MESSAGE_MAX } from '../../../shared/constants/teamMessages';

// `mock`-prefixed names: jest.mock() is hoisted above these declarations, and the factory may
// only close over variables whose names start with `mock`.
const mockInsert = jest.fn();
// The parameter is declared so the table name is type-checked at the call site, and asserted
// on below — `from('team_messagse')` would otherwise be a passing test against nothing.
const mockFrom = jest.fn((_table: string) => ({ insert: mockInsert }));
const mockGetSession = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: { getSession: () => mockGetSession() },
  },
}));

beforeEach(() => {
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockFrom.mockClear();
  mockGetSession.mockReset().mockResolvedValue({
    data: { session: { user: { id: 'user-signed-in' } } },
  });
});

describe('sendTeamMessage', () => {
  it('writes the trimmed body to team_messages', async () => {
    await sendTeamMessage('   the lock screen skips two tracks   ');

    expect(mockFrom).toHaveBeenCalledWith('team_messages');
    expect(mockInsert).toHaveBeenCalledWith({
      sender_id: 'user-signed-in',
      body: 'the lock screen skips two tracks',
    });
  });

  it('takes the sender from the session, never from the caller', async () => {
    // The RLS policy would reject a forged sender_id, but the function should not offer the
    // opportunity in the first place — a signature that accepts one invites the attempt.
    await sendTeamMessage('hello');
    const [[payload]] = mockInsert.mock.calls as unknown as [[{ sender_id: string }]];
    expect(payload.sender_id).toBe('user-signed-in');
    expect(sendTeamMessage.length).toBe(1); // body only
  });

  it('refuses an empty or whitespace-only message without a round trip', async () => {
    await expect(sendTeamMessage('    ')).rejects.toThrow(/write something/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('refuses a body longer than the database CHECK allows', async () => {
    await expect(sendTeamMessage('x'.repeat(MESSAGE_MAX + 1))).rejects.toThrow(
      new RegExp(String(MESSAGE_MAX)),
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts a body exactly at the limit', async () => {
    // The screen budgets the device signature out of this same allowance, so a full-length
    // message plus its suffix must still fit — this is the ceiling that budget is cut from.
    await sendTeamMessage('x'.repeat(MESSAGE_MAX));
    expect(mockInsert).toHaveBeenCalled();
  });

  it('refuses to send when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(sendTeamMessage('hello')).rejects.toThrow(/signed in/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('surfaces a database error rather than reporting success', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'new row violates row-level security' } });
    await expect(sendTeamMessage('hello')).rejects.toThrow(/row-level security/);
  });
});
