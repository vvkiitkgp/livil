import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, ScrollView } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { SpotifyLogo } from './SpotifyLogo';
import { isPlayableInLivil, searchPosts, type FeedPost } from '../services/posts';
import { listRecentTracksForLibrary, type LibraryRecentTrack } from '../services/tracks';
import { artistLine, searchSpotify, useSpotifyAvailability, type SpotifyTrack } from '../services/spotify';

/** What the composer sends when a row is tapped. */
export type PickedSong =
  | { kind: 'livil'; post: FeedPost }
  | { kind: 'recent'; postId: string }
  | { kind: 'spotify'; track: SpotifyTrack };

const LIVIL_RESULTS = 6;
const SPOTIFY_RESULTS = 5;
const RECENT_COUNT = 4;
const LIVIL_DEBOUNCE_MS = 250;
/** Slower than Livil: an external call, and our Spotify budget is shared by every user. */
const SPOTIFY_DEBOUNCE_MS = 450;

/**
 * The results panel of the chat composer's song search (ADR-0027). Tap a row and it is sent.
 *
 *   empty box → your 4 most recently played songs
 *   typing    → "On Livil" (uploads) and, when Spotify search is configured, "On Spotify"
 *
 * The two sources are separate sections, never one ranked list — Spotify's design rules
 * forbid seating its content among another service's, and it keeps Livil creators first.
 * Every lookup is fail-safe: a failure empties that section, nothing more.
 */
/**
 * The popover: grows out of the 🎵 button and shrinks back into it.
 *
 * Kept mounted until the closing animation has finished, so "close" is seen rather than
 * the panel simply vanishing — including after a tap sends a song. It floats ABOVE the
 * composer (absolutely positioned) instead of pushing the chat up, so opening it does not
 * jolt the conversation. With Reduce Motion on, it only fades.
 */
export default function ChatSongPicker({
  open,
  query,
  onPick,
  bottom,
  originX,
}: {
  open: boolean;
  query: string;
  onPick: (song: PickedSong) => void;
  /** Height of the composer bar it sits on, in dp (a measured number: RN 0.85 ignores
   *  percentage offsets on absolute views). */
  bottom: number;
  /** Centre of the 🎵 button, measured from the popover's left edge — the grow origin. */
  originX: number;
}) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = reduceMotion
        ? withTiming(1, { duration: 140 })
        // A touch of overshoot is the "pop"; damped enough to settle in ~300ms.
        : withSpring(1, { damping: 15, stiffness: 220, mass: 0.85 });
    } else {
      progress.value = withTiming(
        0,
        { duration: reduceMotion ? 120 : 170, easing: Easing.in(Easing.quad) },
        finished => { if (finished) { runOnJS(setMounted)(false); } },
      );
    }
  }, [open, reduceMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (reduceMotion) {return { opacity: p };}
    return {
      opacity: interpolate(p, [0, 0.35, 1], [0, 1, 1], 'clamp'),
      transform: [{ scale: interpolate(p, [0, 1], [0.15, 1]) }],
    };
  });

  if (!mounted) {return null;}
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[styles.popover, { bottom, transformOrigin: `${originX}px 100%` }, animatedStyle]}
    >
      <ChatSongPickerPanel query={query} onPick={onPick} />
    </Animated.View>
  );
}

/** The 🎵 glyph with a little press bounce each time song search opens or closes. */
export function MusicToggleIcon({ active, color }: { active: boolean; color: string }) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduceMotion) {return;}
    scale.value = withSequence(
      withTiming(0.78, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 9, stiffness: 260 }),
    );
  }, [active, reduceMotion, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Icon name="musicNotes" size={18} color={color} />
    </Animated.View>
  );
}

