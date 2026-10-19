/**
 * The GIF search under the comment box. Pinned: an answer for a query that has since been
 * typed over never replaces the newer one; a failed search says so instead of "No GIFs";
 * "Powered by GIPHY" is always shown; and "More GIFs" stops after a few pages.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';

jest.mock('../Button', () => {
  const { Pressable: P, Text: T } = require('react-native');
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <P onPress={onPress} testID="button"><T>{label}</T></P>
    ),
  };
});

type Page = { gifs: Array<{ id: string; previewUrl: string; title: string }>; next: number | null } | null;
const mockSearch = jest.fn<Promise<Page>, [string, number?]>();
jest.mock('../../services/gifs', () => ({
  searchGifs: (q: string, offset?: number) => mockSearch(q, offset),
}));

import { GifSearchPanel } from '../GifPicker';

const page = (prefix: string, next: number | null = 18): Page => ({
  gifs: [0, 1, 2].map(i => ({ id: `${prefix}${i}`, previewUrl: `https://media.giphy.com/${prefix}${i}.gif`, title: `${prefix}${i}` })),
  next,
});

function deferred() {
  let resolve!: (p: Page) => void;
  const promise = new Promise<Page>(r => { resolve = r; });
  return { promise, resolve };
}

/** Every string drawn, nested Text flattened. */
function texts(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') { walk((node as { children?: unknown }).children); }
  };
  walk(r.toJSON());
  return out.join('');
}

function credited(r: TestRenderer.ReactTestRenderer): boolean {
  return r.root.findAll(n => n.type === Text && n.props.accessibilityLabel === 'Powered by GIPHY').length > 0;
}

/** The tappable tiles (matched by their tap handler: Pressable renders through a host View). */
function tileNodes(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll(n => n.props.testID === 'gif-tile' && typeof n.props.onPress === 'function');
}

/** Each tile's GIF, by its spoken label ("Attach <title>"). */
function tiles(r: TestRenderer.ReactTestRenderer): string[] {
  return [...new Set(tileNodes(r).map(n => String(n.props.accessibilityLabel).replace('Attach ', '')))];
}

/** The grid lays its tiles out once it knows its width. */
function layOut(r: TestRenderer.ReactTestRenderer) {
  const grid = r.root.findAll(n => n.type === View && typeof n.props.onLayout === 'function')[0];
  act(() => { grid.props.onLayout({ nativeEvent: { layout: { width: 300.6, height: 0, x: 0, y: 0 } } }); });
}

/** Let the (debounce or zero-delay) timer fire and its search settle. */
async function settle(ms = 400) {
  act(() => { jest.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});
afterEach(() => jest.useRealTimers());

function render(query: string, onPick = jest.fn()) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<GifSearchPanel query={query} onPick={onPick} />); });
  return r;
}

it('starts with trending, at once, and credits GIPHY', async () => {
  mockSearch.mockResolvedValueOnce(page('t'));
  const r = render('');
  await settle(0);
  expect(mockSearch).toHaveBeenCalledWith('', undefined);
  expect(texts(r)).toContain('Trending');
  expect(credited(r)).toBe(true);
  layOut(r);
  expect(tiles(r)).toHaveLength(3);
});

it('debounces typing: only the query that was settled on is searched', async () => {
  mockSearch.mockResolvedValue(page('s'));
  const r = render('ha');
  act(() => { r.update(<GifSearchPanel query="hap" onPick={jest.fn()} />); });
  act(() => { r.update(<GifSearchPanel query="happy" onPick={jest.fn()} />); });
  expect(mockSearch).not.toHaveBeenCalled();
  await settle();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith('happy', undefined);
});

it('an answer for a query typed over never replaces the newer one', async () => {
  const slow = deferred();
  const fast = deferred();
  mockSearch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
  const r = render('cat');
  act(() => { jest.advanceTimersByTime(400); });
  act(() => { r.update(<GifSearchPanel query="dog" onPick={jest.fn()} />); });
  act(() => { jest.advanceTimersByTime(400); });
  await act(async () => { fast.resolve(page('dog')); });
  await act(async () => { slow.resolve(page('cat')); });
  layOut(r);
  expect(tiles(r)).toEqual(['dog0', 'dog1', 'dog2']);
});

it('a failed search says GIFs are unavailable, not that nothing matched', async () => {
  mockSearch.mockResolvedValueOnce(null);
  const r = render('happy');
  await settle();
  expect(texts(r)).toContain("GIFs aren't available right now");
  expect(texts(r)).not.toContain('No GIFs');
  expect(credited(r)).toBe(true);
});

it('no results says so, naming the query', async () => {
  mockSearch.mockResolvedValueOnce({ gifs: [], next: null });
  const r = render('zzzz');
  await settle();
  expect(texts(r)).toContain('No GIFs for "zzzz".');
});

it('a tap hands the GIF to the comment box', async () => {
  mockSearch.mockResolvedValueOnce(page('t'));
  const onPick = jest.fn();
  const r = render('', onPick);
  await settle(0);
  layOut(r);
  act(() => { tileNodes(r)[1].props.onPress(); });
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
});

it('"More GIFs" appends the next page, and stops after five pages', async () => {
  let n = 0;
  mockSearch.mockImplementation(async (_q, offset) => page(`p${n++}-`, (offset ?? 0) + 18));
  const r = render('');
  await settle(0);
  for (let i = 1; i < 5; i++) {
    const more = r.root.findAll(x => x.props.testID === 'button' && typeof x.props.onPress === 'function')[0];
    await act(async () => { more.props.onPress(); });
  }
  expect(mockSearch).toHaveBeenLastCalledWith('', 72);
  layOut(r);
  expect(tiles(r)).toHaveLength(15);
  expect(r.root.findAll(x => x.props.testID === 'button')).toHaveLength(0);
});

it('typing keeps the last GIFs on screen until the new ones arrive (no collapse per letter)', async () => {
  const next = deferred();
  mockSearch.mockResolvedValueOnce(page('t')).mockReturnValueOnce(next.promise);
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<GifSearchPanel query="" onPick={() => {}} />); });
  await settle(0);
  layOut(r);
  expect(tiles(r)).toEqual(['t0', 't1', 't2']);

  act(() => { r.update(<GifSearchPanel query="cat" onPick={() => {}} />); });
  await settle();
  // Searching: trending still drawn, never an empty spinner.
  expect(tiles(r)).toEqual(['t0', 't1', 't2']);

  await act(async () => { next.resolve(page('c')); await Promise.resolve(); });
  layOut(r);
  expect(tiles(r)).toEqual(['c0', 'c1', 'c2']);
});

it('a scrolling host (chat) loads the next page on request, with no "More GIFs" button', async () => {
  mockSearch.mockResolvedValueOnce(page('a')).mockResolvedValueOnce(page('b'));
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<GifSearchPanel query="" onPick={() => {}} verb="send" moreRequest={0} />); });
  await settle(0);
  layOut(r);
  expect(texts(r)).not.toContain('More GIFs');
  expect(tileNodes(r)[0]!.props.accessibilityLabel).toBe('Send a0');

  act(() => { r.update(<GifSearchPanel query="" onPick={() => {}} verb="send" moreRequest={1} />); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenLastCalledWith('', 18);
  layOut(r);
  expect(tiles(r).map(t => t.replace('Send ', ''))).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2']);
});
