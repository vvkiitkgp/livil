import {
  AVATAR,
  ELBOW_RADIUS,
  flattenThread,
  indentFor,
  INDENT_STEP,
  LINE_WIDTH,
  MAX_INDENT_DEPTH,
  ROW_PAD_LEFT,
  ROW_PAD_TOP,
  threadSegments,
} from '../commentThread';

type N = { id: string; replies: N[] };
const n = (id: string, ...replies: N[]): N => ({ id, replies });
const center = (depth: number) => ROW_PAD_LEFT + indentFor(depth) + AVATAR / 2 - LINE_WIDTH / 2;

describe('flattenThread', () => {
  // Hi
  // ├─ This is insane
  // │   └─ Perfect for Thalaiva!!
  // └─ second reply
  // (gif comment)
  // └─ Soo lost!!
  const tree = [
    n('hi', n('insane', n('thalaiva')), n('second')),
    n('gif', n('lost')),
  ];
  const rows = flattenThread(tree);

  it('keeps display order: each reply right after its parent', () => {
    expect(rows.map(r => r.node.id)).toEqual(['hi', 'insane', 'thalaiva', 'second', 'gif', 'lost']);
  });

  it('knows which lines carry on past each row', () => {
    const by = Object.fromEntries(rows.map(r => [r.node.id, r.position]));
    expect(by.hi).toEqual({ depth: 0, continues: [], hasReplies: true });
    // "insane" is not hi's last reply, so hi's line goes on past it to "second".
    expect(by.insane).toEqual({ depth: 1, continues: [true], hasReplies: true });
    // …and on past "thalaiva" too; thalaiva is insane's only reply.
    expect(by.thalaiva).toEqual({ depth: 2, continues: [true, false], hasReplies: false });
    expect(by.second).toEqual({ depth: 1, continues: [false], hasReplies: false });
    expect(by.lost).toEqual({ depth: 1, continues: [false], hasReplies: false });
  });
});

describe('threadSegments', () => {
  it('a comment with replies starts a line under its own avatar', () => {
    expect(threadSegments({ depth: 0, continues: [], hasReplies: true })).toEqual([
      { kind: 'vertical', left: center(0), top: ROW_PAD_TOP + AVATAR, height: null },
    ]);
  });

  it('a comment without replies draws nothing', () => {
    expect(threadSegments({ depth: 0, continues: [], hasReplies: false })).toEqual([]);
  });

  it('a reply: the parent line curves into its avatar, ending at its left edge', () => {
    const [elbow] = threadSegments({ depth: 1, continues: [false], hasReplies: false });
    expect(elbow).toMatchObject({ kind: 'elbow', left: center(0), top: 0 });
    if (elbow.kind !== 'elbow') { throw new Error('expected an elbow'); }
    expect(elbow.left + elbow.width).toBe(ROW_PAD_LEFT + indentFor(1));
    // The bottom of the curve is level with the avatar's centre.
    expect(elbow.height - LINE_WIDTH / 2).toBe(ROW_PAD_TOP + AVATAR / 2);
    // Wide enough for the rounded corner to be a curve, not a squashed one.
    expect(elbow.width).toBeGreaterThan(ELBOW_RADIUS);
  });

  it('a reply that is not the last: the parent line also runs on through the row', () => {
    const segs = threadSegments({ depth: 1, continues: [true], hasReplies: false });
    expect(segs).toContainEqual({ kind: 'vertical', left: center(0), top: 0, height: null });
  });

  it('a nested reply: ancestors still going carry on, and its own line curves in', () => {
    const segs = threadSegments({ depth: 2, continues: [true, false], hasReplies: false });
    expect(segs).toEqual([
      { kind: 'vertical', left: center(0), top: 0, height: null },
      expect.objectContaining({ kind: 'elbow', left: center(1) }),
    ]);
  });

  it('past the deepest indent a reply sits under its parent and is joined straight down', () => {
    const deep = MAX_INDENT_DEPTH + 1;
    const segs = threadSegments({ depth: deep, continues: Array(deep).fill(false), hasReplies: false });
    // From the row's top down to the top of its avatar, where the parent's line arrives.
    expect(segs).toEqual([{ kind: 'vertical', left: center(deep - 1), top: 0, height: ROW_PAD_TOP }]);
  });

  it('each level moves right by the indent step, then stops', () => {
    expect(indentFor(1)).toBe(INDENT_STEP);
    expect(indentFor(MAX_INDENT_DEPTH + 3)).toBe(MAX_INDENT_DEPTH * INDENT_STEP);
  });
});
