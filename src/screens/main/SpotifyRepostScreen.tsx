import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  Keyboard,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { Icon } from '../../components/Icon';
import FormInput from '../../components/FormInput';
import { Button } from '../../components/Button';
import { SpotifyLogo } from '../../components/SpotifyLogo';
import { Logo } from '../../components/Logo';
import { useOpenInSpotify } from '../../hooks/useOpenInSpotify';
import { useToast } from '../../contexts/ToastContext';
import { createSpotifyRepost, isPlayableInLivil, searchPosts, type FeedPost } from '../../services/posts';
import {
  artistLine,
  rememberSpotifyTrack,
  resolveSpotifyLink,
  SPOTIFY_SEARCH_BUSY,
  searchSpotifyOrFail,
  useSpotifyAvailability,
  useSpotifyTrack,
  type SpotifyTrack,
} from '../../services/spotify';
import { looksLikeSpotifyLink, parseSpotifyTrackId } from '../../utils/spotifyLinks';
import { friendlyErrorMessage } from '../../utils/errorMessages';
import type { RootStackParamList } from '../../navigation/types';
import { closeAddFlow } from '../../navigation/closeAddFlow';
import MentionSuggestions from '../../components/MentionSuggestions';
import { useMentionInput, useMentionListRoom } from '../../hooks/useMentionInput';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SpotifyRepost'>;

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_RESULTS = 8;
const LIVIL_RESULTS = 5;
const CAPTION_MAX = 2000;

/** A Livil song in the search results: the original upload's post, once per track. */
type LivilHit = { postId: string; trackId: string; title: string; artist: string; artUrl: string | null };

/**
 * Search returns uploads AND reposts of them. A repost is reposted through its original
 * upload (as the card's own Repost does), so each song appears once, pointing at that post.
 */
function toLivilHits(posts: FeedPost[]): LivilHit[] {
  const seen = new Set<string>();
  const hits: LivilHit[] = [];
  for (const post of posts) {
    if (!isPlayableInLivil(post)) {continue;}
    const postId = post.kind === 'repost' ? post.originalPostId : post.id;
    if (!postId || seen.has(post.track.id)) {continue;}
    seen.add(post.track.id);
    const artist = post.kind === 'repost' ? post.originalAuthor : post.author;
    hits.push({
      postId,
      trackId: post.track.id,
      title: post.track.title,
      artist: artist?.displayName || (artist ? `@${artist.username}` : ''),
      artUrl: post.track.coverArtUrl ?? post.track.thumbnailUrl,
    });
  }
  return hits;
}

/**
 * Repost a song: Livil or Spotify (ADR-0027).
 *
 * Two ways in, one screen:
 *  - from "+ Post" → Repost a song: FIND the song — one box that searches Livil and Spotify
 *    as you type, or takes a pasted Spotify link and jumps straight to it. A Livil result
 *    hands over to the Livil Repost screen (clip editor); a Spotify result stays here;
 *  - from "Repost this song" (⋯) on a friend's Spotify repost: the song arrives LOCKED (no
 *    search, no "Change song") and you only add your description.
 *
 * Deliberately not the Livil Repost screen with a flag: that screen is a clip editor built
 * around a player. A Spotify song cannot be played in Livil, so there is no clip, no story
 * option and nothing to preview — this is the lighter screen that is left.
 */
