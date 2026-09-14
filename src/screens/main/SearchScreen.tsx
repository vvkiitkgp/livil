import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  ActivityIndicator,
  Image,
  Keyboard,
  type TextInput,
} from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import FormInput from '../../components/FormInput';
import AddBadge from '../../components/AddBadge';
import { COLORS } from '../../theme/colors';
import type { RootStackParamList } from '../../navigation/types';
import { searchProfiles, type ProfileSearchResult } from '../../services/tracks';
import { searchPosts, feedPostToNowPlaying, type FeedPost } from '../../services/posts';
import { searchAlbums, type AlbumSearchResult } from '../../services/albums';
import { usePlayback } from '../../contexts/PlaybackContext';
import { usePlayFullScreen } from '../../hooks/usePlayFullScreen';
import { useRecentSearches } from '../../hooks/useRecentSearches';
import {
  recordSearchTap, fetchSearchPopularity, type SearchTapKind,
} from '../../services/searchAnalytics';
import { rankSearchResults, type SearchResult } from '../../utils/searchRanking';
import { supabase } from '../../../lib/supabase';
import { Icon } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];
type NavProp = NativeStackNavigationProp<RootStackParamList>;

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0].slice(0, 2).toUpperCase(); }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) { return ''; }
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * A song, as a row rather than a post.
 *
 * The feed card is the wrong unit here: searching is scanning, and a card that carries
 * artwork, a caption, a seek bar and four engagement controls fits one result on a phone
 * screen. This shows title, who uploaded it, and their face — enough to tell two versions of
 * the same song apart, which is the actual job.
 *
 * Deliberately NOT a reuse of `DetailView`'s TrackRow: that one is numbered by position in an
 * album or playlist, and a position number is meaningless in a result list.
 */
function TrackRow({
  post,
  index,
  isCurrent,
  onPress,
}: {
  post: FeedPost;
  index: number;
  isCurrent: boolean;
  onPress: () => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const art = post.track.coverArtUrl ?? post.track.thumbnailUrl;
  const initial = post.track.title.trim().charAt(0).toUpperCase() || '♪';
  const uploader = post.author.displayName ?? `@${post.author.username}`;
  const duration = formatDuration(post.track.durationSeconds);

  // A border on press, never android_ripple: the ripple is drawn as a rectangle that ignores
  // borderRadius, so on this rounded row it flashed a square box over the corners — the trap
  // CLAUDE.md names. `DetailView`'s row gets away with a ripple because it is square and
  // full-bleed; this one cannot.
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        isCurrent && styles.rowActive,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      {/* Rounded square = a song. Circles are people; a square with a disc badge is an album. */}
      <View style={[styles.trackArt, { backgroundColor: accents[0] }]}>
        <View style={[styles.artAccent, { backgroundColor: accents[1] }]} />
        {art ? (
          <Image source={{ uri: art }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.artInitial}>{initial}</Text>
        )}
      </View>

      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, isCurrent && styles.rowTitleActive]} numberOfLines={1}>
          {post.track.title}
        </Text>
        <View style={styles.uploaderLine}>
          {post.author.avatarUrl ? (
            <Image source={{ uri: post.author.avatarUrl }} style={styles.uploaderAvatar} />
          ) : (
            <View style={[styles.uploaderAvatar, styles.uploaderAvatarFallback]}>
              <Text style={styles.uploaderInitial}>{initialsFor(uploader).charAt(0)}</Text>
            </View>
          )}
          <Text style={styles.rowSubtitle} numberOfLines={1}>{uploader}</Text>
        </View>
      </View>

      {duration ? <Text style={styles.duration}>{duration}</Text> : null}
    </Pressable>
  );
}

