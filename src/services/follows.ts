import { supabase } from '../../lib/supabase';

export type FollowCounts = {
  /** Number of people who star this user (one-way audience). */
  fans: number;
  /** Number of mutual, accepted friendships this user is part of. */
  friends: number;
  /** Number of people this user stars (i.e. "my Stars"). */
  stars: number;
};

/**
 * Read-side only for this round. Mutations (Add Friend / Add as Star) ship with
 * the suggestions-page round; see plan.
 */
export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  const [fansResult, starsResult, friendCount] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', userId)
      .eq('kind', 'star'),
    supabase
      .from('follows')
      .select('following_id', { count: 'exact', head: true })
      .eq('follower_id', userId)
      .eq('kind', 'star'),
    getFriendCount(userId),
  ]);

  if (fansResult.error) {throw new Error(fansResult.error.message);}
  if (starsResult.error) {throw new Error(starsResult.error.message);}

  return {
    fans: fansResult.count ?? 0,
    stars: starsResult.count ?? 0,
    friends: friendCount,
  };
}

/**
 * Accepted-friend count for ANY profile. friendships RLS admits only the two
 * participants, so a direct count on someone else's profile read 0 (or 1 if you
 * were their friend). `profile_friend_count` is a DEFINER RPC defined as the size
 * of `list_profile_friends`, so this pill always matches the Friends screen.
 *
 * Falls back to the old caller-rights count ONLY if the RPC is missing (migration
 * 20260930010000 not yet applied) — a wrong number beats a profile that fails to load.
 */
async function getFriendCount(userId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc('profile_friend_count', { p_user_id: userId });
  if (!error) { return typeof data === 'number' ? data : 0; }
  // Only a MISSING function falls back. Any other failure throws: silently
  // showing the caller-rights count would put back the wrong number this fixes.
  if (error.code !== 'PGRST202' && error.code !== '42883') { throw new Error(error.message); }

  const fallback = await supabase
    .from('friendships')
    .select('user_a_id', { count: 'exact', head: true })
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .eq('status', 'accepted');
  if (fallback.error) { throw new Error(fallback.error.message); }
  return fallback.count ?? 0;
}

export type ProfileFriend = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Accepted friends of any profile, newest friendship first. Visible to every
 * signed-in viewer (product decision 2026-09-29 — it is how people find each other
 * while there is no suggestions graph). A blocked pair gets an empty list; friends
 * blocked with the viewer are omitted server-side.
 */
export async function listProfileFriends(userId: string): Promise<ProfileFriend[]> {
  const { data, error } = await (supabase as any).rpc('list_profile_friends', { p_user_id: userId });
  if (error) { throw new Error(error.message); }
  return ((data ?? []) as Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  }>).map(r => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
  }));
}
