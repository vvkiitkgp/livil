import { supabase } from '../../lib/supabase';
import { resolveAuthorById, type AuthorDisplay } from '../utils/authorDisplay';

const db = supabase as any;

export type ConversationKind = 'dm' | 'group';

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  // DM-only: the other participant
  otherUserId: string | null;
  otherUserUsername: string | null;
  otherUserName: string | null;
  otherUserAvatar: string | null;
  // `list_my_conversations` also returns `other_user_online`, which since
  // 20260925000000 means "listening now" and exists only for builds already on the
  // Play Store. This client reads listening status live via useListeningNow instead,
  // so a cached inbox can never show a stale indicator.
};

export type ConversationDetails = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  createdById: string | null;
  createdBy: AuthorDisplay;
};

type ConversationRow = { id: string; kind: string; name: string | null; created_by: string | null };
type CreatorProfile = { username: string; display_name: string | null };

export function toConversationDetails(
  row: ConversationRow,
  creator: CreatorProfile | null,
): ConversationDetails {
  return {
    id: row.id,
    kind: row.kind as ConversationKind,
    name: row.name,
    createdById: row.created_by,
    createdBy: resolveAuthorById(row.created_by, {
      displayName: creator?.display_name,
      username: creator?.username,
    }),
  };
}

/**
 * `createdBy` has no renderer yet. It is resolved here so whoever adds one inherits
 * the deleted-author handling instead of improvising a sixth version of it.
 */
export async function getConversationDetails(
  conversationId: string,
): Promise<ConversationDetails | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id, kind, name, created_by')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) { return null; }
  const row = data as ConversationRow;

  if (!row.created_by) { return toConversationDetails(row, null); }

  const { data: creator } = await db
    .from('profiles')
    .select('username, display_name')
    .eq('id', row.created_by)
    .maybeSingle();
  return toConversationDetails(row, (creator as CreatorProfile | null) ?? null);
}

/** The chat's kind, for a route that arrived without one (a notification tap). Null on failure. */
export async function getConversationKind(conversationId: string): Promise<ConversationKind | null> {
  const { data, error } = await db
    .from('conversations')
    .select('kind')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) { return null; }
  const { kind } = data as { kind: string };
  return kind === 'dm' || kind === 'group' ? kind : null;
}

/** Set once list_my_conversations_v2 answered "no such function" (20261119010000 not applied). */
let listV2Missing = false;

/**
 * The chat list. list_my_conversations_v2 (20261119010000) is each person's own view: a
 * deleted chat stays out until a new message, a cleared one previews only what came after,
 * and messages deleted for me are not its preview or unread. Until it exists, v1 — same
 * columns, everyone's shared preview.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  let res = listV2Missing ? null : await db.rpc('list_my_conversations_v2');
  if (res && isMissingFunction(res.error)) {
    listV2Missing = true;
    res = null;
  }
  if (!res) { res = await db.rpc('list_my_conversations'); }
  const { data, error } = res;
  if (error) { throw error; }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    kind: row.kind as ConversationKind,
    name: (row.name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    lastMessagePreview: (row.last_message_preview as string | null) ?? null,
    unreadCount: Number(row.unread_count ?? 0),
    otherUserId: (row.other_user_id as string | null) ?? null,
    otherUserUsername: (row.other_user_username as string | null) ?? null,
    otherUserName: (row.other_user_name as string | null) ?? null,
    otherUserAvatar: (row.other_user_avatar as string | null) ?? null,
  }));
}

export async function getOrCreateDm(friendId: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { throw new Error('not_authenticated'); }

  const { data, error } = await db.rpc('get_or_create_dm', {
    user_a: me,
    user_b: friendId,
  });
  if (error) { throw error; }
  return data as string;
}

export async function createGroup(
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await db.rpc('create_group', {
    p_name: name,
    p_member_ids: memberIds,
  });
  if (error) { throw error; }
  return data as string;
}

// For a DM conversation, the other participant's last_read_at and last_delivered_at — the
// stamps the chat compares its outgoing messages against for "Seen" and "Delivered"
// (utils/chatReceipts.ts). lastDeliveredAt is null when unknown: their app never stamps it,
// or the column is not there yet (20261119000000 not applied — then the old select is used,
// so "Seen" keeps working). seenAt is the time for "Seen 2m ago": read_receipt_at, or their
// last read while a chat has none yet (20261120000000). Null overall if there is no other
// member or the call fails.
export async function getOtherMemberReadAt(
  conversationId: string,
): Promise<{ userId: string; lastReadAt: string | null; lastDeliveredAt: string | null; seenAt: string | null } | null> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return null; }

  const read = (columns: string) => db
    .from('conversation_members')
    .select(columns)
    .eq('conversation_id', conversationId)
    .neq('user_id', me)
    .limit(1)
    .maybeSingle();
  let res = await read('user_id, last_read_at, last_delivered_at, read_receipt_at');
  if (res.error) { res = await read('user_id, last_read_at, last_delivered_at'); }
  if (res.error) { res = await read('user_id, last_read_at'); }
  const { data, error } = res;
  if (error || !data) { return null; }
  const row = data as {
    user_id: string;
    last_read_at: string | null;
    last_delivered_at?: string | null;
    read_receipt_at?: string | null;
  };
  return {
    userId: row.user_id,
    lastReadAt: row.last_read_at,
    lastDeliveredAt: row.last_delivered_at ?? null,
    seenAt: row.read_receipt_at ?? row.last_read_at,
  };
}

// ── "Delivered": this app received a chat's messages (20261119000000) ─────────
// Fire-and-forget and never throws. A missing function (migration not applied yet) turns
// delivery stamping off until the next launch, so it is asked once, not on every message.
let deliveredMissing = false;
/** Newest time stamped per chat this session, so an unchanged chat is not stamped again. */
const deliveredUpTo = new Map<string, number>();

