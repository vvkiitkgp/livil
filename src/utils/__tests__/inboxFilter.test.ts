/**
 * The Messages search: what a query finds. Pure matching — the screen only feeds it.
 */
import { conversationMatches, normalizeInboxQuery, type InboxSearchable } from '../inboxFilter';

const dm = (otherUserName: string | null, otherUserUsername: string | null): InboxSearchable =>
  ({ kind: 'dm', name: null, otherUserName, otherUserUsername });
const group = (name: string | null): InboxSearchable =>
  ({ kind: 'group', name, otherUserName: null, otherUserUsername: null });

const q = (s: string) => normalizeInboxQuery(s);

describe('normalizeInboxQuery', () => {
  it.each([
    ['  Riya ', 'riya'],
    ['@riya', 'riya'],
    ['@@Riya', 'riya'],
    ['   ', ''],
  ])('%p → %p', (input, expected) => {
    expect(normalizeInboxQuery(input)).toBe(expected);
  });
});

describe('conversationMatches', () => {
  it('shows everything for an empty query', () => {
    expect(conversationMatches(dm('Riya', 'riya_k'), q(''))).toBe(true);
  });

  it("finds a DM by the person's display name or username, case-insensitively, mid-word too", () => {
    const riya = dm('Riya Kapoor', 'riya_k');
    expect(conversationMatches(riya, q('kap'))).toBe(true);
    expect(conversationMatches(riya, q('@RIYA_K'))).toBe(true);
    expect(conversationMatches(riya, q('arjun'))).toBe(false);
  });

  it('finds a DM whose person has no display name', () => {
    expect(conversationMatches(dm(null, 'sam'), q('sa'))).toBe(true);
  });

  it("finds a group by its name or by a member we have a face for", () => {
    const faces = [{ username: 'arjun', displayName: 'Arjun M' }, { username: 'neha', displayName: null }];
    expect(conversationMatches(group('Road trip 🚗'), q('road'), faces)).toBe(true);
    expect(conversationMatches(group('Road trip 🚗'), q('neha'), faces)).toBe(true);
    expect(conversationMatches(group('Road trip 🚗'), q('arjun m'), faces)).toBe(true);
    expect(conversationMatches(group('Road trip 🚗'), q('riya'), faces)).toBe(false);
  });

  it('does not match a DM on fields that belong to groups', () => {
    expect(conversationMatches({ ...dm('Riya', 'riya'), name: 'Road trip' }, q('road'))).toBe(false);
  });

  it('copes with an unnamed group and no faces', () => {
    expect(conversationMatches(group(null), q('x'))).toBe(false);
  });
});
