/**
 * The thread lines in a comment sheet: from under a comment's avatar, down, and curving
 * into each reply's avatar. The sheet is a flat list of rows, so each row draws its own
 * pieces of the lines that cross it; this works out which pieces, and where.
 */

/** Avatar size and the row's padding, as CommentItem lays them out. */
export const AVATAR = 32;
export const ROW_PAD_TOP = 10;
export const ROW_PAD_LEFT = 16;
/** How far each reply level moves right: room for the line to curve into the avatar. */
export const INDENT_STEP = 24;
/** Deeper replies stop moving right (the line then joins them straight down). */
export const MAX_INDENT_DEPTH = 4;
export const LINE_WIDTH = 1.5;
export const ELBOW_RADIUS = 8;

export function indentFor(depth: number): number {
  return Math.min(depth, MAX_INDENT_DEPTH) * INDENT_STEP;
}

/** The x of the centre of the avatar of a comment at this depth. */
function avatarCenterX(depth: number): number {
  return ROW_PAD_LEFT + indentFor(depth) + AVATAR / 2;
}

/**
 * Where a row sits in its thread.
 *   continues[k] — a line at depth k's avatar centre passes this row on its way to a
 *                  later reply (k < depth). The last entry is this row's own parent's
 *                  line, which goes on when this row is not its parent's last reply.
 *   hasReplies   — a line leaves this row's own avatar, down to its first reply.
 */
export type ThreadPosition = { depth: number; continues: boolean[]; hasReplies: boolean };

/** Same position, compared by value: flattenThread builds new objects on every pass. */
export function sameThreadPosition(a: ThreadPosition, b: ThreadPosition): boolean {
  return a.depth === b.depth
    && a.hasReplies === b.hasReplies
    && a.continues.length === b.continues.length
    && a.continues.every((c, i) => c === b.continues[i]);
}

export type ThreadSegment =
  /** Straight down from `top`, `height` long (null = to the row's bottom edge). */
  | { kind: 'vertical'; left: number; top: number; height: number | null }
  /** From the row's top, down and curving right into this row's avatar. */
  | { kind: 'elbow'; left: number; top: number; width: number; height: number };

export function threadSegments({ depth, continues, hasReplies }: ThreadPosition): ThreadSegment[] {
  const half = LINE_WIDTH / 2;
  const out: ThreadSegment[] = [];
  for (let k = 0; k < depth; k++) {
    if (continues[k]) { out.push({ kind: 'vertical', left: avatarCenterX(k) - half, top: 0, height: null }); }
  }
  if (depth > 0) {
    const from = avatarCenterX(depth - 1) - half;
    const avatarLeft = ROW_PAD_LEFT + indentFor(depth);
    if (avatarLeft - from >= ELBOW_RADIUS) {
      out.push({ kind: 'elbow', left: from, top: 0, width: avatarLeft - from, height: ROW_PAD_TOP + AVATAR / 2 + half });
    } else {
      // Past the deepest indent the reply sits right under its parent: join it straight down.
      out.push({ kind: 'vertical', left: from, top: 0, height: ROW_PAD_TOP });
    }
  }
  if (hasReplies) {
    out.push({ kind: 'vertical', left: avatarCenterX(depth) - half, top: ROW_PAD_TOP + AVATAR, height: null });
  }
  return out;
}

/**
 * Each comment of a tree in display order, with its thread position. Replies follow their
 * parent; `continues` is built from whether each ancestor (and the comment itself) is the
 * last reply of its parent.
 */
export function flattenThread<T extends { replies: T[] }>(
  nodes: T[],
): Array<{ node: T; position: ThreadPosition }> {
  const out: Array<{ node: T; position: ThreadPosition }> = [];
  const walk = (list: T[], depth: number, above: boolean[]) => {
    list.forEach((node, i) => {
      const continues = depth > 0 ? [...above, i < list.length - 1] : [];
      out.push({ node, position: { depth, continues, hasReplies: node.replies.length > 0 } });
      if (node.replies.length > 0) { walk(node.replies, depth + 1, continues); }
    });
  };
  walk(nodes, 0, []);
  return out;
}
