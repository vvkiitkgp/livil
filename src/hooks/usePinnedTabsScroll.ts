import { useCallback, useRef, useState } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Profile tabs that stay where you left them.
 *
 * The profile is one FlatList: the header (photo, name, counts) scrolls away and the tab row
 * sticks under the top edge. Switching tab — or list ↔ grid — swaps the whole list for a
 * loading row; the content collapsed to the header's height and the screen jumped back up
 * to the header, or sat at a deep offset in the old tab's place. Scrolled past the header,
 * the switch now keeps the tabs pinned and shows the new content from its first card;
 * not scrolled past it, nothing moves.
 *
 * Two parts, both needed:
 *   • `minContentHeight` — the list is always tall enough for the tab row to reach the top
 *     (header + one screen), so a short or loading tab cannot pull it back down;
 *   • `keepTabsPinned()` — called BEFORE the content changes: it reads where the list is
 *     and, if the tabs were pinned, puts them back at exactly the pinned offset once the
 *     new content has rendered.
 *
 * Wire up: `ref`, `onLayout`, `onScroll` (or `trackScroll` from an existing handler) and
 * `minContentHeight` on the FlatList; `onHeaderLayout` on the header's root view.
 */
export function usePinnedTabsScroll<T>() {
  const listRef = useRef<FlatList<T>>(null);
  const scrollY = useRef(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(Math.round(e.nativeEvent.layout.height));
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(Math.round(e.nativeEvent.layout.height));
  }, []);

  const trackScroll = useCallback((y: number) => { scrollY.current = y; }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const keepTabsPinned = useCallback(() => {
    // A pixel of slack: the pinned offset comes back from layout rounding as e.g. 611.7.
    if (headerHeight <= 0 || scrollY.current < headerHeight - 1) { return; }
    const offset = headerHeight;
    // After the new content's first render, not before: scrolled now, iOS keeps an offset
    // the shrinking content no longer reaches and shows blank until the next touch.
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [headerHeight]);

  const minContentHeight = headerHeight > 0 && viewportHeight > 0
    ? headerHeight + viewportHeight
    : undefined;

  return { listRef, onHeaderLayout, onLayout, onScroll, trackScroll, keepTabsPinned, minContentHeight };
}
