/**
 * The roster: everyone with an account, and what they have done.
 *
 * Behind `ops_users_overview()`, a SECURITY DEFINER function that checks `is_ops()` itself.
 * Same posture as the rest of the dashboard — a non-ops caller gets an empty array rather
 * than an error, which is why /studio/ops needs no route guard.
 *
 * COUNTS COME FROM THE SOURCE TABLES, not from `profiles.followers_count`. That counter is
 * trigger-maintained and can drift — `posts.views_count` was once found 196 above the real
 * number. A dashboard whose job is to tell you the truth should not read a cache of it.
 */
import { supabase } from '../supabase';

export type OpsUser = {
  id: string;
  displayName: string | null;
  username: string | null;
  /** From `auth.users`. Null only if the auth row is missing, which should be impossible. */
  email: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** Tracks uploaded. Not posts — a repost makes a post but no track. */
  tracksCount: number;
  postsCount: number;
  /**
   * People who follow them. Livil's word for a follow IS a star: `follows_kind_check`
   * permits exactly one value, `kind = 'star'`, so "fans" and "stars" are one number and
   * showing them as two columns would imply a distinction the schema does not make.
   */
  starsCount: number;
  /** Accepted friendships only. A pending request is not a friend. */
  friendsCount: number;
  /** Likes received across everything they have posted. */
  likesReceived: number;
};

export async function fetchOpsUsers(): Promise<OpsUser[]> {
  const { data, error } = await supabase.rpc('ops_users_overview');
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    id: r.id,
    displayName: r.display_name,
    username: r.username,
    email: r.email,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    // bigint arrives as a string or a number depending on the driver path; normalise once
    // here so no caller has to remember which.
    tracksCount: Number(r.tracks_count ?? 0),
    postsCount: Number(r.posts_count ?? 0),
    starsCount: Number(r.stars_count ?? 0),
    friendsCount: Number(r.friends_count ?? 0),
    likesReceived: Number(r.likes_received ?? 0),
  }));
}