export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/** This app has received `conversationId`'s messages up to `upToIso` (the newest one's created_at). */
export async function markConversationDelivered(conversationId: string, upToIso: string | null): Promise<void> {
  if (deliveredMissing || !upToIso) { return; }
  const upTo = Date.parse(upToIso);
  if (!Number.isFinite(upTo) || upTo <= (deliveredUpTo.get(conversationId) ?? -Infinity)) { return; }
  deliveredUpTo.set(conversationId, upTo);
  try {
    const { error } = await db.rpc('mark_conversation_delivered', {
      p_conversation_id: conversationId,
      p_up_to: upToIso,
    });
    if (isMissingFunction(error)) { deliveredMissing = true; }
    else if (error) { deliveredUpTo.delete(conversationId); }
  } catch {
    deliveredUpTo.delete(conversationId);
  }
}

/**
 * The chat list loaded: this app received every chat's newest message (it shows it). Only
 * when a one-to-one chat has something newer than this session already stamped — the stamp
 * is itself an update the chat list listens for. Groups are never stamped (receipts are
 * one-to-one only, and the server skips them too).
 */
export async function markConversationsDelivered(
  conversations: ReadonlyArray<{ id: string; kind?: ConversationKind; lastMessageAt: string | null }>,
): Promise<void> {
  if (deliveredMissing) { return; }
  const fresh = conversations.filter(c => {
    if (c.kind === 'group') { return false; }
    const t = c.lastMessageAt ? Date.parse(c.lastMessageAt) : NaN;
    return Number.isFinite(t) && t > (deliveredUpTo.get(c.id) ?? -Infinity);
  });
  if (fresh.length === 0) { return; }
  for (const c of fresh) { deliveredUpTo.set(c.id, Date.parse(c.lastMessageAt!)); }
  try {
    const { error } = await db.rpc('mark_conversations_delivered');
    if (isMissingFunction(error)) { deliveredMissing = true; }
    else if (error) { for (const c of fresh) { deliveredUpTo.delete(c.id); } }
  } catch {
    for (const c of fresh) { deliveredUpTo.delete(c.id); }
  }
}

/** Test-only. */
export function __resetDeliveredForTest(): void {
  deliveredMissing = false;
  deliveredUpTo.clear();
  listV2Missing = false;
}

export async function markAsRead(conversationId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', me);
}

/**
 * Clear chat: permanently deletes every message in a one-to-one chat, for both people, and
 * leaves one line saying who did it. Throws on failure.
 */
export async function clearChatForBoth(conversationId: string): Promise<void> {
  const { error } = await db.rpc('clear_chat_for_both', { p_conversation_id: conversationId });
  if (error) { throw error; }
}

/**
 * Delete chat: the chat leaves MY list until a new message arrives. No message is touched, and
 * nobody else's chat changes. Throws on failure.
 */
export async function hideConversation(conversationId: string): Promise<void> {
  const { error } = await db.rpc('hide_conversation', { p_conversation_id: conversationId });
  if (error) { throw error; }
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', me);
}

export async function addGroupMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .from('conversation_members')
    .upsert({ conversation_id: conversationId, user_id: userId, role: 'member' });
}

export type GroupMember = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'member';
};

export async function getGroupMembers(conversationId: string): Promise<GroupMember[]> {
  const { data: members, error: membErr } = await db
    .from('conversation_members')
    .select('user_id, role')
    .eq('conversation_id', conversationId);
  if (membErr) { throw membErr; }
  if (!members || members.length === 0) { return []; }

  const ids = (members as { user_id: string; role: string }[]).map(m => m.user_id);
  const { data: profiles, error: profErr } = await db
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  if (profErr) { throw profErr; }

  const profMap = new Map<string, Record<string, unknown>>();
  for (const p of (profiles ?? []) as Record<string, unknown>[]) {
    profMap.set(p.id as string, p);
  }

  return (members as { user_id: string; role: string }[]).map(m => {
    const p = profMap.get(m.user_id) ?? {};
    return {
      userId: m.user_id,
      username: (p.username as string | null) ?? '',
      displayName: (p.display_name as string | null) ?? null,
      avatarUrl: (p.avatar_url as string | null) ?? null,
      role: m.role as 'admin' | 'member',
    };
  });
}

export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
}

export async function updateGroupName(
  conversationId: string,
  name: string,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ name })
    .eq('id', conversationId);
  if (error) { throw error; }
}

/**
 * Stamps the caller's "last active" time for the ops roster. Stored in
 * `user_last_seen`, which no user can read (20260925010000): whether someone has the
 * app open is deliberately never indicated to other users — the chat indicator is
 * "listening now" only.
 */
export async function updatePresenceHeartbeat(): Promise<void> {
  await supabase.rpc('touch_last_seen');
}
