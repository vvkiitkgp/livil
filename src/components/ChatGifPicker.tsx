import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ChatPopover } from './ChatSongPicker';
import { GifSearchPanel } from './GifPicker';
import type { Gif } from '../services/gifs';

/**
 * GIF search in the chat composer: the same popover as song search (grows out of its
 * button, floats above the composer), holding the comments' GIF grid. The composer box is
 * the search; an empty box shows what is trending. A tap sends the GIF at once, as a tap on
 * a song does.
 *
 * Scrollable, unlike in comments (where the sheet's own list scrolls it); taps land on the
 * FIRST touch while the keyboard is up (keyboardShouldPersistTaps), a scroll never puts the
 * keyboard away, and the next page loads by itself near the bottom (no "More GIFs" button).
 */
export default function ChatGifPicker({
  open,
  query,
  onPick,
  bottom,
  originX,
}: {
  open: boolean;
  query: string;
  onPick: (gif: Gif) => void;
  /** Height of the composer bar it sits on, in dp. */
  bottom: number;
  /** Centre of the GIF button, from the popover's left edge — the grow origin. */
  originX: number;
}) {
  // Near the bottom → ask the panel for the next page. The panel decides whether one is due
  // (not already loading, more exist, under the page cap). This used to skip a request at a
  // content height already asked at — and a fresh grid of 18 GIFs (reopened, or a new search)
  // has exactly that height, so after the first time nothing ever loaded again.
  const [moreRequest, setMoreRequest] = useState(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_END_PX) {
      setMoreRequest(n => n + 1);
    }
  }, []);

  return (
    <ChatPopover open={open} bottom={bottom} originX={originX}>
      {/* Scrolling GIFs keeps the keyboard up: the box is the search, and the next thing a
          person does is often type more (owner, 2026-10-19). Song search behaves the same. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        onScroll={onScroll}
        scrollEventThrottle={100}
        contentContainerStyle={styles.content}
      >
        <GifSearchPanel query={query} onPick={onPick} verb="send" moreRequest={moreRequest} />
      </ScrollView>
    </ChatPopover>
  );
}

/** How close to the bottom (dp) the next page starts loading. */
const NEAR_END_PX = 240;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 4, paddingTop: 2 },
});
