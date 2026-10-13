import { addCommentsDelta, withCommentsDelta } from '../commentsDelta';

const post = (commentsCount: number) => ({ id: 'p1', commentsCount });

describe('comment-count deltas', () => {
  it('shows the viewer\'s comment before the server count catches up', () => {
    const pending = addCommentsDelta({}, 'p1', 1, 0);
    expect(withCommentsDelta(post(0), pending.p1).commentsCount).toBe(1);
  });

  // The reported bug: after a pull-to-refresh the server's count already includes the
  // viewer's comment, and the +1 was added again — 1 comment showed as 2.
  it('drops the change once the feed holds a newer count', () => {
    const pending = addCommentsDelta({}, 'p1', 1, 0);
    expect(withCommentsDelta(post(1), pending.p1).commentsCount).toBe(1);
  });

  it('keeps the change when a refresh returned the same count (the comment was not in it yet)', () => {
    const pending = addCommentsDelta({}, 'p1', 1, 3);
    expect(withCommentsDelta(post(3), pending.p1).commentsCount).toBe(4);
  });

  it('accumulates changes made against the same count', () => {
    let pending = addCommentsDelta({}, 'p1', 1, 2);
    pending = addCommentsDelta(pending, 'p1', 1, 2);
    pending = addCommentsDelta(pending, 'p1', -1, 2);
    expect(withCommentsDelta(post(2), pending.p1).commentsCount).toBe(3);
  });

  it('starts over when a change is made against a newer count', () => {
    let pending = addCommentsDelta({}, 'p1', 1, 0);
    pending = addCommentsDelta(pending, 'p1', 1, 1);
    expect(pending.p1).toEqual({ base: 1, delta: 1 });
    expect(withCommentsDelta(post(1), pending.p1).commentsCount).toBe(2);
  });

  it('always applies a change for a post that was not in the feed', () => {
    const pending = addCommentsDelta({}, 'p1', 1, null);
    expect(withCommentsDelta(post(5), pending.p1).commentsCount).toBe(6);
  });

  it('returns the same object when there is nothing to add', () => {
    const p = post(2);
    expect(withCommentsDelta(p, undefined)).toBe(p);
    expect(withCommentsDelta(p, { base: 2, delta: 0 })).toBe(p);
  });

  it('never shows a negative count', () => {
    const pending = addCommentsDelta({}, 'p1', -3, 1);
    expect(withCommentsDelta(post(1), pending.p1).commentsCount).toBe(0);
  });
});
