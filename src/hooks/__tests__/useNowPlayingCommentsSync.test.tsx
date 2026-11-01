/**
 * The owner's report (2026-11-02): a comment made from the Uploads list left the full-screen
 * player showing 0 comments — only the player's own sheet ever updated its count.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockBump = jest.fn();
let mockNowPlaying: { postId: string; kind: 'upload' | 'repost'; originalPostId: string | null } | null = null;
jest.mock('../../contexts/PlaybackContext', () => ({
  usePlaybackIfAny: () => ({ nowPlaying: mockNowPlaying, bumpCommentsCount: mockBump }),
}));

import { useCommentsCountDeltas } from '../useCommentsCountDeltas';

let hook!: ReturnType<typeof useCommentsCountDeltas>;
function Harness() {
  hook = useCommentsCountDeltas([{ id: 'up1', commentsCount: 0 }]);
  return null;
}

beforeEach(() => { mockBump.mockClear(); mockNowPlaying = null; });

it('a comment on the playing upload, made from a feed card, moves the player count too', () => {
  mockNowPlaying = { postId: 'up1', kind: 'upload', originalPostId: null };
  act(() => { TestRenderer.create(<Harness />); });
  act(() => { hook.applyDelta('up1', +1); });
  expect(mockBump).toHaveBeenCalledWith(1, false);
  expect(hook.withDelta({ id: 'up1', commentsCount: 0 }).commentsCount).toBe(1);
});

it('a comment on the original of the playing repost moves the original count', () => {
  mockNowPlaying = { postId: 'rp1', kind: 'repost', originalPostId: 'up1' };
  act(() => { TestRenderer.create(<Harness />); });
  act(() => { hook.applyDelta('up1', -1); });
  expect(mockBump).toHaveBeenCalledWith(-1, true);
});

it('leaves the player alone for a post that is not playing', () => {
  mockNowPlaying = { postId: 'other', kind: 'upload', originalPostId: null };
  act(() => { TestRenderer.create(<Harness />); });
  act(() => { hook.applyDelta('up1', +1); });
  expect(mockBump).not.toHaveBeenCalled();
});
