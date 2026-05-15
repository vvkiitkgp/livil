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
  const [fansResult, starsResult, friendshipsResult] = await Promise.all([
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
    // RLS hides friendships the viewer isn't a participant in, so this count is
    // only meaningful when reading your own profile. For other users we'd need
    // a SECURITY DEFINER view; out of scope for this round.
    supabase
      .from('friendships')
      .select('user_a_id', { count: 'exact', head: true })
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .eq('status', 'accepted'),
  ]);

  if (fansResult.error) {throw new Error(fansResult.error.message);}
  if (starsResult.error) {throw new Error(starsResult.error.message);}
  if (friendshipsResult.error) {throw new Error(friendshipsResult.error.message);}

  return {
    fans: fansResult.count ?? 0,
    stars: starsResult.count ?? 0,
    friends: friendshipsResult.count ?? 0,
  };
}
