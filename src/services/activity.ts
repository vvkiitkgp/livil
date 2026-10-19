import { supabase } from '../../lib/supabase';
import { sendPush, type PushKind } from './pushDispatch';
import { isProfileBadge, type ProfileBadge } from './profileBadges';

const db = supabase as any;

// ── Types ────────────────────────────────────────────────────────────────────
// ActivityItem is a discriminated union keyed on `type`. This is the
// extensibility seam: a new activity kind adds a union member here and a `case`
// in ActivityBubble — nothing else changes.

export type ActivityType =
  | 'like'
  | 'comment'
  | 'repost'
  | 'play_milestone'
  | 'new_fan'
  | 'friend_accepted'
  | 'friend_rejected'
  | 'credited'
  | 'credit_accepted'
  | 'credit_declined'
  | 'badge_granted'
  | 'content_removed'
  | 'comment_like'
  | 'comment_reply'
  | 'mention';

export type ActivityActor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ActivityPostRef = {
  postId: string;
  title: string | null;
  coverArtUrl: string | null;
  /** Who made the song: the track's UPLOADER, so a like on your repost of someone's upload
      names them, not you. Filled in by attachPostDetails; null for Spotify reposts. */
  artistName: string | null;
  /** Set when the post is a Spotify repost. It has no Livil track, so `title` and
      `coverArtUrl` are null and the card describes the Spotify song instead. */
  spotifyTrackId: string | null;
};

