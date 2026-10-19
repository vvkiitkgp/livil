import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { searchGifs, type Gif } from '../services/gifs';

/** Wait this long after the last keystroke before searching: the beta key allows 100 calls an hour. */
const SEARCH_DEBOUNCE_MS = 400;
const COLUMNS = 3;
const GAP = 4;
const TILE_HEIGHT = 96;
/** "More GIFs" stops here: each page is a call, and every tile is an animated image in memory. */
const MAX_PAGES = 5;

type Results =
  | { status: 'loading'; gifs: Gif[]; next: null; pages: 0 }
  | { status: 'ready'; gifs: Gif[]; next: number | null; pages: number }
  | { status: 'failed'; gifs: Gif[]; next: null; pages: 0 };

const LOADING: Results = { status: 'loading', gifs: [], next: null, pages: 0 };
const FAILED: Results = { status: 'failed', gifs: [], next: null, pages: 0 };

/**
 * GIF search, drawn inline under the comment box (ADR-0031). An empty query shows what is
 * trending; typing searches, debounced. A tap hands the GIF to `onPick` — the comment box
 * attaches it, and the comment goes when ✓ is tapped.
 *
 * The rows are a plain View, not a scroll view: this sits inside the comments sheet's own
 * list, so a drag reaches the sheet. Status text and "Powered by GIPHY" (GIPHY's condition
 * for using its API) go at the TOP, where the keyboard never covers them.
 */
export function GifSearchPanel({
  query,
  onPick,
  verb = 'attach',
}: {
  query: string;
  onPick: (gif: Gif) => void;
  /** What a tap does: comments attach the GIF to the comment; chat sends it at once. */
  verb?: 'attach' | 'send';
}) {
  const trimmed = query.trim();
  const [results, setResults] = useState<Results>(LOADING);
  const [loadingMore, setLoadingMore] = useState(false);
  const [width, setWidth] = useState(0);
  // Answers for an older query (typed over, or still in flight) are dropped.
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    setResults(LOADING);
    setLoadingMore(false);
    const t = setTimeout(() => {
      searchGifs(trimmed).then(page => {
        if (request !== requestRef.current) { return; }
        setResults(page ? { status: 'ready', gifs: page.gifs, next: page.next, pages: 1 } : FAILED);
      });
    }, trimmed ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [trimmed]);

  const loadMore = useCallback(() => {
    if (results.status !== 'ready' || results.next === null || loadingMore) { return; }
    const request = requestRef.current;
    const offset = results.next;
    setLoadingMore(true);
    searchGifs(trimmed, offset).then(page => {
      if (request !== requestRef.current) { return; }
      setLoadingMore(false);
      if (!page) { return; }
      setResults(prev => {
        const seen = new Set(prev.gifs.map(g => g.id));
        return {
          status: 'ready',
          gifs: [...prev.gifs, ...page.gifs.filter(g => !seen.has(g.id))],
          next: page.next,
          pages: prev.pages + 1,
        };
      });
    });
  }, [results, loadingMore, trimmed]);

  // Whole dp: a fractional width makes the third tile wrap onto its own row.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(Math.floor(e.nativeEvent.layout.width));
  }, []);
  const tileWidth = width > 0 ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;

  return (
    <View style={styles.panel} testID="gif-search-panel">
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{trimmed ? 'GIFs' : 'Trending'}</Text>
        <Text style={styles.attribution} accessibilityLabel="Powered by GIPHY">
          Powered by <Text style={styles.attributionMark}>GIPHY</Text>
        </Text>
      </View>
      {results.status === 'loading' ? (
        <ActivityIndicator color={COLORS.purpleLight} style={styles.spinner} />
      ) : results.status === 'failed' ? (
        <Text style={styles.hint}>GIFs aren't available right now. Try again in a bit.</Text>
      ) : results.gifs.length === 0 ? (
        <Text style={styles.hint}>{trimmed ? `No GIFs for "${trimmed}".` : 'Nothing trending right now.'}</Text>
      ) : (
        <View style={styles.grid} onLayout={onLayout}>
          {tileWidth > 0
            ? results.gifs.map(gif => (
              <Pressable
                key={gif.id}
                onPress={() => onPick(gif)}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tileWidth, height: TILE_HEIGHT },
                  pressed && styles.tilePressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${verb === 'send' ? 'Send' : 'Attach'} ${gif.title || 'GIF'}`}
                testID="gif-tile"
              >
                <Image source={{ uri: gif.previewUrl }} style={styles.tileImage} resizeMode="cover" />
              </Pressable>
            ))
            : null}
        </View>
      )}
      {results.status === 'ready' && results.next !== null && results.pages < MAX_PAGES ? (
        <View style={styles.footer}>
          <Button
            label="More GIFs"
            variant="secondary"
            size="sm"
            busy={loadingMore}
            onPress={loadMore}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 8, paddingBottom: 8 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 8,
  },
  heading: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 4, paddingVertical: 8 },
  spinner: { paddingVertical: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 6, overflow: 'hidden', backgroundColor: COLORS.card },
  tilePressed: { opacity: 0.7 },
  tileImage: { width: '100%', height: '100%' },
  footer: { alignItems: 'center', paddingTop: 10 },
  attribution: { color: COLORS.textSecondary, fontSize: 11 },
  attributionMark: { color: COLORS.white, fontWeight: '800', letterSpacing: 0.5 },
});
