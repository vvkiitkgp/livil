import { supabase } from '../../lib/supabase';
import { sendPush, type PushKind } from './pushDispatch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  | 'credit_declined';

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
    | { type: 'play_milestone'; post: ActivityPostRef; threshold: number }
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
  };
}

function rowToItem(row: RawActivityRow): ActivityItem {
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
    case 'play_milestone':
      return { ...base, type: 'play_milestone', post: rowToPost(row), threshold: Number(row.payload?.threshold ?? 0) };
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
    case 'play_milestone':
      return { actor: null, text: `Your track hit ${formatPlayThreshold(item.threshold)} plays 🎉` };
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

export async function listActivity(beforeUpdatedAt?: string): Promise<ActivityItem[]> {
  const { data, error } = await db.rpc('activity_list', {
    p_limit: 50,
    p_before: beforeUpdatedAt ?? null,
  });
  if (error) { throw error; }
  return ((data ?? []) as RawActivityRow[]).map(rowToItem);
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
    const actorName = row.actor_display_name ?? 'Someone';
    void sendPush({
      recipientUserId: row.recipient_id,
      kind: POST_PUSH_KIND[type],
      title: 'Livil',
      body: postPushBody(type, actorName, Number(row.agg_count ?? 1), opts?.commentText),
      data: { route: 'ActivityCenter' },
    });
  } catch (e) {
    console.warn('[activity] notifyPostActivity failed', e);
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
