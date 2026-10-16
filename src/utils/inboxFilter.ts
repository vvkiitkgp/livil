/**
 * Which conversations the Messages search shows for what was typed.
 *
 * Client-side on purpose: `list_my_conversations` has no limit and no pagination, so every
 * conversation is already on the device and a match can never be hiding behind a page.
 *
 * Matches the NAME people know the chat by — a DM's person (display name or @username), a
 * group's name, and a group's members as far as the faces we already have go (up to six).
 * Not the last message: it is only ever the latest one, so a search that found "the chat
 * where we talked about Coldplay" only until someone said "ok" would read as broken.
 */

export type InboxSearchable = {
  kind: 'dm' | 'group';
  name: string | null;
  otherUserName: string | null;
  otherUserUsername: string | null;
};

export type InboxSearchFace = { username: string | null; displayName: string | null };

/** Lower-cased and trimmed; a leading "@" is dropped so "@riya" finds riya. */
export function normalizeInboxQuery(query: string): string {
  return query.trim().replace(/^@+/, '').toLowerCase();
}

export function conversationMatches(
  item: InboxSearchable,
  normalizedQuery: string,
  faces?: readonly InboxSearchFace[],
): boolean {
  if (!normalizedQuery) { return true; }
  const names =
    item.kind === 'dm'
      ? [item.otherUserName, item.otherUserUsername]
      : [item.name, ...(faces ?? []).flatMap(f => [f.displayName, f.username])];
  return names.some(n => !!n && n.toLowerCase().includes(normalizedQuery));
}
