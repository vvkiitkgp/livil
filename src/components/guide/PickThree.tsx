import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardController,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import FormInput from '../FormInput';
import { GradientBorder } from '../GradientBorder';
import { Icon } from '../Icon';
import RoundTickButton, { ROUND_TICK_SIZE } from '../RoundTickButton';
import CoverFallback from '../CoverFallback';
import { SpotifyLogo } from '../SpotifyLogo';
import { SPOTIFY_GREEN } from '../spotifyLogoArtwork';
import { listNewestUploads, searchPosts } from '../../services/posts';
import { searchSpotify, useSpotifyAvailability } from '../../services/spotify';
import { haptics } from '../../utils/haptics';
import { PICK_DONE } from './cards';
import { PICK_COUNT, pickFromPost, pickFromSpotify, uniquePicks, type GuidePick } from './pickSongs';

const SUGGESTIONS = 12;
const LIVIL_RESULTS = 8;
const SPOTIFY_RESULTS = 6;
const LIVIL_DEBOUNCE_MS = 250;
/** Slower than Livil: an external call, and our Spotify budget is shared by every user. */
const SPOTIFY_DEBOUNCE_MS = 450;
/** Long enough for the keyboard to be up, so our scroll lands after keyboard-controller's own. */
const KEYBOARD_SETTLE_MS = 350;

/**
 * The "Your 3 favourites" step of the first-run guide: three slots, a search box, and
 * results to tick. The guide screen owns the picks (usePickThree) and the button.
 *
 *   empty box → the newest uploads on Livil, so nobody is stuck if search finds nothing
 *   typing    → "On Livil" and, while Spotify reposts are on, "On Spotify" — two sections,
 *               never one ranked list (Spotify's rules; it also keeps Livil artists first)
 *
 * Focusing the box scrolls it to the top so the results get the space above the keyboard;
 * the third pick puts the keyboard away and scrolls back up to the filled slots and the
 * button.
 */
