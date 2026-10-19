/**
 * ONE like tally per post for the whole app (owner, 2026-10-19).
 *
 * Every surface used to keep its own copy, taken when it loaded: the feed or profile card
 * (usePostLike) and three separate copies in the full-screen player. None told the others,
 * so a like in the player left the card at its old heart and count — and the card's heart,
 * believing "not liked", REMOVED the like when tapped (the server call was a toggle). Every
 * surface now reads and writes this store (through usePostLike), so a like anywhere shows
 * everywhere at once.
 *
 * Who wins, since every snapshot is a guess taken at some moment:
 *   - seedLike — a surface's FIRST look at a post fills the tally only when nothing is known
 *     yet. Its snapshot may be older than what another surface already knows.
 *   - writeLike — a NEWER answer: the viewer's own like or unlike, or a fresh read of the
 *     same post (a refresh). Everyone showing the post follows.
 *
 * Server writes for one post are queued (queueLikeWrite), so "like" then "unlike" tapped
 * quickly reach the server in that order and it ends where the heart shows.
 */

export type LikeState = { liked: boolean; count: number };

const states = new Map<string, LikeState>();
const listeners = new Map<string, Set<() => void>>();
const queues = new Map<string, Promise<unknown>>();

/** What is known about a post's like, or undefined when no surface has shown it yet. */
export function readLike(postId: string): LikeState | undefined {
  return states.get(postId);
}

/** A surface's first look: fill the tally only if nothing is known. Returns what is known. */
export function seedLike(postId: string, state: LikeState): LikeState {
  const known = states.get(postId);
  if (known) { return known; }
  const seeded = { liked: state.liked, count: Math.max(0, state.count) };
  states.set(postId, seeded);
  return seeded;
}

/** A newer answer — every surface showing the post re-renders with it. */
export function writeLike(postId: string, state: LikeState): void {
  const next = { liked: state.liked, count: Math.max(0, state.count) };
  const known = states.get(postId);
  if (known && known.liked === next.liked && known.count === next.count) { return; }
  states.set(postId, next);
  listeners.get(postId)?.forEach(notify => notify());
}

export function subscribeLike(postId: string, notify: () => void): () => void {
  let set = listeners.get(postId);
  if (!set) {
    set = new Set();
    listeners.set(postId, set);
  }
  set.add(notify);
  return () => {
    const current = listeners.get(postId);
    if (!current) { return; }
    current.delete(notify);
    if (current.size === 0) { listeners.delete(postId); }
  };
}

/** Run `task` after every earlier like write for this post has settled, success or not. */
export function queueLikeWrite<T>(postId: string, task: () => Promise<T>): Promise<T> {
  const before = queues.get(postId) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(task);
  queues.set(postId, run);
  run.then(
    () => { if (queues.get(postId) === run) { queues.delete(postId); } },
    () => { if (queues.get(postId) === run) { queues.delete(postId); } },
  );
  return run;
}

export function __resetLikeStoreForTest(): void {
  states.clear();
  listeners.clear();
  queues.clear();
}
