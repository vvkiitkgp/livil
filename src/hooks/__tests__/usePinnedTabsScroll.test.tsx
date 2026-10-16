/**
 * Switching a profile tab (or list ↔ grid) with the tab row pinned keeps it pinned and
 * starts the new content at its first card; with the header still in view nothing moves.
 * And the list is always tall enough for the row to reach the top, or a short tab would
 * pull it back down.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { usePinnedTabsScroll } from '../usePinnedTabsScroll';

type Api = ReturnType<typeof usePinnedTabsScroll<unknown>>;
let api: Api;
function Probe() {
  api = usePinnedTabsScroll<unknown>();
  return null;
}

const layoutEvent = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }) as never;
const scrollToOffset = jest.fn();

beforeEach(() => {
  scrollToOffset.mockReset();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
  act(() => { TestRenderer.create(<Probe />); });
  act(() => {
    api.onHeaderLayout(layoutEvent(612.4));
    api.onLayout(layoutEvent(700));
  });
  (api.listRef as { current: unknown }).current = { scrollToOffset };
});
afterEach(() => jest.restoreAllMocks());

it('puts a pinned tab row back at exactly the pinned offset', () => {
  api.trackScroll(2400); // deep in the old tab
  act(() => { api.keepTabsPinned(); });
  expect(scrollToOffset).toHaveBeenCalledWith({ offset: 612, animated: false });
});

it('leaves the list alone while the header is still in view', () => {
  api.trackScroll(300);
  act(() => { api.keepTabsPinned(); });
  expect(scrollToOffset).not.toHaveBeenCalled();
});

it('keeps the list one screen taller than the header', () => {
  expect(api.minContentHeight).toBe(612 + 700);
});
