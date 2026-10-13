import { likeCountAfterToggle } from '../likeCount';

describe('likeCountAfterToggle', () => {
  it('adds the viewer on a like', () => {
    expect(likeCountAfterToggle(0, false, true)).toBe(1);
    expect(likeCountAfterToggle(4, false, true)).toBe(5);
  });

  it('removes the viewer on an unlike', () => {
    expect(likeCountAfterToggle(1, true, false)).toBe(0);
    expect(likeCountAfterToggle(5, true, false)).toBe(4);
  });

  // The reported bug: the card believed the viewer's like stood (1 like, theirs), but it had
  // been removed on another screen. The tap therefore LIKED on the server. The old formula
  // gave 1 + 1 = 2; the real count is 1.
  it('does not count the viewer twice when the server answers "liked" to an unlike tap', () => {
    expect(likeCountAfterToggle(1, true, true)).toBe(1);
  });

  it('settles on "not liked" when the server answers that to a like tap', () => {
    expect(likeCountAfterToggle(3, false, false)).toBe(3);
  });

  it('never goes below zero on a stale count', () => {
    expect(likeCountAfterToggle(0, true, false)).toBe(0);
  });
});
