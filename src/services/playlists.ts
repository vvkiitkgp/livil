import { supabase } from '../../lib/supabase';

export type UserPlaylist = {
  id: string;
  name: string;
  postCount: number;
  coverArtUrl: string | null;
};

export type PlaylistItem = {
  postId: string;
  trackId: string;
  title: string;
  artistName: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  coverArtUrl: string | null;
  thumbnailUrl: string | null;
  mediaKind: 'audio' | 'video';
  audioUrl: string | null;
  videoUrl: string | null;
};

export type StarredUser = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  fansCount: number;
  recentPostCount: number;
};

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) { throw new Error('Not signed in.'); }
  return data.user.id;
}

export async function getLikedPostCount(): Promise<number> {
  const me = await getCurrentUserId();
  const { count, error } = await supabase
    .from('post_likes')
    .select('post_id', { count: 'exact', head: true })
    .eq('user_id', me);
  if (error) { throw new Error(error.message); }
  return count ?? 0;
}

export async function getStarredUsersCount(): Promise<number> {
  const me = await getCurrentUserId();
  const { count, error } = await supabase
    .from('follows')
    .select('following_id', { count: 'exact', head: true })
    .eq('follower_id', me)
    .eq('kind', 'star');
  if (error) { throw new Error(error.message); }
  return count ?? 0;
}

export async function fetchLikedPosts(limit = 200): Promise<PlaylistItem[]> {
  const me = await getCurrentUserId();
  const { data, error } = await supabase
    .from('post_likes')
    .select(`
      post_id,
      created_at,
      post:posts (
        id,
        author_id,
        track:tracks (
          id,
          title,
          media_kind,
          audio_url,
          video_url,
          cover_art_url,
          thumbnail_url
        ),
        author:profiles!posts_author_id_fkey (
          id,
          display_name,
          username,
          avatar_url
        )
      )
    `)
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) { throw new Error(error.message); }

  return ((data ?? []) as unknown as Array<{
    post_id: string;
    post: {
      id: string;
      track: {
        id: string;
        title: string;
        media_kind: 'audio' | 'video';
        audio_url: string | null;
        video_url: string | null;
        cover_art_url: string | null;
        thumbnail_url: string | null;
      } | null;
      author: { id: string; display_name: string | null; username: string; avatar_url: string | null } | null;
    } | null;
  }>)
    .filter(r => r.post?.track)
    .map(r => ({
      postId: r.post!.id,
      trackId: r.post!.track!.id,
      title: r.post!.track!.title,
      artistName: r.post!.author?.display_name ?? r.post!.author?.username ?? 'Unknown',
      authorId: r.post!.author?.id ?? '',
      authorUsername: r.post!.author?.username ?? '',
      authorAvatarUrl: r.post!.author?.avatar_url ?? null,
      coverArtUrl: r.post!.track!.cover_art_url,
      thumbnailUrl: r.post!.track!.thumbnail_url,
      mediaKind: r.post!.track!.media_kind,
      audioUrl: r.post!.track!.audio_url,
      videoUrl: r.post!.track!.video_url,
    }));
}

export async function fetchUserPlaylists(): Promise<UserPlaylist[]> {
  const me = await getCurrentUserId();
  const { data, error } = await supabase
    .from('playlists')
    .select(`
      id,
      name,
      created_at,
      playlist_posts (
        post_id,
        post:posts (
          track:tracks ( cover_art_url )
        )
      )
    `)
    .eq('user_id', me)
    .order('created_at', { ascending: false });

  if (error) { throw new Error(error.message); }

  return ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    playlist_posts: Array<{
      post_id: string;
      post: { track: { cover_art_url: string | null } | null } | null;
    }>;
  }>).map(p => {
    const firstCover = p.playlist_posts.find(pp => pp.post?.track?.cover_art_url)?.post?.track?.cover_art_url ?? null;
    return {
      id: p.id,
      name: p.name,
      postCount: p.playlist_posts.length,
      coverArtUrl: firstCover,
    };
  });
}

