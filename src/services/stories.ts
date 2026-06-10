import { supabase } from '../../lib/supabase';
import type { AuthorRef, TrackMedia } from './posts';

export type Story = {
  id: string;
  author: AuthorRef;
  track: TrackMedia;
  originalPostId: string;
  comment: string | null;
  clipStartSec: number;
  clipEndSec: number;
  createdAt: string;
  expiresAt: string;
  /** null = not yet seen by the current viewer */
  viewedAt: string | null;
};

type RpcRow = {
  story_id: string;
  author_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  track_id: string;
  track_title: string;
  track_audio_url: string | null;
  track_video_url: string | null;
  track_cover_url: string | null;
  track_media_kind: string;
  original_post_id: string;
  comment: string | null;
  clip_start_sec: number;
  clip_end_sec: number;
  created_at: string;
  expires_at: string;
  viewed_at: string | null;
};

function toStory(row: RpcRow): Story {
  return {
    id: row.story_id,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    track: {
      id: row.track_id,
      title: row.track_title,
      mediaKind: row.track_media_kind as 'audio' | 'video',
      audioUrl: row.track_audio_url,
      videoUrl: row.track_video_url,
      coverArtUrl: row.track_cover_url,
      // Stories are full-screen and use the original cover/video, not a feed
      // thumbnail — extending the RPC just to wire this through isn't worth it.
      thumbnailUrl: null,
      // Story playback uses its own clip window + player; the feed seek bar's
      // at-rest duration fallback doesn't apply here.
      durationSeconds: null,
    },
    originalPostId: row.original_post_id,
    comment: row.comment,
    clipStartSec: row.clip_start_sec,
    clipEndSec: row.clip_end_sec,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewedAt: row.viewed_at,
  };
}

/**
 * Fetch all active (not expired) stories visible to the current viewer,
 * sorted unseen-first then newest-first.
 */
export async function listActiveStories(): Promise<Story[]> {
  const { data, error } = await supabase.rpc('list_active_stories');
  if (error) {throw new Error(error.message);}
  return (data ?? []).map(row => toStory(row as unknown as RpcRow));
}

/**
 * Create a story repost — a 24h ephemeral clip of the original track.
 * Clip must be ≤ 10 seconds (enforced here and at the DB constraint).
 */
export async function createStory(
  originalPostId: string,
  comment: string,
  clipStartSec: number,
  clipEndSec: number,
): Promise<{ storyId: string }> {
  if (clipEndSec - clipStartSec > 10) {
    throw new Error('Story clip must be 10 seconds or less.');
  }
  if (clipEndSec <= clipStartSec) {
    throw new Error('Clip end must be after clip start.');
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to create a story.');
  }
  const me = userData.user.id;

  const { data: original, error: origError } = await supabase
    .from('posts')
    .select('id, kind, track_id')
    .eq('id', originalPostId)
    .maybeSingle();

  if (origError) {throw new Error(origError.message);}
  if (!original) {throw new Error('Original post not found.');}
  if (original.kind !== 'upload') {
    throw new Error('You can only story-repost an upload, not another repost.');
  }

  const { data: created, error: insertError } = await supabase
    .from('stories')
    .insert({
      author_id: me,
      track_id: original.track_id,
      original_post_id: originalPostId,
      comment: comment.trim() ? comment.trim() : null,
      clip_start_sec: clipStartSec,
      clip_end_sec: clipEndSec,
    })
    .select('id')
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? 'Failed to create story.');
  }

  return { storyId: created.id };
}

/**
 * Mark a story as seen by the current viewer. Idempotent — safe to call
 * multiple times (the primary key deduplicates).
 */
export async function markStorySeen(storyId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {return;}

  const { error } = await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: me }, { onConflict: 'story_id,viewer_id' });

  if (error) {throw new Error(error.message);}
}