type ActivityBase = {
  id: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ActivityItem = ActivityBase &
  (
    | { type: 'like'; actor: ActivityActor; post: ActivityPostRef; aggCount: number }
    | { type: 'comment'; actor: ActivityActor; post: ActivityPostRef; commentText: string | null; commentId: string | null }
    | { type: 'repost'; actor: ActivityActor; post: ActivityPostRef }
    // On a comment of YOURS, on anyone's post. commentText is your comment's words (a like)
    // or the reply's (a reply); commentId is the comment to highlight when it is opened.
    | {
        type: 'comment_like';
        actor: ActivityActor;
        post: ActivityPostRef;
        aggCount: number;
        commentText: string | null;
        commentId: string | null;
      }
    | {
        type: 'comment_reply';
        actor: ActivityActor;
        post: ActivityPostRef;
        commentText: string | null;
        commentId: string | null;
      }
    // You were @-tagged in someone's caption (`where: 'post'`) or comment. `text` is the
    // caption / comment as the server read it; commentId opens the comments at that one.
    | {
        type: 'mention';
        actor: ActivityActor;
        post: ActivityPostRef;
        where: 'post' | 'comment';
        text: string | null;
        commentId: string | null;
      }
    | { type: 'play_milestone'; post: ActivityPostRef; threshold: number }
    // No actor and no post: Livil telling you it gave you something, the same shape as
    // play_milestone. `badge` is the key from badge_kinds, not display copy — an
    // unrecognised one is dropped rather than rendered as itself.
    | { type: 'badge_granted'; badge: ProfileBadge }
    // Livil telling you something of yours was removed, and why. No actor, DELIBERATELY:
    // naming the operator would put a real person's profile in front of somebody who has
    // just lost content, which is an invitation to retaliate.
    //
    // `kind` distinguishes losing your own upload from losing a repost of somebody else's
    // track — the second is not the person's fault and must not read like an accusation.
    | { type: 'content_removed'; kind: 'upload' | 'repost'; trackTitle: string | null; reason: string | null }
    | { type: 'new_fan'; actor: ActivityActor }
    | { type: 'friend_accepted'; actor: ActivityActor }
    | { type: 'friend_rejected'; actor: ActivityActor }
    // Somebody credited you on their track. This is the one activity item that ASKS
    // something: it carries the credit id so the bubble can answer in place, and the
    // answer once given, so a reloaded inbox does not offer the buttons again.
    | {
        type: 'credited';
        actor: ActivityActor;
        post: ActivityPostRef;
        role: string;
        creditId: string | null;
        answered: 'accepted' | 'declined' | null;
      }
    | { type: 'credit_accepted'; actor: ActivityActor; post: ActivityPostRef; role: string }
    | { type: 'credit_declined'; actor: ActivityActor; post: ActivityPostRef; role: string }
  );

type RawActivityRow = {
  id: string;
  type: ActivityType;
  actor_id: string | null;
  post_id: string | null;
  agg_count: number;
  is_read: boolean;
  created_at: string;
  updated_at: string;
  payload: {
    threshold?: number;
    comment_text?: string;
    comment_id?: string;
    role?: string;
    credit_id?: string;
    answered?: 'accepted' | 'declined';
    /** badge_granted: the badge_kinds key. Validated before use — see rowToItem. */
    badge?: string;
    /** content_removed: 'upload' | 'repost'. Anything else is read as 'upload'. */
    kind?: string;
    /** content_removed: copied at removal time, so it survives the track being deleted. */
    track_title?: string;
    /** content_removed: the operator's own words, shown verbatim. */
    reason?: string;
    /** mention: tagged in a post's caption or in a comment. */
    where?: string;
    /** mention: the caption / comment, as the server read it (≤ 280). */
    text?: string;
  } | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  post_title: string | null;
  post_cover_art_url: string | null;
};

function rowToActor(row: RawActivityRow): ActivityActor {
  return {
    id: row.actor_id ?? '',
    username: row.actor_username ?? 'unknown',
    displayName: row.actor_display_name,
    avatarUrl: row.actor_avatar_url,
  };
}

function rowToPost(row: RawActivityRow): ActivityPostRef {
  return {
    postId: row.post_id ?? '',
    title: row.post_title,
    coverArtUrl: row.post_cover_art_url,
    artistName: null, // filled in by attachPostDetails
    spotifyTrackId: null, // filled in by attachPostDetails
  };
}

/**
 * Null when the row cannot be rendered — today only a badge this client does not know. The
 * caller filters, so an unknown type never reaches the list as a blank bubble.
 */
function rowToItem(row: RawActivityRow): ActivityItem | null {
  const base: ActivityBase = {
    id: row.id,
    isRead: row.is_read,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  switch (row.type) {
    case 'like':
      return { ...base, type: 'like', actor: rowToActor(row), post: rowToPost(row), aggCount: Number(row.agg_count ?? 1) };
    case 'comment':
      return {
        ...base,
        type: 'comment',
        actor: rowToActor(row),
        post: rowToPost(row),
        commentText: row.payload?.comment_text ?? null,
        commentId: row.payload?.comment_id ?? null,
      };
    case 'repost':
      return { ...base, type: 'repost', actor: rowToActor(row), post: rowToPost(row) };
    case 'comment_like':
      return {
        ...base,
        type: 'comment_like',
        actor: rowToActor(row),
        post: rowToPost(row),
        aggCount: Number(row.agg_count ?? 1),
        commentText: row.payload?.comment_text ?? null,
        commentId: row.payload?.comment_id ?? null,
      };
    case 'comment_reply':
      return {
        ...base,
        type: 'comment_reply',
        actor: rowToActor(row),
        post: rowToPost(row),
        commentText: row.payload?.comment_text ?? null,
        commentId: row.payload?.comment_id ?? null,
      };
    case 'mention':
      return {
        ...base,
        type: 'mention',
        actor: rowToActor(row),
        post: rowToPost(row),
        where: row.payload?.where === 'comment' ? 'comment' : 'post',
        text: row.payload?.text ?? null,
        commentId: row.payload?.comment_id ?? null,
      };
    case 'play_milestone':
      return { ...base, type: 'play_milestone', post: rowToPost(row), threshold: Number(row.payload?.threshold ?? 0) };
    case 'badge_granted': {
      const badge = row.payload?.badge;
      // A badge the app cannot draw is a badge shipped server-side before this client knew
      // it. Dropping the row is better than an item that renders as blank text.
      if (!isProfileBadge(badge)) { return null; }
      return { ...base, type: 'badge_granted', badge };
    }
    case 'content_removed': {
      const kind = row.payload?.kind === 'repost' ? 'repost' : 'upload';
      const title = typeof row.payload?.track_title === 'string' ? row.payload.track_title : null;
      const reason = typeof row.payload?.reason === 'string' ? row.payload.reason : null;
      return { ...base, type: 'content_removed', kind, trackTitle: title, reason };
    }
    case 'new_fan':
      return { ...base, type: 'new_fan', actor: rowToActor(row) };
    case 'friend_accepted':
      return { ...base, type: 'friend_accepted', actor: rowToActor(row) };
    case 'friend_rejected':
      return { ...base, type: 'friend_rejected', actor: rowToActor(row) };
    case 'credited':
      return {
        ...base,
        type: 'credited',
        actor: rowToActor(row),
        post: rowToPost(row),
        role: row.payload?.role ?? '',
        creditId: row.payload?.credit_id ?? null,
        answered: row.payload?.answered ?? null,
      };
    case 'credit_accepted':
      return {
        ...base, type: 'credit_accepted', actor: rowToActor(row),
        post: rowToPost(row), role: row.payload?.role ?? '',
      };
    case 'credit_declined':
      return {
        ...base, type: 'credit_declined', actor: rowToActor(row),
        post: rowToPost(row), role: row.payload?.role ?? '',
      };
  }
}

// ── Display helpers ──────────────────────────────────────────────────────────

function actorName(a: ActivityActor): string {
  return a.displayName?.trim() || `@${a.username}`;
}

/** activity_record_play's lowest threshold (array[5,25,100,…] in the migration). */
const FIRST_PLAY_MILESTONE = 5;

export function formatPlayThreshold(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(n);
}

const COMMENT_INLINE_MAX = 80;

function truncateInline(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// Split form used by ActivityBubble so the actor name can render as a bold,
// tappable segment. `actor` is null when there is no clickable name (e.g.
// play_milestone). `text` begins with a leading space when `actor` is set, so
// the bubble can render `<Bold>{name}</Bold>{text}` without manual spacing.
export type ActivityBubbleParts = {
  actor: ActivityActor | null;
  text: string;
};

export function activityBubbleParts(item: ActivityItem): ActivityBubbleParts {
  switch (item.type) {
    case 'like': {
      const others = item.aggCount - 1;
      const tail = others > 0
        ? ` and ${others} other${others === 1 ? '' : 's'} liked your post`
        : ' liked your post';
      return { actor: item.actor, text: tail };
    }
    case 'comment': {
      const snippet = item.commentText?.trim();
      const quoted = snippet ? `: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”` : '';
      return { actor: item.actor, text: ` commented on your post${quoted}` };
    }
    case 'repost':
      return { actor: item.actor, text: ' reposted your track' };
    case 'comment_like': {
      const others = item.aggCount - 1;
      const who = others > 0 ? ` and ${others} other${others === 1 ? '' : 's'}` : '';
      const snippet = item.commentText?.trim();
      const quoted = snippet ? `: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”` : '';
      return { actor: item.actor, text: `${who} liked your comment${quoted}` };
    }
    case 'comment_reply': {
      const snippet = item.commentText?.trim();
      const quoted = snippet ? `: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”` : '';
      return { actor: item.actor, text: ` replied to your comment${quoted}` };
    }
    case 'mention': {
      const snippet = item.text?.trim();
      const quoted = snippet ? `: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”` : '';
      return {
        actor: item.actor,
        text: item.where === 'comment' ? ` mentioned you in a comment${quoted}` : ` tagged you in a post${quoted}`,
      };
    }
    case 'play_milestone':
      // The first milestone (5 plays, activity_record_play) is the moment strangers start
      // listening — said as that, since "hit 5 plays" undersells it.
      return item.threshold === FIRST_PLAY_MILESTONE
        ? { actor: null, text: `Your first listeners are in 🎉 ${item.threshold} plays so far` }
        : { actor: null, text: `Your track hit ${formatPlayThreshold(item.threshold)} plays 🎉` };
    // Livil speaking, not a person — hence actor: null and a whole sentence rather than a
    // fragment that expects a bold name in front of it.
    case 'badge_granted':
      return item.badge === 'verified'
        ? { actor: null, text: 'Your account is now verified ✓' }
        : { actor: null, text: 'You\'re one of the First 100 on Livil 🎉' };
    // Livil speaking. A whole sentence, and the operator's own reason quoted after it so
    // the person is not left guessing — the entire point of the notice is that they learn
    // WHY, from a screen rather than from noticing a gap.
    case 'content_removed': {
      const what = item.trackTitle ? `“${item.trackTitle}”` : 'one of your posts';
      const lead =
        item.kind === 'repost'
          ? `Your repost of ${what} was removed — the original is no longer on Livil`
          : `${what} was removed from Livil`;
      return { actor: null, text: item.reason ? `${lead}. ${item.reason}` : `${lead}.` };
    }
    case 'new_fan':
      return { actor: item.actor, text: ' starred you' };
    case 'friend_accepted':
      return { actor: item.actor, text: ' accepted your friend request' };
    case 'friend_rejected':
      return { actor: item.actor, text: ' declined your friend request' };
    case 'credited': {
      const forRole = item.role ? ` for ${item.role}` : '';
      // Past tense once answered: the message stops being a question and becomes a record.
      if (item.answered === 'accepted') {
        return { actor: item.actor, text: ` credited you${forRole} — you confirmed it` };
      }
      if (item.answered === 'declined') {
        return { actor: item.actor, text: ` credited you${forRole} — you declined` };
      }
      return { actor: item.actor, text: ` credited you${forRole} on a track` };
    }
    case 'credit_accepted':
      return { actor: item.actor, text: ` confirmed the ${item.role || 'credit'} credit` };
    case 'credit_declined':
      return { actor: item.actor, text: ` declined the ${item.role || 'credit'} credit` };
  }
}

// One-line human summary for an activity item. Used by the Inbox ActivityBanner
// (preview text). ActivityBubble uses activityBubbleParts() instead so it can
// render the actor name as a tappable link.
export function activitySummary(item: ActivityItem): string {
  const { actor, text } = activityBubbleParts(item);
  return actor ? `${actorName(actor)}${text}` : text;
}

// ── Reads ────────────────────────────────────────────────────────────────────

// activity_list leaves out the types shipped apps cannot draw; activity_list_v2
// (20261031000000) returns everything. Before that migration reaches a backend, the call
// fails as a missing function — then the old list, so Activity still loads. Asked again
// after a while: an app left running across the migration should not stay on the old list.
const LIST_V2_RETRY_MS = 10 * 60 * 1000;
let listV2MissingAt: number | null = null;

function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

async function listRows(before: string | null): Promise<{ data: unknown; error: { code?: string } | null }> {
  const args = { p_limit: 50, p_before: before };
  if (listV2MissingAt === null || Date.now() - listV2MissingAt > LIST_V2_RETRY_MS) {
    const res = await db.rpc('activity_list_v2', args);
    if (!isMissingFunction(res.error)) {
      listV2MissingAt = null;
      return res;
    }
    listV2MissingAt = Date.now();
  }
  return db.rpc('activity_list', args);
}

/** Test-only. */
export function __resetActivityListForTest(): void {
  listV2MissingAt = null;
}

/**
 * `postDetails: false` skips the post lookup for callers that only need the text of an item
 * (the Inbox banner's one-line preview): it never shows a card, so it never needs artwork,
 * an artist or a Spotify id.
 */
export async function listActivity(
  beforeUpdatedAt?: string,
  { postDetails = true }: { postDetails?: boolean } = {},
): Promise<ActivityItem[]> {
  const { data, error } = await listRows(beforeUpdatedAt ?? null);
  if (error) { throw error; }
  const items = ((data ?? []) as RawActivityRow[])
    .map(rowToItem)
    // `!=` not `!==`, deliberately: an unrecognised activity TYPE falls out of the switch
    // as `undefined`, not `null`, and `undefined !== null` is true — so a strict filter
    // passes it straight through to ActivityBubble, which throws on it. That is the exact
    // scenario this guard exists for: a type added server-side ahead of a client release.
    .filter((item): item is ActivityItem => item != null);
  return postDetails ? attachPostDetails(items) : items;
}

type RawPostDetails = {
  id: string;
  spotify_track_id: string | null;
  track: {
    title: string | null;
    cover_art_url: string | null;
    thumbnail_url: string | null;
    uploader: { username: string | null; display_name: string | null } | null;
  } | null;
};

/**
 * What activity_list cannot say about a post, filled in with ONE batched query for the page:
 *
 *  - A Spotify repost has no Livil track, so it arrives with no title or artwork. Mark it
 *    with its Spotify id so the bubble describes the Spotify song (ADR-0027).
 *  - activity_list returns only the track's `cover_art_url`. A VIDEO upload has a thumbnail
 *    instead, so a like on one drew the grey placeholder: use cover, else thumbnail (the
 *    order the player and the share card use).
 *  - It returns no artist, so every Livil card said "Tap to view". Use the track's uploader,
 *    so a repost of someone's song names them rather than the reposter.
 *
 * Read-time, so notifications written before this existed render correctly too. On any
 * failure the items are left exactly as activity_list returned them.
 */
async function attachPostDetails(items: ActivityItem[]): Promise<ActivityItem[]> {
  const ids = new Set<string>();
  for (const item of items) {
    if ('post' in item && item.post.postId) { ids.add(item.post.postId); }
  }
  if (ids.size === 0) { return items; }
  let rows: RawPostDetails[];
  try {
    const { data, error } = await db
      .from('posts')
      .select(
        'id, spotify_track_id, track:tracks ( title, cover_art_url, thumbnail_url, uploader:profiles!tracks_uploader_id_fkey ( username, display_name ) )',
      )
      .in('id', Array.from(ids));
    if (error || !data) { return items; }
    rows = data as RawPostDetails[];
  } catch {
    return items;
  }
  const byPost = new Map(rows.map(r => [r.id, r]));
  return items.map(item => {
    if (!('post' in item)) { return item; }
    const row = byPost.get(item.post.postId);
    if (!row) { return item; }
    if (row.spotify_track_id) {
      return { ...item, post: { ...item.post, spotifyTrackId: row.spotify_track_id } };
    }
    const track = row.track;
    if (!track) { return item; }
    const uploader = track.uploader;
    return {
      ...item,
      post: {
        ...item.post,
        title: item.post.title ?? track.title,
        coverArtUrl: item.post.coverArtUrl ?? track.cover_art_url ?? track.thumbnail_url,
        artistName: uploader ? uploader.display_name?.trim() || uploader.username : null,
      },
    };
  });
}

export async function getActivityUnreadCount(): Promise<number> {
  const { data, error } = await db.rpc('activity_unread_count');
  if (error) { throw error; }
  return Number(data ?? 0);
}

export async function markActivityRead(): Promise<void> {
  const { error } = await db.rpc('activity_mark_all_read');
  if (error) { throw error; }
}

export async function markActivityItemRead(id: string): Promise<void> {
  const { error } = await db.rpc('activity_mark_read', { p_id: id });
  if (error) { throw error; }
}

// ── Dispatch helpers ─────────────────────────────────────────────────────────
// Each writes the in-app row via its RPC (the source of truth), then fires an
// OS push fire-and-forget. All routes deep-link to the ActivityCenter screen.

const POST_PUSH_KIND: Record<'like' | 'comment' | 'repost', PushKind> = {
  like: 'activity_like',
  comment: 'activity_comment',
  repost: 'activity_repost',
};

function postPushBody(
  type: 'like' | 'comment' | 'repost',
  name: string,
  aggCount: number,
  commentText?: string | null,
): string {
  switch (type) {
    case 'like':
      return aggCount > 1
        ? `${name} and ${aggCount - 1} other${aggCount - 1 === 1 ? '' : 's'} liked your post`
        : `${name} liked your post`;
    case 'comment': {
      const snippet = commentText?.trim();
      return snippet
        ? `${name} commented on your post: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”`
        : `${name} commented on your post`;
    }
    case 'repost':
      return `${name} reposted your track`;
  }
}

export async function notifyPostActivity(
  postId: string,
  type: 'like' | 'comment' | 'repost',
  opts?: { commentText?: string | null; commentId?: string | null },
): Promise<void> {
  try {
    const { data, error } = await db.rpc('activity_notify_post', {
      p_post_id: postId,
      p_type: type,
      p_comment_text: opts?.commentText ?? null,
      p_comment_id: opts?.commentId ?? null,
    });
    if (error) { throw error; }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { recipient_id: string; agg_count: number; actor_display_name: string | null; recipient_should_push: boolean }
      | undefined;
    if (!row || !row.recipient_should_push) { return; }  // self-action or missing post
    const actorDisplayName = row.actor_display_name ?? 'Someone';
    void sendPush({
      recipientUserId: row.recipient_id,
      kind: POST_PUSH_KIND[type],
      title: 'Livil',
      body: postPushBody(type, actorDisplayName, Number(row.agg_count ?? 1), opts?.commentText),
      data: { route: 'ActivityCenter' },
    });
  } catch (e) {
    console.warn('[activity] notifyPostActivity failed', e);
  }
}

const COMMENT_PUSH_KIND: Record<'comment_like' | 'comment_reply', PushKind> = {
  comment_like: 'activity_comment_like',
  comment_reply: 'activity_comment_reply',
};

/**
 * "Liked your comment" / "replied to your comment" — to the comment's author, on anyone's
 * post. `commentId` is the liked comment, or the reply. Resolves to whether the recipient
 * also owns the post (a reply to the post author's own comment: the caller then skips the
 * post's "commented on your post", so they are told once). Never throws.
 */
export async function notifyCommentActivity(
  commentId: string,
  type: 'comment_like' | 'comment_reply',
): Promise<{ recipientIsPostAuthor: boolean } | null> {
  try {
    const { data, error } = await db.rpc('activity_notify_comment', {
      p_comment_id: commentId,
      p_type: type,
    });
    if (error) { throw error; }
    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          recipient_id: string;
          agg_count: number;
          actor_display_name: string | null;
          recipient_should_push: boolean;
          recipient_is_post_author: boolean;
        }
      | undefined;
    if (!row) { return null; }  // yourself, blocked, or no such like / reply
    if (row.recipient_should_push) {
      // The server writes the real copy from the row it proved (send-push composeContent);
      // these are only what a pre-composeContent server would have shown.
      const name = row.actor_display_name ?? 'Someone';
      void sendPush({
        recipientUserId: row.recipient_id,
        kind: COMMENT_PUSH_KIND[type],
        title: 'Livil',
        body: type === 'comment_like' ? `${name} liked your comment` : `${name} replied to your comment`,
        // Which comment, so the push quotes this one (send-push only matches it, never
        // trusts it). The tap still opens Activity.
        data: type === 'comment_like'
          ? { route: 'ActivityCenter', params: { commentId } }
          : { route: 'ActivityCenter' },
      });
    }
    return { recipientIsPostAuthor: row.recipient_is_post_author === true };
  } catch (e) {
    // Before migration 20261031000000 the function does not exist: no notification, as before.
    console.warn('[activity] notifyCommentActivity failed', e);
    return null;
  }
}

/**
 * Tell the people @-tagged in your post's caption or your comment (20261109000000). The
 * server reads the tags from the STORED text and decides who is told (≤ 5, once each, never
 * across a block, never someone who cannot see the post); this pushes to whoever it returns.
 * Fire-and-forget: before the migration the function is missing, and nothing happens.
 */
export async function notifyMentions(target: { postId: string } | { commentId: string }): Promise<void> {
  try {
    const { data, error } = await db.rpc(
      'activity_notify_mentions',
      'postId' in target ? { p_post_id: target.postId } : { p_comment_id: target.commentId },
    );
    if (error) { throw error; }
    const rows = (Array.isArray(data) ? data : []) as Array<{ recipient_id: string; actor_display_name: string | null }>;
    const where = 'postId' in target ? 'tagged you in a post' : 'mentioned you in a comment';
    for (const row of rows) {
      // The server writes the real copy from the row it proved (send-push composeContent).
      void sendPush({
        recipientUserId: row.recipient_id,
        kind: 'activity_mention',
        title: 'Livil',
        body: `${row.actor_display_name ?? 'Someone'} ${where}`,
        data: { route: 'ActivityCenter' },
      });
    }
  } catch (e) {
    console.warn('[activity] notifyMentions failed', e);
  }
}

export async function notifyNewFan(targetUserId: string): Promise<void> {
  try {
    const { error } = await db.rpc('activity_notify_new_fan', { p_target: targetUserId });
    if (error) { throw error; }
    void sendPush({
      recipientUserId: targetUserId,
      kind: 'new_fan',
      data: { route: 'ActivityCenter' },
    });
  } catch (e) {
    console.warn('[activity] notifyNewFan failed', e);
  }
}

// Writes the friend-outcome row. Pushes only on accept — a rejection is
// surfaced in-app only (no OS push).
export async function notifyFriendOutcome(otherUserId: string, accepted: boolean): Promise<void> {
  try {
    const { error } = await db.rpc('activity_notify_friend_outcome', {
      p_other_user: otherUserId,
      p_accepted: accepted,
    });
    if (error) { throw error; }
    if (accepted) {
      void sendPush({
        recipientUserId: otherUserId,
        kind: 'friend_accepted',
        data: { route: 'ActivityCenter' },
      });
    }
  } catch (e) {
    console.warn('[activity] notifyFriendOutcome failed', e);
  }
}
