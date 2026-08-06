/**
 * Merging credits into a queue row.
 *
 * The batch case is what this pins. "Credits for all 12" runs the merge against twelve
 * lists that may each already hold per-row credits, and the failure mode is silent: a
 * credit that gets dropped looks exactly like a credit nobody added, and the person it
 * belonged to is simply never tagged.
 */
import { mergeCredits } from '../credits';
import type { PendingCollaborator } from '@shared/constants/roles';

const user = (id: string, role: string, name = id): PendingCollaborator => ({
  clientId: `${id}-${role}`,
  kind: 'user',
  userId: id,
  name,
  role,
});

const custom = (name: string, role: string): PendingCollaborator => ({
  clientId: `custom-${name.toLowerCase()}-${role}`,
  kind: 'custom',
  name,
  role,
});

describe('mergeCredits', () => {
  it('appends rather than replacing — a batch credit must not wipe a row-specific one', () => {
    const existing = [custom('Session drummer', 'Drums')];
    const merged = mergeCredits(existing, user('u1', 'Mixing'));
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing[0]);
  });

  it('ignores an exact repeat', () => {
    const existing = [user('u1', 'Mixing')];
    expect(mergeCredits(existing, user('u1', 'Mixing'))).toBe(existing);
  });

  it('keeps one person under two roles — that is two credits, not a duplicate', () => {
    const merged = mergeCredits([user('u1', 'Drums')], user('u1', 'Production'));
    expect(merged.map(c => c.role)).toEqual(['Drums', 'Production']);
  });

  it('does not mutate the list it was given', () => {
    const existing = [user('u1', 'Drums')];
    mergeCredits(existing, user('u2', 'Bass'));
    expect(existing).toHaveLength(1);
  });

  it('treats a typed name and a profile as different credits even at the same role', () => {
    // They are different rows in the table — one carries user_id, the other custom_name.
    const merged = mergeCredits([custom('Ana', 'Vocals')], user('u9', 'Vocals', 'Ana'));
    expect(merged).toHaveLength(2);
  });
});

describe('one person, several roles', () => {
  // The guitarist who also wrote it. The picker used to hide an already-credited person
  // from its search, which made this impossible to express at all.
  it('accumulates every role a person holds', () => {
    let credits = mergeCredits([], user('u1', 'Guitar'));
    credits = mergeCredits(credits, user('u1', 'Songwriting'));
    credits = mergeCredits(credits, user('u1', 'Backing Vocals'));
    expect(credits).toHaveLength(3);
    expect(credits.every(c => c.userId === 'u1')).toBe(true);
    expect(credits.map(c => c.role)).toEqual(['Guitar', 'Songwriting', 'Backing Vocals']);
  });

  it('still refuses the same person in the same role twice', () => {
    const once = mergeCredits([], user('u1', 'Guitar'));
    expect(mergeCredits(once, user('u1', 'Guitar'))).toHaveLength(1);
  });
});