export default function SearchScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const {
    nowPlaying, setQueue, setNowPlaying, requestPlay, markSeekTarget, handlersRef,
  } = usePlayback();
  const openFullScreen = usePlayFullScreen();
  const { recents, remember, forget } = useRecentSearches();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [profiles, setProfiles] = useState<ProfileSearchResult[]>([]);
  const [albums, setAlbums] = useState<AlbumSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  /** Bumped on every tab tap purely to remount the pills and replay their entrance. */
  const [replayKey, setReplayKey] = useState(0);
  /** Distinct-people-who-opened-it, by entity id. Feeds the ranking; empty is simply zero. */
  const [taps, setTaps] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMeId(data?.user?.id ?? null);
    });
  }, []);

  /**
   * Tapping the Search tab always starts a fresh search.
   *
   * Listens on the tab navigator rather than using `useFocusEffect`, and the difference
   * matters twice over. `tabPress` fires even when Search is ALREADY the open tab, which is
   * what "whenever I tap it" means — screen focus would not fire at all in that case. And it
   * does NOT fire on returning from a pushed profile, so coming back from a tapped result
   * leaves the query and results alone instead of wiping them and throwing up a keyboard.
   */
  useEffect(() => {
    // On `navigation` itself, NOT `getParent()`. SearchScreen is a direct Tab.Screen, so this
    // IS the tab navigator — the one that emits `tabPress`. Reaching for the parent gets the
    // root stack, which never emits it, and the listener silently never fires.
    const unsubscribe = navigation.addListener('tabPress' as never, () => {
      setQuery('');
      // Remounts the pills so their entrance replays. The tab keeps this screen mounted after
      // the first visit, so without a new key the animation would run exactly once ever.
      setReplayKey(key => key + 1);
      // A frame later: the tab is still settling, and focusing into that gets swallowed on
      // Android often enough to look like the tap did nothing.
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return unsubscribe;
  }, [navigation]);

  /**
   * One debounce, three queries, in parallel.
   *
   * Previously each tab fetched only when it was the active one, which is why tabs existed at
   * all. With a single list every query has to run every time, so they go together rather
   * than as three independent effects — three effects would produce three loading flickers
   * and three chances to render a half-merged list.
   */
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setPosts([]);
      setProfiles([]);
      setAlbums([]);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const timer = setTimeout(async () => {
      // `allSettled`, not `all`: one failing service must not blank the other two. A search
      // that finds the song but not the artist is still a useful search.
      const [postsRes, profilesRes, albumsRes] = await Promise.allSettled([
        searchPosts(trimmed, { limit: 20 }),
        searchProfiles(trimmed, { excludeUserIds: meId ? [meId] : [], limit: 20 }),
        searchAlbums(trimmed, 20),
      ]);
      if (cancelled) { return; }

      setPosts(postsRes.status === 'fulfilled' ? postsRes.value : []);
      setProfiles(profilesRes.status === 'fulfilled' ? profilesRes.value : []);
      setAlbums(albumsRes.status === 'fulfilled' ? albumsRes.value : []);

      const failures = [postsRes, profilesRes, albumsRes].filter(r => r.status === 'rejected');
      // Only worth saying when everything failed. One rejected service alongside results is a
      // partial answer, and an error banner over a list that has results reads as a lie.
      setError(failures.length === 3 ? 'Search failed. Check your connection.' : '');
      setLoading(false);
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, meId]);

  const results = useMemo(
    () => rankSearchResults({ posts, profiles, albums, query, taps }),
    [posts, profiles, albums, query, taps],
  );

  /**
   * Popularity for what is on screen, fetched AFTER the results.
   *
   * Deliberately a second pass rather than part of the debounce: the list renders on the
   * search itself, and the counts re-order it a moment later. Blocking the results on an
   * extra round trip would make every search feel slower to buy an ordering nicety.
   */
  useEffect(() => {
    const trackIds = posts.map(p => p.track.id);
    const albumIds = albums.map(a => a.id);
    const profileIds = profiles.map(p => p.id);
    if (trackIds.length + albumIds.length + profileIds.length === 0) {
      setTaps({});
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchSearchPopularity('track', trackIds),
      fetchSearchPopularity('album', albumIds),
      fetchSearchPopularity('profile', profileIds),
    ]).then(([t, a, p]) => {
      // One map across all three kinds: ids are uuids, so they cannot collide, and the
      // ranking looks up by entity id without caring which kind it was.
      if (!cancelled) { setTaps({ ...t, ...a, ...p }); }
    });
    return () => { cancelled = true; };
  }, [posts, albums, profiles]);

  /**
   * Play a result immediately, replacing whatever was playing.
   *
   * The queue becomes exactly this one track. A search result is not a context the way an
   * album or a playlist is — there is no "rest of the list" the listener asked for — so
   * queueing the other results would have the next thing autoplay something they merely
   * scrolled past.
   *
   * Opens the full-screen player, a beat after playback starts so the floating pill is
   * seen to rise into it.
   *
   * This REVERSES the earlier decision recorded here, which kept results on screen so the
   * next tap was one tap away. That reasoning still holds and is the cost: dismissing the
   * player to get back to the list is now a swipe. It was overridden deliberately — tapping
   * a song should do the same thing everywhere in the app, and a result that plays
   * differently from a feed card is the surprising case. Revert this one call if browsing
   * search results turns out to matter more than the consistency.
   */
  const playTrack = useCallback(
    (post: FeedPost) => {
      const item = feedPostToNowPlaying(post);
      // Clipped reposts start at the clip, not at zero — playing a 30-second excerpt from
      // 0:00 plays the part the reposter cut out.
      const clipStart = post.clipStartSec ?? 0;
      const isCurrent = nowPlaying?.postId === post.id;

      setQueue([item], 0, 'search');

      if (isCurrent && handlersRef.current) {
        // Same track, already loaded — playing OR paused. `setNowPlaying` preserves the refs
        // for an unchanged postId and `requestPlay` no-ops when it is already active, so
        // neither would move it: without this, re-tapping the playing song does nothing and
        // re-tapping a paused one resumes from where it stopped. Tapping a song in a result
        // list means "play this song", never "carry on from the middle".
        markSeekTarget(clipStart);
        handlersRef.current.seek(clipStart);
        handlersRef.current.play();
        return;
      }

      setNowPlaying(item);
      // Before requestPlay, so GAP's onLoad seeks to the start rather than to whatever
      // position the previous track left behind.
      markSeekTarget(clipStart);
      requestPlay(item.postId);
      openFullScreen();
    },
    [setQueue, setNowPlaying, requestPlay, markSeekTarget, handlersRef, nowPlaying?.postId, openFullScreen],
  );

  /**
   * A search is worth remembering once it LEADS somewhere.
   *
   * Recorded when a result is opened, or when the keyboard's search key is pressed — not on
   * typing. Typing "vvk" would otherwise store "v", "vv" and "vvk" and fill all four slots
   * with prefixes of one search, which is the fastest way to make the list useless.
   */
  const onResultOpened = useCallback((kind: SearchTapKind, entityId: string) => {
    remember(query);
    // What was OPENED, not what was typed — the signal behind "most searched". Fire and
    // forget: it must not delay the navigation or the playback it is racing.
    recordSearchTap(kind, entityId);
    // Dismiss on the way out. `keyboardShouldPersistTaps="handled"` is what lets a single tap
    // both open the result AND land here — with the default the first tap would be spent
    // closing the keyboard and the row would need tapping twice.
    Keyboard.dismiss();
  }, [remember, query]);

  const renderItem = useCallback(
    ({ item, index }: { item: SearchResult; index: number }) => {
      if (item.kind === 'track') {
        return (
          <TrackRow
            post={item.post}
            index={index}
            isCurrent={nowPlaying?.postId === item.post.id}
            onPress={() => { onResultOpened('track', item.post.track.id); playTrack(item.post); }}
          />
        );
      }

      if (item.kind === 'user') {
        const person = item.profile;
        const name = person.displayName ?? person.username;
        return (
          <Pressable
            onPress={() => {
              onResultOpened('profile', person.id);
              navigation.navigate('UserProfile', { userId: person.id });
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            {/* A circle is a person. The one shape in this list that is not a square. */}
            {person.avatarUrl ? (
              <Image source={{ uri: person.avatarUrl }} style={styles.personAvatar} />
            ) : (
              <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                <Text style={styles.artInitial}>{initialsFor(name)}</Text>
              </View>
            )}
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>@{person.username}</Text>
            </View>
            <AddBadge userId={person.id} size="md" />
          </Pressable>
        );
      }

      const release = item.album;
      const initial = release.title.trim().charAt(0).toUpperCase() || '♪';
      const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => {
            onResultOpened('album', release.id);
            navigation.navigate('AlbumDetail', { albumId: release.id, albumTitle: release.title });
          }}
        >
          {/* Square, like a song — so a disc badge carries the difference. Without it an album
              and a track are the same silhouette, and the row would rely on the subtitle. */}
          <View style={[styles.albumArt, { backgroundColor: accents[0] }]}>
            <View style={[styles.artAccent, { backgroundColor: accents[1] }]} />
            {release.coverArtUrl ? (
              <Image source={{ uri: release.coverArtUrl }} style={StyleSheet.absoluteFill} />
            ) : (
              <Text style={styles.artInitial}>{initial}</Text>
            )}
            <View style={styles.albumPip}>
              <Icon name="disc" size={11} color={COLORS.white} />
            </View>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>{release.title}</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              @{release.uploaderUsername} · {release.trackCount}{' '}
              {release.trackCount === 1 ? 'track' : 'tracks'}
              {release.releaseYear ? ` · ${release.releaseYear}` : ''}
            </Text>
          </View>
          <Icon name="forward" size={20} color={COLORS.textMuted} />
        </Pressable>
      );
    },
    [navigation, nowPlaying?.postId, playTrack, onResultOpened],
  );

  const trimmedQuery = query.trim();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Tapping anywhere that is not itself interactive closes the keyboard.
          A Pressable rather than a bare View: it only fires for touches no child claimed, so
          rows, pills and the field keep working untouched. `accessible={false}` keeps it out
          of the screen-reader tree — it is a gesture target, not something to land on. */}
      <Pressable style={styles.container} onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.subtitle}>Songs, artists, and albums</Text>
      </View>

      <View style={styles.inputWrap}>
        <FormInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search songs, people, albums"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => { remember(query); Keyboard.dismiss(); }}
          trailing={
            query.length > 0 ? (
              // `FormInput` sets paddingRight:0 on the input whenever a trailing element is
              // present, which means the trailing element owns that gap. Without this the
              // icon sits flat against the field's right edge.
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                style={styles.clearButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Clear search"
              >
                <Icon name="clear" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            ) : null
          }
        />
      </View>

      {error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={COLORS.purpleLight} />
        </View>
      ) : trimmedQuery.length === 0 && recents.length > 0 ? (
        /* Pills, wrapped — at most four, so they never need to scroll. A vertical list of
           four short words wastes the width and reads as heavier than the thing it is
           shortcutting. */
        <View style={styles.recentWrap}>
          <Text style={styles.recentHeading}>Recent</Text>
          {/* Keyed on the replay counter so a tab tap remounts the whole row and the stagger
              runs again. Entrance animations fire on mount, and the tab navigator keeps this
              screen mounted after the first visit. */}
          <View style={styles.pillRow} key={replayKey}>
            {recents.map((term, index) => (
              <Animated.View
                key={term}
                /* Staggered by position, so they arrive one after another rather than all at
                   once. 70ms apart over 260ms each: the last of four has fully landed in
                   under half a second, which is quick enough not to be waited on and slow
                   enough to read as deliberate. */
                entering={FadeInDown.delay(index * 70).duration(260)}
                exiting={FadeOut.duration(140)}
                /* Deleting one pill leaves a hole; this slides the rest closed instead of
                   snapping. Faster than the entrance — a reflow is a consequence, not an
                   event, and should not ask for the same attention. */
                layout={LinearTransition.duration(200)}
              >
                <Pressable
                  style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
                  onPress={() => {
                    // Fills the field and nothing else — the search runs on its own, and the
                    // keyboard stays up so the term can be edited rather than retyped.
                    setQuery(term);
                    Keyboard.dismiss();
                  }}
                >
                  <Icon name="recent" size={13} color={COLORS.textMuted} />
                  <Text style={styles.pillText} numberOfLines={1}>{term}</Text>
                  {/* No confirmation. Removing one of four entries is not destructive, and a
                      dialog would cost more than retyping the search would. */}
                  <TouchableOpacity
                    onPress={() => forget(term)}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                    accessibilityLabel={`Remove ${term} from recent searches`}
                  >
                    <Icon name="close" size={14} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centerState}>
          {trimmedQuery.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>Discover something new</Text>
              <Text style={styles.emptyText}>
                Search a song, an artist, an album — or a #tag.
              </Text>
            </>
          ) : (
            <Text style={styles.emptyText}>Nothing matches "{trimmedQuery}".</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => `${item.kind}:${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          // Scrolling is reading, and reading through a keyboard covering half the screen is
          // the thing it stops you doing.
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        />
      )}
      </Pressable>
    </SafeAreaView>
  );
}

const ART = 52;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { color: COLORS.white, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 2 },
  inputWrap: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  listContent: { paddingHorizontal: 12, paddingTop: 4 },

  // One row shape for all three kinds — the list reads as one list, and the artwork on the
  // left is what says which kind you are looking at.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    // Transparent by default so the border can appear without moving anything. Adding a
    // border only on press/active would shift every row by a pixel as you touch it.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  /** Now playing. An outline, not a fill — purple outlines and letters, it never fills. */
  rowActive: { borderColor: COLORS.purple },
  /** Touch feedback: the same border, dimmer. No ripple, no wash, no opacity fade. */
  rowPressed: { borderColor: COLORS.purpleDeep },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  rowTitleActive: { color: COLORS.purpleLight },
  rowSubtitle: { color: COLORS.textSecondary, fontSize: 12.5, flexShrink: 1 },

  trackArt: {
    width: ART, height: ART, borderRadius: 8,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  albumArt: {
    width: ART, height: ART, borderRadius: 8,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  personAvatar: { width: ART, height: ART, borderRadius: ART / 2, overflow: 'hidden' },
  personAvatarFallback: {
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  artAccent: {
    position: 'absolute', right: -ART * 0.3, bottom: -ART * 0.3,
    width: ART, height: ART, borderRadius: ART / 2, opacity: 0.75,
  },
  artInitial: { color: COLORS.white, fontSize: 18, fontWeight: '800' },

  // Small badges rather than labels: a track and an album are the same silhouette otherwise.
  albumPip: {
    position: 'absolute', right: 3, bottom: 3,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(10,10,15,0.75)',
    alignItems: 'center', justifyContent: 'center',
  },

  uploaderLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  uploaderAvatar: { width: 16, height: 16, borderRadius: 8, overflow: 'hidden' },
  uploaderAvatarFallback: {
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  uploaderInitial: { color: COLORS.textSecondary, fontSize: 9, fontWeight: '700' },

  duration: { color: COLORS.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },

  /** Owns the gap to the field's right edge — FormInput zeroes the input's own padding. */
  clearButton: { paddingHorizontal: 14, paddingVertical: 12 },

  recentWrap: { paddingHorizontal: 20, paddingTop: 8 },
  recentHeading: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingBottom: 10,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Outlined, never filled — the same rule the buttons follow. A filled pill at this size
  // would read as a selected state, and none of these are selected.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: '100%',
  },
  pillPressed: { borderColor: COLORS.purple },
  pillText: { color: COLORS.white, fontSize: 13.5, flexShrink: 1 },

  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center' },
});
