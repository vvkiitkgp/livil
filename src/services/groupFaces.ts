/**
 * Group faces — I/O for the group picture (see src/utils/groupFaces.ts for the layout).
 *
 * `fetchGroupFaces` calls `list_group_faces` (SECURITY INVOKER: members only) and keeps a
 * module-level cache so a revisit paints immediately instead of flashing initials.
 * `subscribeGroupMessages` streams new messages for these groups so the picture can
 * reorder locally — the payload carries `sender_id`, so no refetch is needed unless the
 * sender has no face yet. Never throws: a failure leaves the fallback picture.
 */
import { supabase } from '../../lib/supabase';
import type { GroupFace } from '../utils/groupFaces';

export type { GroupFace } from '../utils/groupFaces';

const cache = new Map<string, GroupFace[]>();

/** Last known faces for a group, if any — for a first paint without a spinner. */
export function cachedGroupFaces(conversationId: string): GroupFace[] | undefined {
  return cache.get(conversationId);
}

export function rememberGroupFaces(conversationId: string, faces: GroupFace[]): void {
  cache.set(conversationId, faces);
}

export async function fetchGroupFaces(conversationIds: string[]): Promise<Map<string, GroupFace[]>> {
  const out = new Map<string, GroupFace[]>();
  if (conversationIds.length === 0) { return out; }
  const { data, error } = await supabase.rpc('list_group_faces', { p_conversation_ids: conversationIds });
  if (error || !data) { return out; }
  // Rows arrive ordered by (conversation, rank), so appending preserves the rank.
  for (const row of data) {
    const list = out.get(row.conversation_id) ?? [];
    list.push({
      userId: row.user_id,
      username: row.username ?? null,
      displayName: row.display_name ?? null,
      avatarUrl: row.avatar_url ?? null,
      lastSentAt: row.last_sent_at ?? null,
    });
    out.set(row.conversation_id, list);
  }
  // A group with no rows back (left it, or it was deleted) must not keep a stale picture.
  for (const id of conversationIds) {
    const faces = out.get(id);
    if (faces) { cache.set(id, faces); } else { cache.delete(id); }
  }
  return out;
}

export type GroupMessageEvent = { conversationId: string; senderId: string; createdAt: string };

/**
 * New messages in these groups. System rows and deleted messages are dropped — they do
 * not count as speaking (same rule as list_group_faces). Returns the unsubscribe.
 */
export function subscribeGroupMessages(
  conversationIds: string[],
  onMessage: (e: GroupMessageEvent) => void,
): () => void {
  if (conversationIds.length === 0) { return () => {}; }
  const channel = supabase
    .channel(`group-faces:${Math.random().toString(36).slice(2, 10)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=in.(${conversationIds.join(',')})`,
      },
      (payload: { new?: Record<string, unknown> }) => {
        const row = payload.new;
        if (!row || row.kind === 'system' || row.deleted_at) { return; }
        if (typeof row.conversation_id !== 'string' || typeof row.sender_id !== 'string') { return; }
        onMessage({
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        });
      },
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
