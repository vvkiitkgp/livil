/**
 * What the viewer has in common with a profile they are looking at:
 *
 *   · `friends`    — people who are friends with BOTH of you (mutual friends);
 *   · `friendFans` — YOUR friends who star this profile ("Starred by kiran and 2 other
 *                    friends").
 *
 * NO NEW SERVER SURFACE. Both are computed from data every signed-in viewer can already
 * read: the viewer's own friends, `list_profile_friends` (public), and `follows` (SELECT is
 * `using (true)`). `friendFans` is deliberately limited to the viewer's own friends — it is
 * "which of the people I know star this artist", not a browsable fan list, which stays
 * owner-only (product decision 2026-09-30, `list_my_fans`).
 *
 * FAIL-SAFE: each half falls back to empty on its own. This is decoration on a profile that
 * has already loaded; a failure hides the line, it never puts an error on the screen.
 */
import { supabase } from '../../lib/supabase';
import { listFriends } from './relationships';
import { listProfileFriends, type ProfilePerson } from './follows';

export type ProfileMutuals = {
  friends: ProfilePerson[];
  friendFans: ProfilePerson[];
};

const EMPTY: ProfileMutuals = { friends: [], friendFans: [] };

export async function fetchProfileMutuals(profileUserId: string): Promise<ProfileMutuals> {
  try {
    const { data } = await supabase.auth.getUser();
    const me = data?.user?.id;
    if (!me || !profileUserId || me === profileUserId) { return EMPTY; }

    const myFriends = await listFriends();
    if (myFriends.length === 0) { return EMPTY; }
    const mine = new Map<string, ProfilePerson>(myFriends.map(f => [f.id, {
      userId: f.id, username: f.username, displayName: f.displayName, avatarUrl: f.avatarUrl,
    }]));

    const [theirFriends, stars] = await Promise.allSettled([
      listProfileFriends(profileUserId),
      supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', profileUserId)
        .eq('kind', 'star')
        .in('follower_id', [...mine.keys()]),
    ]);

    // Their order (newest friendship first), so the names shown are their recent friends.
    const friends = theirFriends.status === 'fulfilled'
      ? theirFriends.value.filter(p => p.userId !== me && mine.has(p.userId))
      : [];

    const friendFans = stars.status === 'fulfilled' && !stars.value.error
      ? ((stars.value.data ?? []) as { follower_id: string }[])
          .map(r => mine.get(r.follower_id))
          .filter((p): p is ProfilePerson => !!p)
      : [];

    return { friends, friendFans };
  } catch {
    return EMPTY;
  }
}
