/**
 * Read receipts in a one-to-one chat: which of MY messages carry "Seen", "Delivered",
 * "Sent" or "Sending…", from the other person's two stamps.
 *
 *   otherReadAt       their conversation_members.last_read_at — how far they have READ.
 *   otherDeliveredAt  their last_delivered_at (20261119000000) — how far their app has
 *                     RECEIVED. Null when it is unknown: they are on an app that never
 *                     stamps it, or the migration is not applied here yet.
 *
 * Positional, like Instagram/WhatsApp, at most one label each:
 *   "Seen"       under my LAST message they have read (my newest with createdAt ≤ readAt) —
 *                not only under my newest, so reading 3 of my 5 shows Seen under the 3rd.
 *   "Delivered"  under my last message that reached their phone, when newer than the Seen one.
 *   "Sent"       under my newest when it is saved but has not reached their phone yet.
 *   "Sending…"   under my newest while it is still on its way to the server (`opt-` id).
 *
 * Without delivery tracking (otherDeliveredAt null) my newest unseen message says
 * "Delivered", which is today's behaviour — never an error, never a "Sent" that would be a
 * guess.
 */

export type ReceiptStatus = 'sending' | 'sent' | 'delivered' | 'seen';

export type ReceiptMessage = {
  id: string;
  senderId: string | null;
  kind: string;
  createdAt: string;
  deletedAt: string | null;
};

const isPending = (m: ReceiptMessage) => m.id.startsWith('opt-');

/** Message id → its label. Messages newest first (the chat's order). */
export function chatReceipts(
  messagesNewestFirst: readonly ReceiptMessage[],
  myId: string,
  otherReadAt: string | null,
  otherDeliveredAt: string | null,
): Map<string, ReceiptStatus> {
  const out = new Map<string, ReceiptStatus>();
  if (!myId) { return out; }
  const mine = messagesNewestFirst.filter(m => m.senderId === myId && m.kind !== 'system' && !m.deletedAt);
  const newest = mine[0];
  if (!newest) { return out; }

  const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const readAt = time(otherReadAt);
  const deliveredAt = time(otherDeliveredAt);

  // Only messages the server has stamped are compared with their stamps.
  const sent = mine.filter(m => !isPending(m));
  const seen = Number.isFinite(readAt)
    ? sent.find(m => Date.parse(m.createdAt) <= readAt) ?? null
    : null;
  if (seen) { out.set(seen.id, 'seen'); }
  if (seen === newest) { return out; }

  const newerThanSeen = (m: ReceiptMessage) => !seen || Date.parse(m.createdAt) > Date.parse(seen.createdAt);

  if (!Number.isFinite(deliveredAt)) {
    // No delivery tracking: today's single label under the newest.
    out.set(newest.id, isPending(newest) ? 'sending' : 'delivered');
    return out;
  }

  const delivered = sent.find(m => Date.parse(m.createdAt) <= deliveredAt && newerThanSeen(m)) ?? null;
  if (delivered) { out.set(delivered.id, 'delivered'); }
  if (delivered !== newest) {
    out.set(newest.id, isPending(newest) ? 'sending' : 'sent');
  }
  return out;
}
