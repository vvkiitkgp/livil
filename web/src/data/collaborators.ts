/**
 * Finding people to credit.
 *
 * Deliberately local to `web/` for the same reason as `creator.ts`: this mirrors
 * `searchProfiles` in `src/services/tracks.ts`, and moving that one is an extraction that
 * touches the mobile data layer — it should not ride on a dashboard ticket. The behaviour
 * is copied precisely, including the two-query ranking, so that a person who searches the
 * same string in both clients sees the same list. If they drift, the extraction is overdue.
 *
 * The WRITE half is not here on purpose. Credits are inserted by `publishTrack`, as part of
 * publishing, so a track and its credits succeed or fail together.
 */
import { supabase } from '../supabase';

export type ProfileMatch = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type Row = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

const COLUMNS = 'id, username, display_name, avatar_url';

const toMatch = (p: Row): ProfileMatch => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
  avatarUrl: p.avatar_url,
});

export async function searchProfiles(
  query: string,
  options: { excludeUserIds?: string[]; limit?: number } = {},
): Promise<ProfileMatch[]> {
  const trimmed = query.trim();
  const limit = options.limit ?? 20;
  const exclude = options.excludeUserIds ?? [];

  // Empty query lists the first page alphabetically rather than nothing: opening the picker
  // with a blank panel reads as broken, and an artist crediting their usual collaborators
  // often recognises the handle faster than they can spell it.
  if (trimmed.length === 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select(COLUMNS)
      .order('username', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).filter(p => !exclude.includes(p.id)).map(toMatch);
  }

  // Two parallel ilike queries rather than one `.or()` filter string: username matches rank
  // above display-name matches in the merged list, and the filter-string form is fragile
  // with user input in it. `%` and `_` are escaped — unescaped, a username of `_` matches
  // every profile in the table.
  const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
  const [byUsername, byDisplayName] = await Promise.all([
    supabase
      .from('profiles')
      .select(COLUMNS)
      .ilike('username', pattern)
      .order('username', { ascending: true })
      .limit(limit),
    supabase
      .from('profiles')
      .select(COLUMNS)
      .ilike('display_name', pattern)
      .order('display_name', { ascending: true })
      .limit(limit),
  ]);

  if (byUsername.error) throw new Error(byUsername.error.message);
  if (byDisplayName.error) throw new Error(byDisplayName.error.message);

  const seen = new Set<string>();
  const merged: Row[] = [];
  for (const row of [
    ...((byUsername.data ?? []) as Row[]),
    ...((byDisplayName.data ?? []) as Row[]),
  ]) {
    if (seen.has(row.id) || exclude.includes(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) break;
  }
  return merged.map(toMatch);
}
