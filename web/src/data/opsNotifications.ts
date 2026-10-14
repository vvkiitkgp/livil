/**
 * Mood nudges + repost digests for /studio/ops (migration 20261025000000).
 *
 * The wording lives in `push_messages` and each time slot's switch in `push_slots`, both
 * ops-only by RLS (`is_ops()`), so editing a line or pausing a slot here is the whole
 * change: the next scheduled send uses it, with no deploy and no app release.
 *
 * The numbers come from two ops-only SECURITY DEFINER readers that return nothing for
 * anyone else, like the rest of /studio/ops. "Opened" is a tap, reported only by app builds
 * that know the push's `pushId`; "came back" is "had Livil open within an hour", which every
 * build reports.
 */
import { supabase } from '../supabase';

export type PushPool = 'mood_morning' | 'mood_evening' | 'digest';
export type PushSlotKey = 'mood_morning' | 'digest_morning' | 'digest_evening' | 'mood_evening';

export const POOLS: { key: PushPool; label: string; hint: string }[] = [
  { key: 'mood_morning', label: 'Morning mood · 8 AM', hint: 'Skipped for anyone who already posted today.' },
  { key: 'mood_evening', label: 'Evening mood · 8 PM', hint: 'Skipped for anyone who already posted today.' },
  {
    key: 'digest',
    label: 'Repost digest · 11 AM + 6 PM',
    hint: 'Sent only when there are new reposts the person can see and has not already seen in their feed. Names only their friends and people they star; everyone else is counted.',
  },
];

/** The fill-ins a digest line may use, and what they become. */
export const DIGEST_FILL_INS: { token: string; example: string }[] = [
  { token: '{names}', example: 'Arjun, Kavya and 10 others' },
  { token: '{songs}', example: '18 songs' },
  { token: '{since}', example: 'since last night' },
];

/** Same limits as the table's CHECK constraints, so the form says no before the database does. */
export const TITLE_MAX = 80;
export const BODY_MAX = 200;

export type PushSlot = {
  slot: PushSlotKey;
  pool: PushPool;
  sendAtIst: string;
  enabled: boolean;
};

export type PushMessage = {
  id: string;
  pool: PushPool;
  position: number;
  title: string;
  body: string;
  active: boolean;
  updatedAt: string;
  sends: number;
  delivered: number;
  opened: number;
  cameBack: number;
};

export type PushSend = {
  id: string;
  slot: PushSlotKey | 'test';
  kind: 'mood_nudge' | 'repost_digest';
  createdAt: string;
  position: number | null;
  exampleTitle: string | null;
  exampleBody: string | null;
  recipients: number;
  delivered: number;
  opened: number;
  cameBack: number;
};

export async function fetchSlots(): Promise<PushSlot[]> {
  const { data, error } = await supabase
    .from('push_slots')
    .select('slot, pool, send_at_ist, enabled')
    .order('send_at_ist');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    slot: r.slot as PushSlotKey,
    pool: r.pool as PushPool,
    sendAtIst: r.send_at_ist,
    enabled: r.enabled,
  }));
}

export async function setSlotEnabled(slot: PushSlotKey, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('push_slots').update({ enabled }).eq('slot', slot);
  if (error) throw new Error(error.message);
}

export async function fetchMessages(days: number): Promise<PushMessage[]> {
  const { data, error } = await supabase.rpc('ops_push_message_stats', { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.message_id,
    pool: r.pool as PushPool,
    position: r.position,
    title: r.title,
    body: r.body,
    active: r.active,
    updatedAt: r.updated_at,
    sends: Number(r.sends) || 0,
    delivered: Number(r.delivered) || 0,
    opened: Number(r.opened) || 0,
    cameBack: Number(r.came_back) || 0,
  }));
}

export async function fetchRecentSends(limit: number): Promise<PushSend[]> {
  const { data, error } = await supabase.rpc('ops_push_recent_sends', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.send_id,
    slot: r.slot as PushSend['slot'],
    kind: r.kind as PushSend['kind'],
    createdAt: r.created_at,
    position: r.position,
    exampleTitle: r.example_title,
    exampleBody: r.example_body,
    recipients: Number(r.recipients) || 0,
    delivered: Number(r.delivered) || 0,
    opened: Number(r.opened) || 0,
    cameBack: Number(r.came_back) || 0,
  }));
}

/** Edit an existing line. Its pool never changes (the table refuses to move it). */
export async function updateMessage(id: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.from('push_messages').update({ title, body }).eq('id', id);
  if (error) throw new Error(friendly(error.message));
}

/** Add a line at the end of a pool's rotation. */
export async function addMessage(pool: PushPool, position: number, title: string, body: string): Promise<void> {
  const { error } = await supabase.from('push_messages').insert({ pool, position, title, body });
  if (error) throw new Error(friendly(error.message));
}

export async function setMessageActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('push_messages').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Send one line to the operator's own phone now. False when this account has no phone
 * registered — the database answers null rather than an error, like the other ops calls.
 */
export async function sendTestToMe(messageId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('ops_push_test', { p_message_id: messageId });
  if (error) throw new Error(error.message);
  return data !== null;
}

/** "{names}" as the person who gets it would read it, for the editor's preview. */
export function previewText(pool: PushPool, text: string): string {
  if (pool !== 'digest') return text;
  return DIGEST_FILL_INS.reduce((t, f) => t.split(f.token).join(f.example), text);
}

/** A typo'd fill-in, or braces in a mood line, would reach phones verbatim — say so here. */
export function fillInProblem(pool: PushPool, text: string): string | null {
  if (pool !== 'digest') return /[{}]/.test(text) ? 'Mood lines cannot use { } fill-ins.' : null;
  const leftover = text.replace(/\{(names|songs|since)\}/g, '');
  return /[{}]/.test(leftover) ? 'Only {names}, {songs} and {since} can be filled in.' : null;
}

function friendly(message: string): string {
  if (message.includes('push_messages_fill_ins')) return 'Only {names}, {songs} and {since} can be filled in (none in mood lines).';
  if (message.includes('push_messages_pool_position_key')) return 'Another line already has that place in the rotation. Reload and try again.';
  if (message.includes('char_length')) return `Keep the bold line under ${TITLE_MAX} characters and the text under ${BODY_MAX}.`;
  return message;
}