export function PickThree({
  headline,
  line,
  picks,
  posted,
  onToggle,
}: {
  headline: string;
  line: string;
  picks: GuidePick[];
  posted: ReadonlySet<string>;
  onToggle: (pick: GuidePick) => 'added' | 'removed' | 'full' | 'locked';
}) {
  const { search: spotifySearch, reposts: spotifyReposts } = useSpotifyAvailability();
  const spotifyOn = spotifySearch && spotifyReposts;
  const { width, height } = useWindowDimensions();
  // Three slots across the guide's content width (28dp padding each side, 12dp gaps),
  // smaller on a short phone so the search box stays clear of the keyboard.
  const slot = Math.floor(Math.min(height < 700 ? 76 : 104, (width - 56 - 24) / 3));

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;
  // null = loading; 'failed' = offer a retry — this step is required, so a failed load
  // must never leave an empty screen with no way forward.
  const [suggested, setSuggested] = useState<GuidePick[] | 'failed' | null>(null);
  const [suggestTry, setSuggestTry] = useState(0);
  const [livil, setLivil] = useState<GuidePick[]>([]);
  const [spotify, setSpotify] = useState<GuidePick[]>([]);
  const [livilLoading, setLivilLoading] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSuggested(null);
    listNewestUploads(SUGGESTIONS)
      .then(posts => { if (!cancelled) { setSuggested(uniquePicks(posts.map(pickFromPost))); } })
      .catch(() => { if (!cancelled) { setSuggested('failed'); } });
    return () => { cancelled = true; };
  }, [suggestTry]);

  // A previous query's rows stay until this query's arrive — emptying them per keystroke
  // makes the list jump. `cancelled` drops a stale response.
  useEffect(() => {
    if (!searching) { setLivil([]); setLivilLoading(false); return; }
    let cancelled = false;
    setLivilLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchPosts(trimmed, { limit: LIVIL_RESULTS }).catch(() => []);
      if (cancelled) {return;}
      setLivil(uniquePicks(found.map(pickFromPost)));
      setLivilLoading(false);
    }, LIVIL_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed, searching]);

  useEffect(() => {
    if (!spotifyOn || !searching) { setSpotify([]); setSpotifyLoading(false); return; }
    let cancelled = false;
    setSpotifyLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchSpotify(trimmed, SPOTIFY_RESULTS).catch(() => []);
      if (cancelled) {return;}
      setSpotify(uniquePicks(found.map(pickFromSpotify)));
      setSpotifyLoading(false);
    }, SPOTIFY_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed, searching, spotifyOn]);

  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const inputRef = useRef<TextInput>(null);
  const searchY = useRef(0);
  const [frameH, setFrameH] = useState(0);
  const [searchTop, setSearchTop] = useState(0);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimer.current) {clearTimeout(focusTimer.current);} }, []);

  const raiseSearch = useCallback(() => {
    if (focusTimer.current) {clearTimeout(focusTimer.current);}
    focusTimer.current = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, searchY.current - 8), animated: true });
    }, KEYBOARD_SETTLE_MS);
  }, []);

  const pickedKeys = new Set(picks.map(p => p.key));
  const tap = useCallback((pick: GuidePick) => {
    const result = onToggle(pick);
    if (result === 'added') {
      haptics.toggleOn();
      if (picks.length + 1 === PICK_COUNT) {
        void KeyboardController.dismiss();
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      } else if (query.length > 0 && inputRef.current?.isFocused()) {
        // Select the search so the next song is one backspace away (the owner's ask):
        // the keyboard's delete clears it, or typing replaces it.
        inputRef.current.setSelection(0, query.length);
      }
    } else if (result === 'removed') {
      haptics.select();
    } else if (result === 'full') {
      haptics.warning();
    }
  }, [onToggle, picks.length, query.length]);

  const rows = (list: GuidePick[]) => list.map(p => (
    <ResultRow key={p.key} pick={p} picked={pickedKeys.has(p.key)} onPress={tap} />
  ));
  const loading = livilLoading || spotifyLoading;
  const nothing = searching && !loading && livil.length === 0 && spotify.length === 0;

  return (
    <KeyboardAwareScrollView
      ref={scrollRef}
      style={styles.fill}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      onLayout={e => setFrameH(e.nativeEvent.layout.height)}
      // Tall enough that the search box can always scroll to the top, even before any
      // results have arrived.
      contentContainerStyle={[styles.content, { minHeight: frameH + searchTop }]}
    >
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.line}>{line}</Text>

      <View style={styles.slots}>
        {Array.from({ length: PICK_COUNT }, (_, i) => (
          <Slot
            key={picks[i]?.key ?? `empty:${i}`}
            index={i}
            size={slot}
            pick={picks[i] ?? null}
            locked={picks[i] ? posted.has(picks[i]!.key) : false}
            onRemove={tap}
          />
        ))}
      </View>

      <View
        style={styles.searchWrap}
        onLayout={e => {
          searchY.current = e.nativeEvent.layout.y;
          setSearchTop(e.nativeEvent.layout.y);
        }}
      >
        <FormInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={raiseSearch}
          placeholder={spotifyOn ? 'Search Livil and Spotify' : 'Search Livil'}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => { void KeyboardController.dismiss(); }}
          accessibilityLabel="Search songs"
          // Livil's text box, as on Upload's "+ Something else" and the comment box: the
          // round ✓ on the right. Here it puts the keyboard away to show the results.
          trailing={
            <RoundTickButton
              enabled={trimmed.length > 0}
              onPress={() => { void KeyboardController.dismiss(); }}
              accessibilityLabel="Done searching"
            />
          }
        />
      </View>

      {!searching ? (
        <>
          <View style={styles.headingRow}><Text style={styles.heading}>INDIE VIBES</Text></View>
          {suggested === null ? (
            <ActivityIndicator color={COLORS.purpleLight} style={styles.spinner} />
          ) : suggested === 'failed' ? (
            <Pressable onPress={() => setSuggestTry(n => n + 1)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.hint}>Couldn't load songs. Tap to retry.</Text>
            </Pressable>
          ) : rows(suggested)}
        </>
      ) : (
        <>
          {/* Status text sits at the top, right under the box — never behind the keyboard. */}
          {nothing ? <Text style={styles.hint}>No songs match "{trimmed}".</Text> : null}
          {loading && livil.length === 0 && spotify.length === 0 ? (
            <ActivityIndicator color={COLORS.purpleLight} style={styles.spinner} />
          ) : null}
          {livil.length > 0 ? (
            <>
              <View style={styles.headingRow}><Text style={styles.heading}>ON LIVIL</Text></View>
              {rows(livil)}
            </>
          ) : null}
          {spotify.length > 0 ? (
            <>
              <View style={styles.headingRow}>
                <Text style={styles.heading}>ON SPOTIFY</Text>
                <SpotifyLogo size="xs" style={styles.headingLogo} />
              </View>
              {rows(spotify)}
            </>
          ) : null}
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

/** Square art with Livil's or Spotify's corner rule — Spotify's art is never drawn on. */
function Art({ pick, size }: { pick: GuidePick; size: number }) {
  const radius = pick.kind === 'spotify' ? 4 : size > 60 ? 14 : 8;
  return (
    <View style={[styles.art, { width: size, height: size, borderRadius: radius }]}>
      {pick.art ? (
        <Image source={{ uri: pick.art }} style={styles.artImage} resizeMode="cover" />
      ) : pick.kind === 'livil' ? (
        <CoverFallback />
      ) : null}
    </View>
  );
}

/**
 * One of the three slots, styled after the profile grid card (PostGridCard). The remove
 * button sits beside the title rather than on the art, because nothing may be drawn on
 * Spotify artwork.
 */
function Slot({
  index,
  size,
  pick,
  locked,
  onRemove,
}: {
  index: number;
  size: number;
  pick: GuidePick | null;
  locked: boolean;
  onRemove: (pick: GuidePick) => void;
}) {
  if (!pick) {
    return (
      <View style={{ width: size }}>
        <View style={[styles.slotEmpty, { width: size, height: size }]}>
          <Text style={styles.slotNumber}>{index + 1}</Text>
        </View>
        <Text style={styles.slotEmptyLabel}>Song {index + 1}</Text>
      </View>
    );
  }
  return (
    <View style={{ width: size }}>
      <Art pick={pick} size={size} />
      <View style={styles.slotTitleRow}>
        <Text style={styles.slotTitle} numberOfLines={1}>{pick.title}</Text>
        {locked ? null : (
          <Pressable
            onPress={() => onRemove(pick)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${pick.title}`}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name="close" size={13} color={COLORS.textSecondary} />
          </Pressable>
        )}
      </View>
      <View style={styles.slotSubRow}>
        {pick.kind === 'spotify' ? <View style={styles.spotifyDot} /> : null}
        <Text style={styles.slotSub} numberOfLines={1}>{pick.artist}</Text>
      </View>
    </View>
  );
}

function ResultRow({ pick, picked, onPress }: { pick: GuidePick; picked: boolean; onPress: (pick: GuidePick) => void }) {
  return (
    <Pressable
      onPress={() => onPress(pick)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={`${pick.title} by ${pick.artist}`}
    >
      <Art pick={pick} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{pick.title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{pick.artist}</Text>
      </View>
      {/* Livil's button language, like RoundTickButton: + is a plain ring, ✓ wears the
          purple glow. collapsable={false} for the same reason as there — a flattened View
          that regains its border is drawn square on Android. */}
      <View collapsable={false} style={[styles.mark, !picked && styles.markOff]}>
        {picked ? <GradientBorder borderRadius={ROUND_TICK_SIZE / 2} /> : null}
        <Icon name={picked ? 'check' : 'add'} size={16} color={picked ? COLORS.purpleNeon : COLORS.white} weight="bold" />
      </View>
    </Pressable>
  );
}

/** The step once the three are reposted. */
export function PickDone({ picks }: { picks: GuidePick[] }) {
  return (
    <View style={styles.done}>
      <View style={styles.doneBadge}>
        <Icon name="check" size={44} color={COLORS.purpleNeon} weight="bold" />
      </View>
      <Text style={styles.doneHeadline}>{PICK_DONE.headline}</Text>
      <View style={styles.doneList}>
        {picks.map(p => (
          <View key={p.key} style={styles.doneRow}>
            <Art pick={p} size={40} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{p.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{p.artist}</Text>
            </View>
            <Icon name="check" size={18} color={COLORS.purpleNeon} weight="bold" />
          </View>
        ))}
      </View>
      <Text style={styles.line}>{PICK_DONE.line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24 },
  pressed: { opacity: 0.6 },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 32,
    lineHeight: 42,
    paddingTop: 2,
    letterSpacing: 1,
    color: COLORS.white,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  line: {
    marginTop: 6,
    fontFamily: FONTS.mono,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.purpleLight,
    textAlign: 'center',
  },
  slots: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between' },
  slotEmpty: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumber: { fontFamily: FONTS.monoBold, fontSize: 24, color: COLORS.textMuted },
  slotEmptyLabel: { marginTop: 8, fontFamily: FONTS.mono, fontSize: 13, color: COLORS.textMuted },
  slotTitleRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  slotTitle: { flex: 1, fontFamily: FONTS.monoBold, fontSize: 13, color: COLORS.white },
  slotSubRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  slotSub: { flexShrink: 1, fontFamily: FONTS.mono, fontSize: 11, color: COLORS.textSecondary },
  spotifyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: SPOTIFY_GREEN },
  art: { overflow: 'hidden', backgroundColor: COLORS.card },
  artImage: { width: '100%', height: '100%' },
  searchWrap: { marginTop: 18 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 21,
    paddingTop: 18,
    paddingBottom: 6,
  },
  heading: { flexShrink: 1, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 2, color: COLORS.textSecondary },
  // Centred over the round marks below it.
  headingLogo: { marginRight: (ROUND_TICK_SIZE - 21) / 2 },
  hint: { fontFamily: FONTS.mono, fontSize: 13, lineHeight: 19, color: COLORS.textSecondary, paddingTop: 14 },
  spinner: { paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 6 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: FONTS.monoBold, fontSize: 14, color: COLORS.white },
  rowSub: { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textSecondary },
  mark: {
    width: ROUND_TICK_SIZE,
    height: ROUND_TICK_SIZE,
    borderRadius: ROUND_TICK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOff: { borderWidth: 1.5, borderColor: COLORS.border },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  doneBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: COLORS.purpleNeon,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneHeadline: {
    fontFamily: FONTS.display,
    fontSize: 40,
    lineHeight: 50,
    paddingTop: 2,
    letterSpacing: 2,
    color: COLORS.white,
    textTransform: 'uppercase',
  },
  doneList: { alignSelf: 'stretch', gap: 10 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
});
