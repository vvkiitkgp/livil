import { supabase } from '../../lib/supabase';
import { fetchPostsByIds, type FeedPost } from './posts';

// jam_suggestions is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type SuggestionStatus = 'waiting' | 'queued' | 'played';

export type JamSuggester = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** One song in the Suggests tab — every row for the same post, grouped. */
export type JamSuggestionGroup = {
  postId: string;
  post: FeedPost;
  /** Most recent first. */
  suggesters: JamSuggester[];
  status: SuggestionStatus;
  latestAt: string;
};

export type JamSuggestionRow = {
  postId: string;
  suggestedBy: string;
  createdAt: string;
};

const STATUS_RANK: Record<SuggestionStatus, number> = { waiting: 0, queued: 1, played: 2 };

/**
 * The jam's suggestions, grouped by song: most-suggested first, then newest. A song
 * whose post can no longer be read (deleted, taken down, blocked) drops out.
 * Also returns the raw rows, for the unread count.
 */
export async function listJamSuggestions(
  jamRoomId: string,
): Promise<{ groups: JamSuggestionGroup[]; rows: JamSuggestionRow[] }> {
  const { data, error } = await db
    .from('jam_suggestions')
    .select(`
      post_id, suggested_by, status, created_at,
      suggester:profiles!jam_suggestions_suggested_by_fkey ( id, username, display_name, avatar_url )
    `)
    .eq('jam_room_id', jamRoomId)
    .order('created_at', { ascending: false });
  if (error) { throw new Error(error.message); }

  type Raw = {
    post_id: string;
    suggested_by: string;
    status: SuggestionStatus;
    created_at: string;
    suggester: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
  };
  const raw = (data ?? []) as Raw[];
  const rows: JamSuggestionRow[] = raw.map(r => ({
    postId: r.post_id, suggestedBy: r.suggested_by, createdAt: r.created_at,
  }));

  const order: string[] = [];
  const byPost = new Map<string, { rows: Raw[] }>();
  for (const r of raw) {
    if (!byPost.has(r.post_id)) { byPost.set(r.post_id, { rows: [] }); order.push(r.post_id); }
    byPost.get(r.post_id)!.rows.push(r);
  }
  const posts = await fetchPostsByIds(order);
  const postById = new Map(posts.map(p => [p.id, p]));

  const groups: JamSuggestionGroup[] = [];
  for (const postId of order) {
    const post = postById.get(postId);
    if (!post) { continue; }
    const g = byPost.get(postId)!.rows;
    const status = g.reduce<SuggestionStatus>(
      (acc, r) => (STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc),
      'waiting',
    );
    groups.push({
      postId,
      post,
      status,
      latestAt: g[0]!.created_at,
      suggesters: g.map(r => ({
        id: r.suggested_by,
        username: r.suggester?.username ?? 'someone',
        displayName: r.suggester?.display_name ?? null,
        avatarUrl: r.suggester?.avatar_url ?? null,
      })),
    });
  }
  groups.sort((a, b) =>
    b.suggesters.length - a.suggesters.length || b.latestAt.localeCompare(a.latestAt));
  return { groups, rows };
}

export type SuggestResult = 'suggested' | 'already' | 'full';

/** Suggest a post to the jam as the signed-in user. */
export async function suggestToJam(jamRoomId: string, postId: string): Promise<SuggestResult> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { throw new Error('Not signed in'); }
  const { error } = await db
    .from('jam_suggestions')
    .insert({ jam_room_id: jamRoomId, post_id: postId, suggested_by: me });
  if (!error) { return 'suggested'; }
  if (error.code === '23505') { return 'already'; }
  if (/jam_suggestions_full/.test(error.message ?? '')) { return 'full'; }
  throw new Error(error.message);
}

/** Host: mark every suggestion of this song as queued / played. */
export async function setJamSuggestionStatus(
  jamRoomId: string,
  postId: string,
  status: SuggestionStatus,
): Promise<void> {
  const { error } = await db
    .from('jam_suggestions')
    .update({ status })
    .eq('jam_room_id', jamRoomId)
    .eq('post_id', postId);
  if (error) { throw new Error(error.message); }
}

/** Host: remove a song from the Suggests list. */
export async function dismissJamSuggestion(jamRoomId: string, postId: string): Promise<void> {
  const { error } = await db
    .from('jam_suggestions')
    .delete()
    .eq('jam_room_id', jamRoomId)
    .eq('post_id', postId);
  if (error) { throw new Error(error.message); }
}
