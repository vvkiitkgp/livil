/**
 * The number on a repost's cover: the upload's likes, live, and never a guess written into the
 * shared tally (that would put the wrong heart on the upload itself).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useOriginalLikes } from '../useOriginalLikes';
import { __resetLikeStoreForTest, readLike, writeLike } from '../../utils/likeStore';

let shown = -1;
function Probe({ id, fetched }: { id: string | null; fetched?: number }) {
  shown = useOriginalLikes(id, fetched);
  return null;
}

function render(id: string | null, fetched?: number) {
  act(() => { TestRenderer.create(<Probe id={id} fetched={fetched} />); });
}

beforeEach(() => {
  __resetLikeStoreForTest();
  shown = -1;
});

it('shows what the load read while no surface knows the upload, and seeds nothing', () => {
  render('upload-1', 5);
  expect(shown).toBe(5);
  expect(readLike('upload-1')).toBeUndefined();
});

it('follows a like on the upload made anywhere else', () => {
  render('upload-1', 5);
  act(() => { writeLike('upload-1', { liked: true, count: 6 }); });
  expect(shown).toBe(6);
});

it('ignores likes on the repost itself', () => {
  render('upload-1', 5);
  act(() => { writeLike('repost-1', { liked: true, count: 4 }); });
  expect(shown).toBe(5);
});

it('is 0, so no chip, for an upload, a removed original, or an unknown count', () => {
  render(null);
  expect(shown).toBe(0);
  render('upload-1');
  expect(shown).toBe(0);
});
