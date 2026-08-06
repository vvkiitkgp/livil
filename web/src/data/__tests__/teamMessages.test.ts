/**
 * Sending a message to the team.
 *
 * Worth pinning because the failure is silent in exactly the way this feature exists to fix.
 * The screen it replaces was a `mailto:` — a message that never arrived left no trace at all.
 * If `sendTeamMessage` ever stops attributing the sender correctly, or starts accepting a
 * caller-supplied `sender_id`, the row still lands and nothing looks broken until someone
 * reads the ops list and finds a message signed by the wrong artist.
 */
import { sendTeamMessage, MESSAGE_MAX } from '../teamMessages';

// `mock`-prefixed names: jest.mock() is hoisted above these declarations, and the factory may
// only close over variables whose names start with `mock`.
const mockInsert = jest.fn();
// The parameter is declared so the table name is type-checked at the call site, and asserted
// on below — `from('team_messagse')` would otherwise be a passing test against nothing.
const mockFrom = jest.fn((_table: string) => ({ insert: mockInsert }));
const mockGetSession = jest.fn();

jest.mock('../../supabase', () => ({
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
    await sendTeamMessage('   the upload screen forgets my cover art   ');

    expect(mockFrom).toHaveBeenCalledWith('team_messages');
    expect(mockInsert).toHaveBeenCalledWith({
      sender_id: 'user-signed-in',
      body: 'the upload screen forgets my cover art',
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
