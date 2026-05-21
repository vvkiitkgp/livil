import { supabase } from '../../lib/supabase';

export type FriendListenStory = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  trackTitle: string;
  artistName: string;
  updatedAt: string;
};

/**
 * People you share a mutual friendship with or people you star (your Stars),
 * with their latest “now playing” snapshot — rendered like stories on Home.
 */
export async function listFriendListenStories(): Promise<FriendListenStory[]> {
  const { data, error } = await supabase.rpc('list_friend_listen_stories');
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(row => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    trackTitle: row.track_title,
    artistName: row.artist_name,
    updatedAt: row.updated_at,
  }));
}
