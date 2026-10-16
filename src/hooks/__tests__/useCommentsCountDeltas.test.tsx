/**
 * A feed's comment counts between server fetches. The owner's report (2026-10-16): a
 * repost showed "1 comment" after its only comment was deleted on another phone, and kept
 * showing it through every pull-to-refresh, because the pending +1 was made against a
 * count of 0 and the fresh count was 0 again.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useCommentsCountDeltas } from '../useCommentsCountDeltas';

type Post = { id: string; commentsCount: number };
let hook!: ReturnType<typeof useCommentsCountDeltas>;

function Harness({ posts }: { posts: Post[] }) {
  hook = useCommentsCountDeltas(posts);
  return null;
}

function shown(posts: Post[]): number {
  return hook.withDelta(posts[0]).commentsCount;
}

it('a refresh shows the server count, even when it came back to where it started', () => {
  let posts: Post[] = [{ id: 'jailer', commentsCount: 0 }];
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<Harness posts={posts} />); });

  // Your comment, Dark Knight's arriving live, then yours deleted: one comment left.
  act(() => { hook.applyDelta('jailer', +1); });
  act(() => { hook.applyDelta('jailer', +1); });
  act(() => { hook.applyDelta('jailer', -1); });
  expect(shown(posts)).toBe(1);

  // Dark Knight's is deleted on the other phone; this screen never hears of it. Pull to
  // refresh: the server says 0 — the very count the pending change was made against.
  posts = [{ id: 'jailer', commentsCount: 0 }];
  act(() => { r.update(<Harness posts={posts} />); });
  act(() => { hook.clearDeltas(); });
  expect(shown(posts)).toBe(0);
});

it('without a refresh, a change made here still shows at once', () => {
  const posts: Post[] = [{ id: 'jailer', commentsCount: 2 }];
  act(() => { TestRenderer.create(<Harness posts={posts} />); });
  act(() => { hook.applyDelta('jailer', -1); });
  expect(shown(posts)).toBe(1);
});
