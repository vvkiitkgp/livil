import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
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
 * FIRST touch while the keyboard is up (keyboardShouldPersistTaps), and a scroll never puts
 * the keyboard away.
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
  return (
    <ChatPopover open={open} bottom={bottom} originX={originX}>
      {/* Scrolling GIFs keeps the keyboard up: the box is the search, and the next thing a
          person does is often type more (owner, 2026-10-19). Song search behaves the same. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        contentContainerStyle={styles.content}
      >
        <GifSearchPanel query={query} onPick={onPick} verb="send" />
      </ScrollView>
    </ChatPopover>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 4, paddingTop: 2 },
});
