/**
 * One like tally per post, shared by every surface (owner, 2026-10-19).
 *
 * The bug: the full-screen player said 4 (liked) while the profile card still said 3, and
 * the card's heart — believing "not liked" — REMOVED the like when tapped, because the
 * server call was a toggle.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockLikePost = jest.fn(async (_id: string) => undefined);
const mockUnlikePost = jest.fn(async (_id: string) => undefined);
jest.mock('../../services/posts', () => ({
  likePost: (id: string) => mockLikePost(id),
  unlikePost: (id: string) => mockUnlikePost(id),
}));
jest.mock('../../utils/haptics', () => ({ haptics: new Proxy({}, { get: () => jest.fn() }) }));

import { usePostLike } from '../usePostLike';
import { __resetLikeStoreForTest } from '../../utils/likeStore';

type Snapshot = { id: string; viewerHasLiked: boolean; likesCount: number };
type Heart = ReturnType<typeof usePostLike>;

/** One "surface": renders the hook for a snapshot and exposes what it shows. */
function surface(snapshot: Snapshot) {
  const ref: { current: Heart | null } = { current: null };
  function Probe({ post }: { post: Snapshot }) {
    ref.current = usePostLike(post);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<Probe post={snapshot} />); });
  return {
    heart: () => ref.current!,
    rerender: (next: Snapshot) => act(() => { tree.update(<Probe post={next} />); }),
    unmount: () => act(() => { tree.unmount(); }),
  };
}

beforeEach(() => {
  __resetLikeStoreForTest();
  mockLikePost.mockClear();
  mockUnlikePost.mockClear();
});

it('a like in the player shows on the card at once', async () => {
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  await act(async () => { await player.heart().toggleLike(); });
  expect(player.heart()).toMatchObject({ liked: true, likesCount: 4 });
  expect(card.heart()).toMatchObject({ liked: true, likesCount: 4 });
  expect(mockLikePost).toHaveBeenCalledWith('v1');
});

it('a card opening later with an older snapshot does not undo the like', async () => {
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  await act(async () => { await player.heart().toggleLike(); });
  // The profile card loaded its snapshot before the like.
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  expect(card.heart()).toMatchObject({ liked: true, likesCount: 4 });
});

it('the heart sends what it showed: tapping a liked heart unlikes, never a blind toggle', async () => {
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  await act(async () => { await player.heart().toggleLike(); });
  await act(async () => { await card.heart().toggleLike(); });
  expect(mockUnlikePost).toHaveBeenCalledWith('v1');
  expect(card.heart()).toMatchObject({ liked: false, likesCount: 3 });
  expect(player.heart()).toMatchObject({ liked: false, likesCount: 3 });
});

it('a double tap after a like elsewhere keeps the like', async () => {
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  await act(async () => { await player.heart().toggleLike(); });
  await act(async () => { await card.heart().like(); });
  expect(mockLikePost).toHaveBeenCalledTimes(1);
  expect(card.heart()).toMatchObject({ liked: true, likesCount: 4 });
});

it('a refreshed snapshot of the same post updates every surface', () => {
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  card.rerender({ id: 'v1', viewerHasLiked: false, likesCount: 7 }); // pull-to-refresh
  expect(player.heart().likesCount).toBe(7);
});

it('a failed like is put back everywhere', async () => {
  mockLikePost.mockRejectedValueOnce(new Error('offline'));
  const card = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  const player = surface({ id: 'v1', viewerHasLiked: false, likesCount: 3 });
  await act(async () => { await card.heart().toggleLike(); });
  expect(card.heart()).toMatchObject({ liked: false, likesCount: 3 });
  expect(player.heart()).toMatchObject({ liked: false, likesCount: 3 });
});

it('the heart bounces on a like, never on an unlike', async () => {
  const card = surface({ id: 'v1', viewerHasLiked: true, likesCount: 4 });
  await act(async () => { await card.heart().toggleLike(); });
  expect(card.heart().likePulse).toBe(0);
  await act(async () => { await card.heart().toggleLike(); });
  expect(card.heart().likePulse).toBe(1);
});
