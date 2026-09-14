import {
  AUTHOR_INITIAL_FALLBACK,
  DELETED_AUTHOR_NAME,
  avatarInitials,
  resolveAuthorById,
  resolveAuthorDisplay,
} from '../authorDisplay';

describe('resolveAuthorDisplay', () => {
  it('prefers the display name when both are present', () => {
    const d = resolveAuthorDisplay({ displayName: 'Vamsi', username: 'vvk' });
    expect(d.name).toBe('Vamsi');
    expect(d.initial).toBe('V');
    expect(d.isDeleted).toBe(false);
  });

  it('falls back to the username when the display name is absent', () => {
    const d = resolveAuthorDisplay({ displayName: null, username: 'vvk' });
    expect(d.name).toBe('vvk');
    expect(d.initial).toBe('V');
    expect(d.isDeleted).toBe(false);
  });

  it('shows the deleted placeholder when both are null', () => {
    const d = resolveAuthorDisplay({ displayName: null, username: null });
    expect(d.name).toBe(DELETED_AUTHOR_NAME);
    expect(d.name).toBe('[deleted]');
    expect(d.isDeleted).toBe(true);
  });

  it('shows the deleted placeholder when both fields are missing', () => {
    const d = resolveAuthorDisplay({});
    expect(d.name).toBe(DELETED_AUTHOR_NAME);
    expect(d.isDeleted).toBe(true);
  });

  it('treats an empty string as absent, not as a name', () => {
    const both = resolveAuthorDisplay({ displayName: '', username: '' });
    expect(both.name).toBe(DELETED_AUTHOR_NAME);
    expect(both.isDeleted).toBe(true);

    const usernameOnly = resolveAuthorDisplay({ displayName: '', username: 'vvk' });
    expect(usernameOnly.name).toBe('vvk');
    expect(usernameOnly.isDeleted).toBe(false);
  });

  it('treats a whitespace-only name as absent and trims a real one', () => {
    expect(resolveAuthorDisplay({ displayName: '   ', username: null }).name).toBe(
      DELETED_AUTHOR_NAME,
    );
    expect(resolveAuthorDisplay({ displayName: '  Vamsi  ' }).name).toBe('Vamsi');
  });

  it('keeps the initial as ? for a deleted author — never derived from the placeholder', () => {
    const d = resolveAuthorDisplay({ displayName: null, username: null });
    expect(d.initial).toBe(AUTHOR_INITIAL_FALLBACK);
    expect(d.initial).toBe('?');
    // The trap this exists to prevent: '[deleted]' sliced for an initial renders '['.
    expect(d.initial).not.toBe(d.name.slice(0, 1).toUpperCase());
    expect(d.initial).not.toBe('[');
  });

  it('uppercases the initial of a lowercase username', () => {
    expect(resolveAuthorDisplay({ username: 'vvk' }).initial).toBe('V');
  });

  it('takes the initial from the same field the name came from', () => {
    expect(resolveAuthorDisplay({ displayName: 'Vamsi', username: 'zed' }).initial).toBe('V');
    expect(resolveAuthorDisplay({ displayName: '', username: 'zed' }).initial).toBe('Z');
  });
});

describe('resolveAuthorById', () => {
  it('resolves a live author from the profile the join returned', () => {
    const d = resolveAuthorById('u1', { displayName: 'Vamsi', username: 'vvk' });
    expect(d.name).toBe('Vamsi');
    expect(d.initial).toBe('V');
    expect(d.isDeleted).toBe(false);
  });

  it('falls back to the username', () => {
    const d = resolveAuthorById('u1', { displayName: null, username: 'vvk' });
    expect(d.name).toBe('vvk');
    expect(d.initial).toBe('V');
    expect(d.isDeleted).toBe(false);
  });

  it('reports a nulled author id as deleted', () => {
    const d = resolveAuthorById(null, { displayName: null, username: null });
    expect(d.name).toBe(DELETED_AUTHOR_NAME);
    expect(d.isDeleted).toBe(true);
    expect(d.initial).toBe(AUTHOR_INITIAL_FALLBACK);
  });

  it('does not call a live author deleted when the profile join missed', () => {
    const d = resolveAuthorById('u1', { displayName: null, username: null });
    expect(d.isDeleted).toBe(false);
    expect(d.name).toBe('');
    expect(d.name).not.toBe(DELETED_AUTHOR_NAME);
    expect(d.initial).toBe(AUTHOR_INITIAL_FALLBACK);
  });

  it('treats an empty author id as absent, not as a live author', () => {
    expect(resolveAuthorById('', { displayName: 'Vamsi' }).isDeleted).toBe(true);
  });

  it('never derives the initial from the deleted placeholder', () => {
    expect(resolveAuthorById(null, {}).initial).not.toBe('[');
  });
});

describe('avatarInitials', () => {
  it('takes two letters from a single-word name', () => {
    expect(avatarInitials(resolveAuthorDisplay({ displayName: 'Vamsi' }))).toBe('VA');
  });

  it('takes one letter from each of the first two words', () => {
    expect(avatarInitials(resolveAuthorDisplay({ displayName: 'Vamsi Bosara' }))).toBe('VB');
  });

  it('ignores everything past the second word', () => {
    expect(avatarInitials(resolveAuthorDisplay({ displayName: 'Ann Bee Cee' }))).toBe('AB');
  });

  it('uses the ? fallback for a deleted author, never the placeholder text', () => {
    const d = resolveAuthorDisplay({ displayName: null, username: null });
    expect(avatarInitials(d)).toBe(AUTHOR_INITIAL_FALLBACK);
    expect(avatarInitials(d)).not.toBe('[D');
  });

  it('uses the ? fallback for a live author whose profile join missed', () => {
    expect(avatarInitials(resolveAuthorById('u1', {}))).toBe(AUTHOR_INITIAL_FALLBACK);
  });
});
