import { chatReceipts, seenLabel, type ReceiptMessage } from '../chatReceipts';

describe('seenLabel', () => {
  const now = Date.parse('2026-11-08T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [ago(20_000), 'Seen just now'],
    [ago(2 * MIN), 'Seen 2m ago'],
    [ago(5 * HOUR), 'Seen 5h ago'],
    [ago(5 * DAY), 'Seen 5d ago'],
    [ago(21 * DAY), 'Seen 3w ago'],
  ])('%s → %s', (iso, label) => {
    expect(seenLabel(iso, now)).toBe(label);
  });

  it('a phone whose clock runs behind never shows a time in the future', () => {
    expect(seenLabel(ago(-5 * MIN), now)).toBe('Seen just now');
  });

  it('no time known, or a broken one: plain "Seen", never "Seen  ago"', () => {
    expect(seenLabel(null, now)).toBe('Seen');
    expect(seenLabel('not a date', now)).toBe('Seen');
  });
});

const ME = 'me';
const at = (min: number) => `2026-11-02T10:${String(min).padStart(2, '0')}:00.000Z`;
const mine = (id: string, min: number, extra: Partial<ReceiptMessage> = {}): ReceiptMessage =>
  ({ id, senderId: ME, kind: 'text', createdAt: at(min), deletedAt: null, ...extra });
const theirs = (id: string, min: number): ReceiptMessage =>
  ({ id, senderId: 'riya', kind: 'text', createdAt: at(min), deletedAt: null });

// I sent five messages, 10:01 … 10:05 (newest first, as the chat holds them).
const FIVE = [mine('m5', 5), mine('m4', 4), mine('m3', 3), mine('m2', 2), mine('m1', 1)];
const labels = (m: Map<string, string>) => Object.fromEntries(m);

describe('chatReceipts', () => {
  it('they read 3 of my 5: "Seen" under the 3rd, "Delivered" under the newest', () => {
    expect(labels(chatReceipts(FIVE, ME, at(3), at(5)))).toEqual({ m3: 'seen', m5: 'delivered' });
  });

  it('only "Seen" when they read everything', () => {
    expect(labels(chatReceipts(FIVE, ME, at(5), at(5)))).toEqual({ m5: 'seen' });
  });

  it('positional "Delivered": reached their phone up to the 4th, the 5th is only "Sent"', () => {
    expect(labels(chatReceipts(FIVE, ME, at(2), at(4)))).toEqual({ m2: 'seen', m4: 'delivered', m5: 'sent' });
  });

  it('nothing delivered past what they read: "Seen", then "Sent" under the newest', () => {
    expect(labels(chatReceipts(FIVE, ME, at(3), at(3)))).toEqual({ m3: 'seen', m5: 'sent' });
  });

  it('without delivery tracking (old app, or not applied yet): today\'s "Delivered" under the newest', () => {
    expect(labels(chatReceipts(FIVE, ME, null, null))).toEqual({ m5: 'delivered' });
    expect(labels(chatReceipts(FIVE, ME, at(3), null))).toEqual({ m3: 'seen', m5: 'delivered' });
  });

  it('"Sending…" under a message still on its way, with the older labels kept', () => {
    const pending = [mine('opt-1', 6), ...FIVE];
    expect(labels(chatReceipts(pending, ME, at(3), at(5)))).toEqual({ m3: 'seen', m5: 'delivered', 'opt-1': 'sending' });
    expect(labels(chatReceipts(pending, ME, null, null))).toEqual({ 'opt-1': 'sending' });
  });

  it('ignores their messages, system lines and my deleted ones', () => {
    const list = [theirs('t1', 9), mine('d1', 8, { deletedAt: at(9) }), mine('s1', 7, { kind: 'system' }), ...FIVE];
    expect(labels(chatReceipts(list, ME, at(5), at(5)))).toEqual({ m5: 'seen' });
  });

  it('nothing for a chat with no message of mine, or before I am known', () => {
    expect(chatReceipts([theirs('t1', 1)], ME, at(1), at(1)).size).toBe(0);
    expect(chatReceipts(FIVE, '', at(1), at(1)).size).toBe(0);
  });
});
