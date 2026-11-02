import { applyServerDeletes, asDeleted, markDeletedIn, withoutMessage } from '../chatDelete';

type Msg = {
  id: string;
  deletedAt: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  reactions: { emoji: string }[];
};
const msg = (id: string, body: string, extra: Partial<Msg> = {}): Msg =>
  ({ id, deletedAt: null, body, metadata: null, reactions: [], ...extra });
const AT = '2026-11-02T10:00:00.000Z';

// Newest first.
const CHAT = [
  msg('m3', 'my number is 98765 43210', { reactions: [{ emoji: '😮' }] }),
  msg('m2', 'are you free tonight'),
  msg('m1', '🎞 GIF', { metadata: { gif: { id: 'abc' } } }),
];

describe('asDeleted', () => {
  it('keeps who and when, drops the words, the attachment and the reactions', () => {
    expect(asDeleted(CHAT[0]!, AT)).toEqual({ id: 'm3', deletedAt: AT, body: null, metadata: null, reactions: [] });
    expect(asDeleted(CHAT[2]!, AT).metadata).toBeNull();
  });
});

describe('markDeletedIn', () => {
  it('turns one message into the placeholder, in place', () => {
    const next = markDeletedIn(CHAT, 'm3', AT);
    expect(next.map(m => m.id)).toEqual(['m3', 'm2', 'm1']);
    expect(next[0]).toEqual(expect.objectContaining({ body: null, deletedAt: AT }));
    expect(next[1]).toBe(CHAT[1]);
  });

  it('the same list when there is nothing to change', () => {
    expect(markDeletedIn(CHAT, 'nope', AT)).toBe(CHAT);
    const once = markDeletedIn(CHAT, 'm3', AT);
    expect(markDeletedIn(once, 'm3', '2026-11-02T11:00:00.000Z')).toBe(once);
  });
});

describe('withoutMessage', () => {
  it('Delete for me takes the message off the list', () => {
    expect(withoutMessage(CHAT, 'm2').map(m => m.id)).toEqual(['m3', 'm1']);
    expect(withoutMessage(CHAT, 'nope')).toBe(CHAT);
  });
});

describe('applyServerDeletes', () => {
  it('a catch-up that finds a deletion replaces the words on screen', () => {
    const server = [msg('m2', '', { deletedAt: AT, body: null })];
    const next = applyServerDeletes(CHAT, server);
    expect(next[1]).toEqual(expect.objectContaining({ id: 'm2', body: null, deletedAt: AT }));
  });

  it('nothing deleted → the same list', () => {
    expect(applyServerDeletes(CHAT, CHAT)).toBe(CHAT);
  });
});