export default function SpotifyRepostScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { showToast } = useToast();
  const availability = useSpotifyAvailability();
  // Search is tried unless the server SAID it is off: a check that failed or has not
  // answered yet must not turn this screen into paste-only. If Spotify then refuses the
  // search itself, the box says so (SPOTIFY_SEARCH_BUSY).
  const searchOn = availability.search !== false;

  const locked = route.params?.locked === true && !!route.params?.spotifyTrackId;
  const [pickedId, setPickedId] = useState<string | null>(route.params?.spotifyTrackId ?? null);

  const [query, setQuery] = useState('');
  /** The scroll view's height, so the page can be kept 1px taller than it (see below). */
  const [frameHeight, setFrameHeight] = useState(0);
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [livil, setLivil] = useState<LivilHit[]>([]);
  const [livilSearching, setLivilSearching] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const mention = useMentionInput(caption, setCaption);
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const mentionRoom = useMentionListRoom(scrollRef, 24);
  const [submitting, setSubmitting] = useState(false);
  const findRef = useRef<TextInput>(null);

  const picked = useSpotifyTrack(pickedId);
  // No notice here: this screen IS about Spotify, and iOS cannot show it over this sheet.
  const listenOnSpotify = useOpenInSpotify('search', { notice: false });

  const pick = useCallback((track: SpotifyTrack) => {
    haptics.select();
    rememberSpotifyTrack(track);
    setPickedId(track.id);
    setQuery('');
    setResults([]);
    setHint(null);
    Keyboard.dismiss();
  }, []);

  // One box, two jobs: a Spotify link picks the song; anything else searches.
  useEffect(() => {
    if (pickedId) {return;}
    const text = query.trim();
    setHint(null);

    if (text.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }

    if (looksLikeSpotifyLink(text)) {
      setResults([]);
      const direct = parseSpotifyTrackId(text);
      if (direct) {
        setPickedId(direct);
        setQuery('');
        Keyboard.dismiss();
        return;
      }
      // spotify.link short links (and anything else Spotify-shaped) need the server.
      let cancelled = false;
      setSearching(true);
      resolveSpotifyLink(text).then(id => {
        if (cancelled) {return;}
        setSearching(false);
        if (id) {
          setPickedId(id);
          setQuery('');
          Keyboard.dismiss();
        } else {
          setHint("That link isn't a Spotify song. In Spotify, open the song → Share → Copy link.");
        }
      });
      return () => { cancelled = true; };
    }

    if (!searchOn) {
      setResults([]);
      setSearching(false);
      setHint("Spotify search isn't available right now. Paste a Spotify song link instead.");
      return;
    }
    if (text.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchSpotifyOrFail(text, SEARCH_RESULTS);
      if (cancelled) {return;}
      setResults(found ?? []);
      setSearching(false);
      if (found === null) {
        // Spotify refused or the call failed — not "no matches". The same words as every
        // other Spotify search box, offering the path that still works (a pasted link).
        setHint(SPOTIFY_SEARCH_BUSY);
      } else if (found.length === 0) {
        setHint(`Nothing on Spotify for "${text}".`);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, pickedId, searchOn]);

  // Livil songs, searched alongside Spotify. Independent of the Spotify switches: Livil's
  // own catalogue is always there. Not for a pasted link (that is a Spotify jump).
  useEffect(() => {
    const text = query.trim();
    if (pickedId || text.length < 2 || looksLikeSpotifyLink(text)) {
      setLivil([]);
      setLivilSearching(false);
      return;
    }
    let cancelled = false;
    setLivilSearching(true);
    const timer = setTimeout(async () => {
      // Over-fetch: reposts of one song collapse into a single row.
      const found = await searchPosts(text, { limit: LIVIL_RESULTS * 3 }).catch(() => [] as FeedPost[]);
      if (cancelled) {return;}
      setLivil(toLivilHits(found).slice(0, LIVIL_RESULTS));
      setLivilSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, pickedId]);

  // A Livil song is reposted on the Livil Repost screen (clip, caption, story). Pushed on
  // top, not swapped in (a modal swap plays as close + reopen on iOS): Cancel there comes
  // back to this search, and posting closes the whole "+ Post" flow (closeAddFlow).
  const pickLivil = useCallback((hit: LivilHit) => {
    haptics.select();
    Keyboard.dismiss();
    navigation.push('Repost', { originalPostId: hit.postId });
  }, [navigation]);

  const changeSong = useCallback(() => {
    setPickedId(null);
    setTimeout(() => findRef.current?.focus(), 50);
  }, []);

  // The database refuses the insert while the switch is off; checking here as well turns
  // that refusal into a clear message instead of an error after tapping. Only a real "off"
  // counts — not yet knowing is not a reason to block the button.
  const switchedOff = availability.reposts === false;
  const canSubmit = !!pickedId && picked.status === 'ready' && !submitting && !switchedOff;

  const handleSubmit = useCallback(async () => {
    if (!pickedId || submitting) {return;}
    setSubmitting(true);
    try {
      await createSpotifyRepost(pickedId, caption);
      haptics.success();
      showToast("Reposted! It's live on your profile.", { kind: 'success' });
      closeAddFlow(navigation);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      // The column only exists once the migration is applied; say so plainly.
      const message = /spotify_track_id/.test(raw)
        ? "Spotify reposts aren't switched on yet."
        : friendlyErrorMessage(e, "Couldn't repost that song.");
      showToast(message, { kind: 'error' });
      setSubmitting(false);
    }
  }, [pickedId, caption, submitting, showToast, navigation]);

  const placeholder = searchOn ? 'Search songs or paste a Spotify link' : 'Search Livil or paste a Spotify link';
  // "Nothing on Spotify" is only the whole story when Livil found nothing either.
  const nothingAnywhere = !!hint && hint.startsWith('Nothing on Spotify') && livil.length === 0 && !livilSearching;
  const shownHint = nothingAnywhere ? `No songs for "${query.trim()}" on Livil or Spotify.` : hint;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} disabled={submitting} style={styles.headerSide}>
          <Text style={[styles.headerCancel, submitting && styles.disabledText]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{locked ? 'Repost' : 'Repost a song'}</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAwareScrollView
        ref={scrollRef}
        // Room for the @ list under the caption while it is open (useMentionListRoom).
        bottomOffset={mentionRoom.bottomOffset}
        style={styles.flex}
        // At least 1px taller than the screen: this page is often short (a search box and a
        // few results), and a page with nothing to scroll ignores a drag on Android — so
        // "on-drag" never fired and the keyboard stayed up.
        contentContainerStyle={[styles.scrollContent, frameHeight > 0 && { minHeight: frameHeight + 1 }]}
        onLayout={e => setFrameHeight(Math.floor(e.nativeEvent.layout.height))}
        keyboardShouldPersistTaps="handled"
        // Dragging the page puts the keyboard away, as on Upload, Search and New message.
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!pickedId ? (
          <>
            <Text style={styles.sectionLabel}>Find the song</Text>
            <FormInput
              ref={findRef}
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
              accessibilityLabel={placeholder}
              trailing={
                query.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => setQuery('')}
                    style={styles.clearButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Clear"
                  >
                    <Icon name="clear" size={16} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ) : null
              }
            />
            <Text style={styles.helper}>
              {searchOn
                ? 'Type a song or artist to search Livil and Spotify, or paste a Spotify link.'
                : 'Search Livil songs. For Spotify: open the song → Share → Copy link, then paste it here.'}
            </Text>

            {(searching || livilSearching) && livil.length === 0 && results.length === 0 ? (
              <View style={styles.searching}>
                <ActivityIndicator color={COLORS.purpleLight} />
              </View>
            ) : null}

            {/* Livil first: these play in Livil, and they are the artists Livil is for. */}
            {livil.length > 0 ? (
              <View style={styles.results}>
                <View style={styles.resultsHeader}>
                  <Text style={styles.sectionLabelInline}>On Livil</Text>
                  <Logo size={34} color={COLORS.white} />
                </View>
                {livil.map(hit => (
                  <Pressable
                    key={hit.trackId}
                    onPress={() => pickLivil(hit)}
                    style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={hit.artist ? `${hit.title} by ${hit.artist}, on Livil` : `${hit.title}, on Livil`}
                  >
                    {hit.artUrl ? (
                      <Image source={{ uri: hit.artUrl }} style={[styles.resultArt, styles.livilArt]} />
                    ) : (
                      <View style={[styles.resultArt, styles.livilArt, styles.artEmpty]}>
                        <Icon name="musicNote" size={18} color={COLORS.textMuted} />
                      </View>
                    )}
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{hit.title}</Text>
                      {hit.artist ? <Text style={styles.resultArtist} numberOfLines={1}>{hit.artist}</Text> : null}
                    </View>
                    <Icon name="disclosure" size={18} color={COLORS.textSecondary} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {shownHint && !searching ? <Text style={styles.hint}>{shownHint}</Text> : null}

            {results.length > 0 ? (
              <View style={styles.results}>
                <View style={styles.resultsHeader}>
                  <Text style={styles.sectionLabelInline}>On Spotify</Text>
                  <SpotifyLogo size="xs" />
                </View>
                {results.map(track => (
                  <Pressable
                    key={track.id}
                    onPress={() => pick(track)}
                    style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${track.title} by ${artistLine(track)}`}
                  >
                    {track.imageUrl ? (
                      <Image source={{ uri: track.imageUrl }} style={styles.resultArt} />
                    ) : (
                      <View style={[styles.resultArt, styles.artEmpty]}>
                        <Icon name="musicNote" size={18} color={COLORS.textMuted} />
                      </View>
                    )}
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{track.title}</Text>
                      <Text style={styles.resultArtist} numberOfLines={1}>
                        {artistLine(track)}{track.album ? ` · ${track.album}` : ''}
                      </Text>
                    </View>
                    <Icon name="disclosure" size={18} color={COLORS.textSecondary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.trackHeader}>
              <Text style={styles.sectionLabel}>Track</Text>
              {!locked ? (
                <TouchableOpacity onPress={changeSong} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.changeLink}>Change song</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Tap the song (or "Play on Spotify") to hear it in Spotify before reposting — Livil cannot play
                Spotify audio itself (ADR-0027: no previews). Livil pauses, Spotify opens, and
                this screen is kept as it is. */}
            <Pressable
              style={({ pressed }) => [styles.trackCard, pressed && picked.status === 'ready' && styles.trackCardPressed]}
              onPress={picked.status === 'ready' ? () => { void listenOnSpotify(picked.track.id); } : undefined}
              disabled={picked.status !== 'ready'}
              accessibilityRole="button"
              accessibilityLabel={picked.status === 'ready' ? `Play ${picked.track.title} on Spotify` : undefined}
            >
              {picked.track?.imageUrl ? (
                <Image source={{ uri: picked.track.imageUrl }} style={styles.trackArt} />
              ) : (
                <View style={[styles.trackArt, styles.artEmpty]}>
                  {picked.status === 'loading' ? (
                    <ActivityIndicator color={COLORS.purpleLight} />
                  ) : (
                    <Icon name="musicNote" size={28} color={COLORS.textMuted} />
                  )}
                </View>
              )}
              <View style={styles.trackText}>
                <Text style={styles.trackTitle} numberOfLines={2}>
                  {picked.status === 'ready'
                    ? picked.track.title
                    : picked.status === 'loading'
                      ? 'Loading…'
                      : 'Song not found on Spotify'}
                </Text>
                {picked.status === 'ready' ? (
                  <Text style={styles.trackArtist} numberOfLines={1}>{artistLine(picked.track)}</Text>
                ) : null}
                <SpotifyLogo size="xs" withName style={styles.trackLogo} />
              </View>
              {locked ? (
                <View style={styles.lock} accessibilityLabel="Song locked">
                  <Icon name="lock" size={14} color={COLORS.textSecondary} />
                </View>
              ) : null}
            </Pressable>
            {/* The feed's own Spotify-post button, so it reads the same everywhere. */}
            {picked.status === 'ready' ? (
              <Button
                label="Play on Spotify"
                variant="secondary"
                size="md"
                leading={<SpotifyLogo size="xs" />}
                onPress={() => { void listenOnSpotify(picked.track.id); }}
                accessibilityLabel="Play on Spotify"
                haptic="none"
                style={styles.playOnSpotify}
              />
            ) : null}

            <View style={styles.infoBox}>
              <Icon name="info" size={16} color={COLORS.purpleLight} />
              <Text style={styles.infoText}>
                Friends play it in the Spotify app. The whole song is shared: no clip, and it can't go in a story.
              </Text>
            </View>

            {switchedOff ? (
              <Text style={styles.offNote}>Spotify reposts are switched off right now.</Text>
            ) : null}

            <Text style={styles.sectionLabel}>
              Caption <Text style={styles.sectionHint}>(How do you feel about this track)</Text>
            </Text>
            <FormInput
              // Children, not `value`: the caption with its @tags coloured (useMentionInput).
              onChangeText={setCaption}
              onSelectionChange={mention.onSelectionChange}
              placeholder="Share what you feel about this track"
              multiline
              maxLength={CAPTION_MAX}
              editable={!submitting}
              wrapperStyle={styles.textAreaWrapper}
              style={styles.textArea}
            >
              {mention.styled}
            </FormInput>
            {/* @ to tag someone. Under the field; the page makes room above the keyboard. */}
            <MentionSuggestions
              query={mention.query}
              onSelect={mention.select}
              variant="card"
              onHeightChange={mentionRoom.onHeightChange}
            />
          </>
        )}
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <Button
          label={pickedId ? 'Repost' : 'Pick a song to repost'}
          onPress={() => { void handleSubmit(); }}
          variant="primary"
          size="lg"
          fullWidth
          busy={submitting}
          disabled={!canSubmit && !submitting}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  // Header, labels, text area and footer mirror RepostScreen so the two repost screens
  // read as siblings.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: { minWidth: 64 },
  headerCancel: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: COLORS.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  disabledText: { opacity: 0.5 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  // The question beside the "CAPTION" heading: normal case and weight, so a long prompt
  // does not shout in the section label's small capitals.
  sectionHint: { textTransform: 'none', letterSpacing: 0, fontWeight: '400' },
  sectionLabelInline: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  clearButton: { paddingHorizontal: 12 },
  helper: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
  searching: { paddingVertical: 24, alignItems: 'center' },
  hint: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 20 },
  results: { marginTop: 20 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  pressed: { opacity: 0.7 },
  // Spotify artwork: small corner radius, nothing on top.
  resultArt: { width: 52, height: 52, borderRadius: 4, backgroundColor: COLORS.card },
  // Livil covers use the app's own rounder corner, so the two lists read as two sources.
  livilArt: { borderRadius: 10 },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultText: { flex: 1, minWidth: 0, gap: 3 },
  resultTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  resultArtist: { color: COLORS.textSecondary, fontSize: 13 },
  trackHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  changeLink: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '600' },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  trackCardPressed: { opacity: 0.7 },
  playOnSpotify: { alignSelf: 'flex-start', marginTop: 10 },
  trackArt: { width: 96, height: 96, borderRadius: 4, backgroundColor: COLORS.card },
  trackText: { flex: 1, minWidth: 0, gap: 4 },
  trackTitle: { color: COLORS.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  trackArtist: { color: COLORS.textSecondary, fontSize: 14 },
  trackLogo: { marginTop: 4 },
  lock: { position: 'absolute', top: 12, right: 12 },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.purpleDim,
    marginTop: 16,
    marginBottom: 24,
  },
  infoText: { flex: 1, color: COLORS.purpleLight, fontSize: 13, lineHeight: 19 },
  offNote: { color: COLORS.textSecondary, fontSize: 13, marginTop: -12, marginBottom: 20 },
  textAreaWrapper: { alignItems: 'flex-start', marginBottom: 16 },
  textArea: { minHeight: 100, paddingTop: 14, textAlignVertical: 'top' },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
});
