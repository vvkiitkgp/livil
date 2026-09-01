/**
 * A missing native module must cost the Instagram Story path — not the feed.
 *
 * THE DEFECT THIS PINS, observed on a real device: `react-native-share` resolves its
 * native module with `TurboModuleRegistry.getEnforcing('RNShare')`, which THROWS during
 * import when the binary lacks it (an older APK, a failed autolink, a JS reload after
 * adding the dependency). `share.ts` imported it at module scope and `PostCard` imports
 * `share.ts` for `canSharePost` — so the throw propagated out of PostCard and the error
 * boundary replaced the entire home screen.
 *
 * The library is therefore required lazily. These tests hold that line by simulating the
 * module being unavailable, which is the only way to catch a regression here: with the
 * native module PRESENT, a top-level import passes every test and fails only on a device.
 *
 * `react-native-view-shot` deliberately gets the same treatment even though it resolves
 * softly today — the asymmetry between the two is not something the next dependency bump
 * should be trusted to preserve.
 */

jest.mock('react-native-share', () => {
  throw new Error(
    "Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'RNShare' could not be found.",
  );
});

const mockShare = jest.fn(
  async (_content: { message: string }) => ({ action: 'sharedAction' }),
);

/** The message the mocked RN Share was last handed. Typed so the assertions below do
 *  not have to index into a loosely-typed mock.calls tuple. */
function lastSharedMessage(): string {
  const call = mockShare.mock.calls[0];
  if (!call) { throw new Error('Share.share was never called'); }
  return call[0].message;
}
jest.mock('react-native', () => ({
  Share: {
    get share() { return mockShare; },
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../messages', () => ({ sendMessage: jest.fn() }));

const POST = {
  id: '8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e',
  kind: 'upload' as const,
  trackId: 't1',
  title: 'Neon Rain',
  artistName: 'Riya',
  coverArtUrl: 'https://cdn.invalid/cover.jpg',
};

describe('when the RNShare native module is absent from the binary', () => {
  beforeEach(() => mockShare.mockClear());

  it('importing the share service does not throw — this is what killed the feed', () => {
    // The assertion IS the require. PostCard pulls this module in for `canSharePost`,
    // so anything thrown at import time takes the whole screen down with it.
    expect(() => require('../share')).not.toThrow();
  });

  it('still exposes the pure helpers, which need no native module at all', () => {
    const { canSharePost } = require('../share');
    expect(canSharePost({ kind: 'upload' })).toBe(true);
    expect(canSharePost({ kind: 'repost' })).toBe(false);
  });

  it('falls back to the plain link instead of failing the Story share', async () => {
    const { shareStoryCard } = require('../share');
    await expect(shareStoryCard(POST, 'file:///tmp/card.jpg')).resolves.toBe('fellback');
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(lastSharedMessage()).toContain(
      'https://livil-music.com/p/8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e',
    );
  });

  it('falls back to the plain link instead of failing the card-image share', async () => {
    const { shareCardImage } = require('../share');
    await expect(shareCardImage(POST, 'file:///tmp/card.jpg')).resolves.toBe('fellback');
    expect(mockShare).toHaveBeenCalledTimes(1);
  });

  it('leaves the ordinary link share completely unaffected', async () => {
    const { sharePostLink } = require('../share');
    await expect(sharePostLink(POST)).resolves.toBe('shared');
    expect(lastSharedMessage()).toContain('Neon Rain — Riya');
  });
});
