/**
 * Suggested people for the empty Search screen, from `search_discover_people`
 * (20261005000000_search_discover_people.sql). Both lists come from the viewer's friends:
 *
 *   · `friends` — unverified friends of your friends, most mutual friends first;
 *   · `people`  — everyone else unverified, as a fallback so "People you may know" is never
 *                 empty for someone with few or no friends: most artists starred in common
 *                 first, then most fans, then newest (20261007010000);
 *   · `artists` — verified accounts you don't star yet, ranked by how many of your friends
 *                 star them, then by fans (so someone with no friends yet still gets some).
 *
 * `mutualCount` is that ranking number — mutual friends, artists in common, or friends who
 * are fans. A count only; the server never says which friends.
 *
 * FAIL-SAFE: two empty lists on any error, including the function not existing yet on an
 * older database. This is a suggestion surface over an empty search box; a failure should
 * leave the screen as it was before the feature, never put an error in front of it.
 */
import { supabase } from '../../lib/supabase';
import type { ProfileSearchResult } from './tracks';

export type SuggestedPerson = ProfileSearchResult & { mutualCount: number };

export type DiscoverPeople = {
  friends: SuggestedPerson[];
  people: SuggestedPerson[];
  artists: SuggestedPerson[];
};

type Row = {
  section: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  mutual_count: number | null;
};

export async function fetchDiscoverPeople(limit: number): Promise<DiscoverPeople> {
  const out: DiscoverPeople = { friends: [], people: [], artists: [] };
  try {
    const { data, error } = await (supabase as any).rpc('search_discover_people', { p_limit: limit });
    if (error || !data) { return out; }
    for (const row of data as Row[]) {
      if (!row.user_id || !row.username) { continue; }
      const person: SuggestedPerson = {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        mutualCount: Number(row.mutual_count) || 0,
      };
      if (row.section === 'friends') { out.friends.push(person); }
      else if (row.section === 'people') { out.people.push(person); }
      else if (row.section === 'artists') { out.artists.push(person); }
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * The X on a suggested person or artist: never suggest this account to me again, in any
 * section.
 *
 * Server-side (`suggestion_dismissals`, owner-only RLS) so it survives a reinstall and
 * a second phone. Idempotent — a second tap on the same person is a no-op, not an error.
 * Returns false on failure instead of throwing: the row is already gone from the screen,
 * and the worst case is the person reappearing on a later visit.
 */
export async function dismissSuggestion(dismissedUserId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    const me = data?.user?.id;
    if (!me || !dismissedUserId || me === dismissedUserId) { return false; }
    const { error } = await (supabase as any)
      .from('suggestion_dismissals')
      .upsert(
        { user_id: me, dismissed_user_id: dismissedUserId },
        { onConflict: 'user_id,dismissed_user_id', ignoreDuplicates: true },
      );
    return !error;
  } catch {
    return false;
  }
}
