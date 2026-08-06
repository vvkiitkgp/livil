/**
 * Messages from artists to the Livil team.
 *
 * ACCESS IS THE DATABASE'S DECISION, NOT THIS FILE'S — same posture as `waitlist.ts`.
 * `team_messages` has an INSERT policy scoped to `sender_id = auth.uid()` and a SELECT policy
 * gated on `is_ops()` (migration 20260806000000). A non-ops caller running `fetchTeamMessages`
 * gets an empty array rather than an error, because PostgREST filters by policy instead of
 * rejecting. That is why /ops needs no route guard.
 *
 * No service_role anywhere, per ADR-0008 §4. The operator's own session is the credential.
 */
import { supabase } from '../supabase';

/** Mirrors the database CHECK, so the form can say why before the round trip. */
export const MESSAGE_MAX = 4000;

export type TeamMessage = {
  id: string;
  body: string;
  createdAt: string;
  /**
   * Resolved from the join. Null when the sender's profile row has gone — which today can
   * only mean a deleted account, since sender_id is NOT NULL and cascades. Rendering it as
   * "deleted account" is more honest than hiding the message.
   */
  senderName: string | null;
  senderUsername: string | null;
  /**
   * Read from `auth.users` by the ops RPC, not stored on the row. Storing it at insert time
   * would mean trusting an address the sender's browser supplied — RLS constrains which rows
   * may be written, not what a column contains.
   */
  senderEmail: string | null;
};

/**
 * Send a message. `sender_id` is set from the session rather than passed in: the RLS policy
 * would reject any other value, and taking it as a parameter would invite a caller to think
 * it was theirs to choose.
 */
export async function sendTeamMessage(body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Write something first.');
  if (trimmed.length > MESSAGE_MAX) {
    throw new Error(`That is longer than ${MESSAGE_MAX} characters.`);
  }

  const { data: session } = await supabase.auth.getSession();
  const senderId = session.session?.user.id;
  if (!senderId) throw new Error('You need to be signed in to send a message.');

  const { error } = await supabase
    .from('team_messages')
    .insert({ sender_id: senderId, body: trimmed });

  if (error) throw new Error(error.message);
}

/**
 * Everything ever sent, newest first.
 *
 * Unpaginated on purpose, matching `fetchWaitlist`: the ordering index exists and the list is
 * small. Add a range when scrolling it becomes a chore — not before.
 */
export async function fetchTeamMessages(): Promise<TeamMessage[]> {
  // An RPC rather than a table select, because the sender's email lives in `auth.users`,
  // which no client may read. `ops_team_messages` is SECURITY DEFINER and checks `is_ops()`
  // itself — it returns an empty set to anyone else rather than raising, matching how the
  // RLS-gated reads behave and keeping /ops guard-free.
  const { data, error } = await supabase.rpc('ops_team_messages');

  if (error) throw new Error(error.message);

  return (data ?? []).map(row => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    senderName: row.sender_name,
    senderUsername: row.sender_username,
    senderEmail: row.sender_email,
  }));
}
