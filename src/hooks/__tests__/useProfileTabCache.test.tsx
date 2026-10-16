/**
 * Profile tabs load once and are shown again from memory; only a pull to refresh forgets
 * them. Pinned because each failure is quiet: remembering a half-loaded or failed tab
 * shows it empty for the rest of the visit, and a slow load from before a switch must
 * never land in (and be remembered as) the tab switched to.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProfileTabCache, type TabSnapshot } from '../useProfileTabCache';
import type { ProfileTab } from '../../components/ProfileTabBar';
import type { FeedPost } from '../../services/posts';

let api: ReturnType<typeof useProfileTabCache>;
function Probe({ tab, snap, settled }: { tab: ProfileTab; snap: TabSnapshot; settled: boolean }) {
  api = useProfileTabCache(tab, snap, settled);
  return null;
}

const posts = (...ids: string[]) => ids.map(id => ({ id }) as unknown as FeedPost);
const snap = (ids: string[], endReached = false): TabSnapshot =>
  ({ posts: posts(...ids), albums: [], playlists: [], endReached });

let tree: TestRenderer.ReactTestRenderer;
function show(tab: ProfileTab, s: TabSnapshot, settled: boolean) {
  act(() => {
    if (tree) { tree.update(<Probe tab={tab} snap={s} settled={settled} />); }
    else { tree = TestRenderer.create(<Probe tab={tab} snap={s} settled={settled} />); }
  });
}

beforeEach(() => { tree = undefined as unknown as TestRenderer.ReactTestRenderer; });

it('remembers a tab once it has loaded, with the pages scrolled in', () => {
  show('reposts', snap(['r1', 'r2']), true);
  show('reposts', snap(['r1', 'r2', 'r3'], true), true); // the next page arrived
  expect(api.remembered('reposts')?.posts.map(p => p.id)).toEqual(['r1', 'r2', 'r3']);
  expect(api.remembered('reposts')?.endReached).toBe(true);
  expect(api.remembered('uploads')).toBeUndefined();
});

it('does not remember a tab while it loads, or after its load failed', () => {
  show('uploads', snap([]), false); // loading
  expect(api.remembered('uploads')).toBeUndefined();
  show('uploads', snap([]), false); // failed: not settled either
  expect(api.remembered('uploads')).toBeUndefined();
});

it('forgets every tab on a pull to refresh', () => {
  show('reposts', snap(['r1']), true);
  act(() => { api.clear(); });
  expect(api.remembered('reposts')).toBeUndefined();
});

it('lets only the newest switch or refresh apply what it loaded', () => {
  show('reposts', snap([]), false);
  const slowReposts = api.beginLoad();
  const page = api.current(); // a next-page load started on Reposts
  const switchToUploads = api.beginLoad();
  expect(slowReposts()).toBe(false);
  expect(page()).toBe(false);
  expect(switchToUploads()).toBe(true);
});
