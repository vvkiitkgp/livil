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
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { Icon } from '../../components/Icon';
import FormInput from '../../components/FormInput';
import { Button } from '../../components/Button';
import { SpotifyLogo } from '../../components/SpotifyLogo';
import { useToast } from '../../contexts/ToastContext';
import { createSpotifyRepost } from '../../services/posts';
import {
  artistLine,
  rememberSpotifyTrack,
  resolveSpotifyLink,
  searchSpotifyOrFail,
  useSpotifyAvailability,
  useSpotifyTrack,
  type SpotifyTrack,
} from '../../services/spotify';
import { looksLikeSpotifyLink, parseSpotifyTrackId } from '../../utils/spotifyLinks';
import { friendlyErrorMessage } from '../../utils/errorMessages';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SpotifyRepost'>;

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_RESULTS = 8;
const CAPTION_MAX = 2000;

/**
 * Repost a Spotify track (ADR-0027).
 *
 * Two ways in, one screen:
 *  - from "+ Track" → Repost from Spotify: FIND the song — one box that searches Spotify
 *    as you type, or takes a pasted link and jumps straight to it;
 *  - from the Repost pill on a friend's Spotify repost: the song arrives LOCKED (no
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

  const locked = route.params?.locked === true && !!route.params?.spotifyTrackId;
  const fromUsername = route.params?.fromUsername ?? null;
  const [pickedId, setPickedId] = useState<string | null>(route.params?.spotifyTrackId ?? null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const findRef = useRef<TextInput>(null);

  const picked = useSpotifyTrack(pickedId);

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

    if (!availability.search) {
      setResults([]);
      setSearching(false);
      setHint('Search is not available right now. Paste a Spotify song link instead.');
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
        // Spotify refused or the call failed — not "no matches". Same wording as the
        // search-not-configured branch above, which offers the path that still works.
        setHint('Search is not available right now. Paste a Spotify song link instead.');
      } else if (found.length === 0) {
        setHint(`Nothing on Spotify for "${text}".`);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, pickedId, availability.search]);

  const changeSong = useCallback(() => {
    setPickedId(null);
    setTimeout(() => findRef.current?.focus(), 50);
  }, []);

  // The database refuses the insert while the switch is off; checking here as well turns
  // that refusal into a clear message instead of an error after tapping.
  const switchedOff = !availability.reposts;
  const canSubmit = !!pickedId && picked.status === 'ready' && !submitting && !switchedOff;

  const handleSubmit = useCallback(async () => {
    if (!pickedId || submitting) {return;}
    setSubmitting(true);
    try {
      await createSpotifyRepost(pickedId, caption);
      haptics.success();
      showToast("Reposted! It's live on your profile.", { kind: 'success' });
      navigation.goBack();
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

  const placeholder = availability.search ? 'Search Spotify or paste a link' : 'Paste a Spotify song link';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} disabled={submitting} style={styles.headerSide}>
          <Text style={[styles.headerCancel, submitting && styles.disabledText]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{locked ? 'Repost' : 'Repost from Spotify'}</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
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
              {availability.search
                ? 'Type a song or artist, or paste a Spotify link to jump straight to it.'
                : 'In Spotify, open the song → Share → Copy link, then paste it here.'}
            </Text>

            {searching ? (
              <View style={styles.searching}>
                <ActivityIndicator color={COLORS.purpleLight} />
              </View>
            ) : null}

            {hint && !searching ? <Text style={styles.hint}>{hint}</Text> : null}

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

            <View style={styles.trackCard}>
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
            </View>
            {locked && fromUsername ? (
              <Text style={styles.fromLine}>
                From <Text style={styles.fromName}>@{fromUsername}</Text>'s repost
              </Text>
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
              value={caption}
              onChangeText={setCaption}
              placeholder="Share what you feel about this track"
              multiline
              maxLength={CAPTION_MAX}
              editable={!submitting}
              wrapperStyle={styles.textAreaWrapper}
              style={styles.textArea}
            />
          </>
        )}
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <Button
          label={pickedId ? 'Repost' : 'Pick a song to repost'}
          onPress={() => void handleSubmit()}
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
  trackArt: { width: 96, height: 96, borderRadius: 4, backgroundColor: COLORS.card },
  trackText: { flex: 1, minWidth: 0, gap: 4 },
  trackTitle: { color: COLORS.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  trackArtist: { color: COLORS.textSecondary, fontSize: 14 },
  trackLogo: { marginTop: 4 },
  lock: { position: 'absolute', top: 12, right: 12 },
  fromLine: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  fromName: { color: COLORS.purpleLight, fontWeight: '600' },
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