function ChatSongPickerPanel({
  query,
  onPick,
}: {
  query: string;
  onPick: (song: PickedSong) => void;
}) {
  const { search: spotifyOn } = useSpotifyAvailability();
  const trimmed = query.trim();

  const [recents, setRecents] = useState<LibraryRecentTrack[] | null>(null);
  const [livil, setLivil] = useState<FeedPost[]>([]);
  const [spotify, setSpotify] = useState<SpotifyTrack[]>([]);
  const [livilLoading, setLivilLoading] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  // Recently played — fetched once when the picker opens.
  useEffect(() => {
    let cancelled = false;
    // A few extra, so a deleted post or two still leaves four to show.
    listRecentTracksForLibrary(RECENT_COUNT * 2)
      .then(items => { if (!cancelled) { setRecents(items.filter(i => i.postId).slice(0, RECENT_COUNT)); } })
      .catch(() => { if (!cancelled) { setRecents([]); } });
    return () => { cancelled = true; };
  }, []);

  // Livil uploads.
  //
  // The previous query's rows stay on screen until this query's arrive, then are REPLACED.
  // Emptying them on every keystroke collapsed the bottom-anchored popover to a spinner and
  // regrew it a moment later — a jump per letter typed. `cancelled` still drops a stale
  // response, so an older query can never overwrite a newer one.
  useEffect(() => {
    if (trimmed.length < 2) { setLivil([]); setLivilLoading(false); return; }
    let cancelled = false;
    setLivilLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchPosts(trimmed, { limit: LIVIL_RESULTS }).catch(() => [] as FeedPost[]);
      if (cancelled) {return;}
      setLivil(found.filter(isPlayableInLivil));
      setLivilLoading(false);
    }, LIVIL_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed]);

  // Spotify. Same keep-until-replaced rule.
  useEffect(() => {
    if (!spotifyOn || trimmed.length < 2) { setSpotify([]); setSpotifyLoading(false); return; }
    let cancelled = false;
    setSpotifyLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchSpotify(trimmed, SPOTIFY_RESULTS).catch(() => [] as SpotifyTrack[]);
      if (cancelled) {return;}
      setSpotify(found);
      setSpotifyLoading(false);
    }, SPOTIFY_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed, spotifyOn]);

  const searching = trimmed.length >= 2;
  const loading = livilLoading || spotifyLoading;
  const nothing = searching && !loading && livil.length === 0 && spotify.length === 0;

  return (
    <View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!searching ? (
          <>
            <Text style={styles.heading}>Recently played</Text>
            {recents === null ? (
              <ActivityIndicator color={COLORS.purpleLight} style={styles.spinner} />
            ) : recents.length === 0 ? (
              <Text style={styles.hint}>Songs you play will show up here. Type to search Livil{spotifyOn ? ' and Spotify' : ''}.</Text>
            ) : (
              recents.map(r => (
                <Row
                  key={`recent:${r.trackId}`}
                  art={r.coverArtUrl}
                  title={r.title}
                  subtitle={r.artistLabel}
                  onPress={() => onPick({ kind: 'recent', postId: r.postId! })}
                />
              ))
            )}
          </>
        ) : (
          <>
            {livil.length > 0 ? (
              <>
                <View style={styles.headingRow}>
                  <Text style={[styles.heading, styles.headingInline]}>On Livil</Text>
                  <Refreshing visible={livilLoading} />
                </View>
                {livil.map(post => (
                  <Row
                    key={`livil:${post.id}`}
                    art={post.track.coverArtUrl ?? post.track.thumbnailUrl}
                    title={post.track.title}
                    subtitle={post.author.displayName?.trim() || `@${post.author.username}`}
                    onPress={() => onPick({ kind: 'livil', post })}
                  />
                ))}
              </>
            ) : null}

            {spotify.length > 0 ? (
              <>
                <View style={styles.headingRow}>
                  <Text style={[styles.heading, styles.headingInline]}>On Spotify</Text>
                  <Refreshing visible={spotifyLoading} />
                  <SpotifyLogo size="xs" />
                </View>
                {spotify.map(track => (
                  <Row
                    key={`spotify:${track.id}`}
                    art={track.imageUrl}
                    artRadius={4}
                    title={track.title}
                    subtitle={artistLine(track)}
                    onPress={() => onPick({ kind: 'spotify', track })}
                  />
                ))}
              </>
            ) : null}

            {/* The full-size spinner only while there is nothing yet to show. With rows on
                screen, the refreshing section says so in its heading instead (Refreshing). */}
            {loading && livil.length === 0 && spotify.length === 0 ? (
              <ActivityIndicator color={COLORS.purpleLight} style={styles.spinner} />
            ) : null}
            {nothing ? <Text style={styles.hint}>No songs match "{trimmed}".</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * A small spinner beside a section heading while that section's rows are being replaced
 * for a newer query. Always occupies its slot, so it appearing never moves the heading.
 */
function Refreshing({ visible }: { visible: boolean }) {
  return (
    <View style={styles.refreshing}>
      {visible ? <ActivityIndicator size="small" color={COLORS.purpleLight} /> : null}
    </View>
  );
}

function Row({
  art,
  artRadius = 8,
  title,
  subtitle,
  onPress,
}: {
  art: string | null;
  artRadius?: number;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Send ${title} by ${subtitle}`}
    >
      {art ? (
        <Image source={{ uri: art }} style={[styles.art, { borderRadius: artRadius }]} />
      ) : (
        <View style={[styles.art, styles.artEmpty, { borderRadius: artRadius }]}>
          <Icon name="musicNote" size={18} color={COLORS.textMuted} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Icon name="send" size={16} color={COLORS.purpleNeon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: 'absolute',
    left: 8,
    right: 8,
    maxHeight: 340,
    marginBottom: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  content: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  heading: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  headingInline: { flexShrink: 1, marginRight: 'auto' },
  refreshing: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 6, paddingVertical: 8 },
  spinner: { paddingVertical: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 12,
    minHeight: 56,
  },
  rowPressed: { backgroundColor: COLORS.surface },
  art: { width: 44, height: 44, backgroundColor: COLORS.card },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: COLORS.white, fontSize: 14.5, fontWeight: '600' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5 },
});