export async function fetchPlaylistPosts(playlistId: string, limit = 200): Promise<PlaylistItem[]> {
  const { data, error } = await supabase
    .from('playlist_posts')
    .select(`
      post_id,
      added_at,
      post:posts (
        id,
        track:tracks (
          id,
          title,
          media_kind,
          audio_url,
          video_url,
          cover_art_url,
          thumbnail_url
        ),
        author:profiles!posts_author_id_fkey (
          id,
          display_name,
          username,
          avatar_url
        )
      )
    `)
    .eq('playlist_id', playlistId)
    .order('added_at', { ascending: false })
    .limit(limit);

  if (error) { throw new Error(error.message); }

  return ((data ?? []) as unknown as Array<{
    post_id: string;
    post: {
      id: string;
      track: {
        id: string;
        title: string;
        media_kind: 'audio' | 'video';
        audio_url: string | null;
        video_url: string | null;
        cover_art_url: string | null;
        thumbnail_url: string | null;
      } | null;
      author: { id: string; display_name: string | null; username: string; avatar_url: string | null } | null;
    } | null;
  }>)
    .filter(r => r.post?.track)
    .map(r => ({
      postId: r.post!.id,
      trackId: r.post!.track!.id,
      title: r.post!.track!.title,
      artistName: r.post!.author?.display_name ?? r.post!.author?.username ?? 'Unknown',
      authorId: r.post!.author?.id ?? '',
      authorUsername: r.post!.author?.username ?? '',
      authorAvatarUrl: r.post!.author?.avatar_url ?? null,
      coverArtUrl: r.post!.track!.cover_art_url,
      thumbnailUrl: r.post!.track!.thumbnail_url,
      mediaKind: r.post!.track!.media_kind,
      audioUrl: r.post!.track!.audio_url,
      videoUrl: r.post!.track!.video_url,
    }));
}

export async function createPlaylist(name: string): Promise<UserPlaylist> {
  const me = await getCurrentUserId();
  const { data, error } = await supabase
    .from('playlists')
    .insert({ user_id: me, name: name.trim() })
    .select('id, name, created_at')
    .single();
  if (error || !data) { throw new Error(error?.message ?? 'Failed to create playlist.'); }
  return { id: data.id, name: data.name, postCount: 0, coverArtUrl: null };
}

export async function addPostToPlaylist(playlistId: string, postId: string): Promise<void> {
  const { error } = await supabase
    .from('playlist_posts')
    .upsert({ playlist_id: playlistId, post_id: postId }, { onConflict: 'playlist_id,post_id' });
  if (error) { throw new Error(error.message); }
}

export async function removePostFromPlaylist(playlistId: string, postId: string): Promise<void> {
  const { error } = await supabase
    .from('playlist_posts')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('post_id', postId);
  if (error) { throw new Error(error.message); }
}

export async function isPostInPlaylist(playlistId: string, postId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('playlist_posts')
    .select('post_id', { count: 'exact', head: false })
    .eq('playlist_id', playlistId)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) { return false; }
  return data !== null;
}

export async function fetchStarredUsers(): Promise<StarredUser[]> {
  const me = await getCurrentUserId();

  const { data, error } = await supabase
    .from('follows')
    .select(`
      following_id,
      profile:profiles!follows_following_id_fkey (
        id,
        username,
        display_name,
        avatar_url,
        followers_count
      )
    `)
    .eq('follower_id', me)
    .eq('kind', 'star')
    .order('created_at', { ascending: false });

  if (error) { throw new Error(error.message); }

  const rows = (data ?? []) as unknown as Array<{
    following_id: string;
    profile: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      followers_count: number;
    } | null;
  }>;

  const userIds = rows.map(r => r.following_id);
  if (userIds.length === 0) { return []; }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPosts } = await supabase
    .from('posts')
    .select('author_id')
    .in('author_id', userIds)
    .gte('created_at', thirtyDaysAgo);

  const recentCountByUser = new Map<string, number>();
  for (const p of recentPosts ?? []) {
    recentCountByUser.set(p.author_id, (recentCountByUser.get(p.author_id) ?? 0) + 1);
  }

  return rows
    .filter(r => r.profile)
    .map(r => ({
      userId: r.following_id,
      username: r.profile!.username,
      displayName: r.profile!.display_name,
      avatarUrl: r.profile!.avatar_url,
      fansCount: r.profile!.followers_count,
      recentPostCount: recentCountByUser.get(r.following_id) ?? 0,
    }));
}
