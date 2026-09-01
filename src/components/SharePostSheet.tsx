import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { useToast } from '../contexts/ToastContext';
import { getOrCreateDm } from '../services/conversations';
import { listFriends, type FriendRef } from '../services/relationships';
import {
  isCardShareAvailable,
  isInstagramStoryAvailable,
  shareCardImage,
  sharePostLink,
  shareStoryCard,
  shareToConversations,
  type ShareablePost,
} from '../services/share';
import { Button } from './Button';
import FormInput from './FormInput';
import { GradientBorder } from './GradientBorder';
import { Icon, type IconName } from './Icon';
import { StoryCard } from './StoryCard';

/**
 * The Share sheet for an upload post.
 *
 * Two halves, in the order people actually use them: friends first (a horizontal strip
 * of avatars you tap to select, then one Send), destinations second.
 *
 * ── THE OFFSCREEN CARD ──────────────────────────────────────────────────────
 * `<StoryCard/>` is mounted as the FIRST child, at the top-left corner, and the
 * backdrop is drawn over it. That is deliberate and the alternatives do not work:
 * `opacity: 0` captures as a transparent rectangle (captureRef draws the view's own
 * alpha), and positioning it off-window makes Android's layout pass unreliable.
 * `captureRef` draws the view directly into a bitmap, so being covered costs nothing.
 *
 * It is mounted for the whole time the sheet is open rather than on demand, so the
 * cover art has already decoded by the time anyone taps "Instagram Story". Tapping
 * still waits on `artworkReady` — see the comment on that state.
 */

type Props = {
  visible: boolean;
  post: ShareablePost | null;
  onClose: () => void;
};

type Destination = {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
};

const LINK_DESTINATION: Destination = {
  key: 'link',
  label: 'Share link',
  hint: 'WhatsApp, Messages, anywhere',
  icon: 'share',
};

/**
 * Attaching an image to a share needs the native module; the plain link does not.
 * When it is missing, the two image rows are HIDDEN rather than shown and silently
 * degraded to the link — three rows where two do the same thing is the worst outcome,
 * because nothing tells the user which one failed.
 */
const IMAGE_DESTINATIONS: Destination[] = [
  { key: 'story', label: 'Instagram Story', hint: 'Post the card with a link back', icon: 'instagram' },
  { key: 'image', label: 'Send the card', hint: 'The artwork as an image, not a link', icon: 'externalLink' },
];

function initials(name: string | null, username: string): string {
  const n = name?.trim() || username;
  return (n[0] ?? '♪').toUpperCase();
}

export default function SharePostSheet({ visible, post, onClose }: Props) {
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);

  const [friends, setFriends] = useState<FriendRef[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /**
   * Whether the card's artwork has decoded. Capturing before it has produces a card
   * with a grey hole where the cover should be — and only on a cold image cache, so
   * it never reproduces on the machine of whoever wrote the feature.
   */
  const [artworkReady, setArtworkReady] = useState(false);
  const onArtworkReady = useCallback(() => setArtworkReady(true), []);

  // The card is laid out at window width so its natural capture lands near 1080px on a
  // typical phone and captureRef normalises rather than upscales.
  const cardWidth = Math.round(Dimensions.get('window').width);
  const cardHeight = Math.round((cardWidth * 16) / 9);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setQuery('');
      setArtworkReady(false);
      setBusyKey(null);
      return;
    }
    let cancelled = false;
    setLoadingFriends(true);
    listFriends()
      .then(rows => { if (!cancelled) { setFriends(rows); } })
      .catch(() => { if (!cancelled) { setFriends([]); } })
      .finally(() => { if (!cancelled) { setLoadingFriends(false); } });
    return () => { cancelled = true; };
  }, [visible]);

  const toggle = useCallback((userId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
  }, []);

  /**
   * Search is shown only past a handful of friends. Below that the strip is faster to
   * scan than a text field is to type into, and an empty search box over four avatars
   * is furniture.
   *
   * Matches display name AND username, because people search for whichever they know —
   * "Bipasa" and "bipasa_b" have to find the same person. Selected friends are never
   * filtered out: narrowing the query would otherwise silently drop someone you had
   * already picked, and "Send to 3" would send to one.
   */
  const SEARCH_THRESHOLD = 6;
  const q = query.trim().toLowerCase();
  const visibleFriends = q
    ? friends.filter(
        f =>
          selected.has(f.id) ||
          (f.displayName ?? '').toLowerCase().includes(q) ||
          f.username.toLowerCase().includes(q),
      )
    : friends;

  const handleSend = useCallback(async () => {
    if (!post || selected.size === 0 || sending) { return; }
    setSending(true);
    try {
      // A friend may have no conversation yet, so the DM is resolved per recipient.
      // Settled individually: one failure (a friendship removed while the sheet was
      // open) must not drop the rest.
      const resolved = await Promise.allSettled(
        [...selected].map(userId => getOrCreateDm(userId)),
      );
      const conversationIds = resolved
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value);

      const { sent, failed } = await shareToConversations(post, conversationIds);
      const unreachable = failed + (selected.size - conversationIds.length);

      if (sent > 0) {
        showToast(
          unreachable > 0
            ? `Sent to ${sent} · ${unreachable} couldn't be reached`
            : `Sent to ${sent} ${sent === 1 ? 'friend' : 'friends'}`,
          { kind: unreachable > 0 ? 'info' : 'success' },
        );
        onClose();
      } else {
        showToast("Couldn't send that", { kind: 'error' });
      }
    } catch {
      showToast("Couldn't send that", { kind: 'error' });
    } finally {
      setSending(false);
    }
  }, [post, selected, sending, showToast, onClose]);

  /** Capture the offscreen card. Returns null on any failure — the callers all have a
   *  link-shaped fallback, so a capture problem must never be fatal.
   *
   *  `react-native-view-shot` is required here rather than imported at module scope, for
   *  the same reason `react-native-share` is (see services/share.ts): a native module
   *  missing from the binary must cost the card, not the screen. This library happens to
   *  resolve softly rather than throwing, but relying on that asymmetry is how the next
   *  dependency bump becomes a crash. */
  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!artworkReady || !cardRef.current) {
      // The two ways to get a blank card, told apart: the artwork has not decoded yet,
      // or the offscreen view never mounted.
      console.log(
        `[LIVIL][share] capture skipped: artworkReady=${artworkReady} hasRef=${!!cardRef.current}`,
      );
      return null;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      return await captureRef(cardRef, {
        format: 'jpg',
        // 0.9 rather than PNG: a 1080x1920 PNG of a photographic card is ~2.1 MB
        // against ~0.4 MB here, with no visible difference, and Instagram caps the
        // asset at 8 MB.
        quality: 0.9,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
    } catch (e) {
      console.warn('[LIVIL][share] capture failed:', (e as Error).message);
      return null;
    }
  }, [artworkReady]);

  const handleDestination = useCallback(async (key: string) => {
    if (!post || busyKey) { return; }
    setBusyKey(key);
    try {
      if (key === 'link') {
        await sharePostLink(post);
        onClose();
        return;
      }

      const fileUri = await captureCard();
      if (!fileUri) {
        // No card — share the link rather than nothing, and SAY SO. Silently doing
        // something other than what was tapped is the worst option: it looks like the
        // button does nothing, or like two buttons do the same thing.
        await sharePostLink(post);
        showToast('Couldn’t render the card — shared the link instead', { kind: 'info' });
        onClose();
        return;
      }

      const outcome = key === 'story'
        ? await shareStoryCard(post, fileUri)
        : await shareCardImage(post, fileUri);

      // Every fallback is reported, and each says which step gave way, so a failure is
      // diagnosable from the phone instead of from a log.
      if (outcome === 'fellback') {
        showToast(
          key === 'story'
            ? 'Instagram isn’t set up — shared the link instead'
            : 'Couldn’t attach the image — shared the link instead',
          { kind: 'info' },
        );
      }
      onClose();
    } catch {
      showToast("Couldn't share that", { kind: 'error' });
    } finally {
      setBusyKey(null);
    }
  }, [post, busyKey, captureCard, showToast, onClose]);

  if (!post) { return null; }

  /**
   * Which destinations this build can actually deliver. Computed AFTER the early return
   * on purpose: PostCard mounts this sheet for every card in the feed (closed, with a
   * null post), so putting the probe above the return ran a native-module lookup on
   * every render of every card — and when a module was missing, logged about it just as
   * often. It belongs on the path where a sheet is genuinely open.
   */
  const destinations = [
    ...(isInstagramStoryAvailable() ? [IMAGE_DESTINATIONS[0]!] : []),
    LINK_DESTINATION,
    ...(isCardShareAvailable() ? [IMAGE_DESTINATIONS[1]!] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The offscreen story card. See `cardHost` for why it is clipped rather than
          hidden, and why "rendered behind the backdrop" was not good enough. */}
      <View style={styles.cardHost} pointerEvents="none">
        <View ref={cardRef} collapsable={false} style={styles.cardInner}>
          <StoryCard
            width={cardWidth}
            height={cardHeight}
            title={post.title}
            artistName={post.artistName}
            coverArtUrl={post.coverArtUrl}
            onArtworkReady={onArtworkReady}
          />
        </View>
      </View>

      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.grabber} />
              <Text style={styles.heading}>Share</Text>
              <Text style={styles.subheading} numberOfLines={1}>
                {post.title} — {post.artistName}
              </Text>

              {/* ── Friends ── */}
              {loadingFriends ? (
                <View style={styles.friendsLoading}>
                  <ActivityIndicator color={COLORS.purpleNeon} />
                </View>
              ) : friends.length === 0 ? (
                <Text style={styles.emptyFriends}>
                  Add friends to send tracks straight to them.
                </Text>
              ) : (
                <>
                  {friends.length > SEARCH_THRESHOLD ? (
                    <FormInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search friends"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      wrapperStyle={styles.search}
                    />
                  ) : null}
                  <FlatList
                    horizontal
                    data={visibleFriends}
                    keyExtractor={f => f.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.friendsRow}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                      const isOn = selected.has(item.id);
                      return (
                        <Pressable
                          style={({ pressed }) => [styles.friend, pressed && styles.pressed]}
                          onPress={() => toggle(item.id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isOn }}
                          accessibilityLabel={`Send to ${item.displayName || item.username}`}
                        >
                          <View style={styles.friendAvatarWrap}>
                            {item.avatarUrl ? (
                              <Image source={{ uri: item.avatarUrl }} style={styles.friendAvatar} />
                            ) : (
                              <View style={[styles.friendAvatar, styles.friendAvatarFallback]}>
                                <Text style={styles.friendInitial}>
                                  {initials(item.displayName, item.username)}
                                </Text>
                              </View>
                            )}
                            {isOn ? (
                              <View style={styles.check}>
                                <Icon name="check" size={12} color={COLORS.white} weight="bold" />
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {item.displayName || item.username}
                          </Text>
                        </Pressable>
                      );
                    }}
                    ListEmptyComponent={
                      <Text style={styles.emptyFriends}>No friends match “{query}”.</Text>
                    }
                  />
                </>
              )}

              {selected.size > 0 ? (
                <View style={styles.sendWrap}>
                  <Button
                    variant="primary"
                    size="md"
                    busy={sending}
                    onPress={handleSend}
                    label={`Send to ${selected.size}`}
                  />
                </View>
              ) : null}

              <View style={styles.divider} />

              {/* ── Everywhere else ── */}
              {destinations.map(d => (
                <Pressable
                  key={d.key}
                  style={({ pressed }) => [styles.destRow, pressed && styles.pressed]}
                  onPress={() => void handleDestination(d.key)}
                  disabled={busyKey !== null}
                  accessibilityRole="button"
                  accessibilityLabel={d.label}
                >
                  <View style={styles.destIcon}>
                    <GradientBorder borderRadius={999} />
                    {busyKey === d.key ? (
                      <ActivityIndicator size="small" color={COLORS.purpleNeon} />
                    ) : (
                      <Icon name={d.icon} size={18} color={COLORS.purpleNeon} />
                    )}
                  </View>
                  <View style={styles.destText}>
                    <Text style={styles.destLabel}>{d.label}</Text>
                    <Text style={styles.destHint}>{d.hint}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /**
   * The offscreen card, clipped to a 1x1 window at the top-left corner.
   *
   * THIS SHIPPED BROKEN and the fix is not obvious, so: the host used to be a plain
   * absolute box at 0,0 with the comment "the backdrop covers it". The backdrop is
   * `rgba(0,0,0,0.72)` — it covers nothing. A full-bleed 9:16 card rendered over the
   * whole screen above the sheet, and read as a layout bug in the sheet itself.
   *
   * Clipping is the right hiding mechanism here, and the alternatives are worse:
   *   * `opacity: 0` bakes alpha into what `captureRef` draws — a transparent card.
   *   * moving it off-window risks Android skipping layout, and layout is what gives
   *     the card its measured size and lets the artwork load.
   * Clipped, it stays laid out and drawn at 0,0 where nothing about it is uncertain,
   * and only 1dp of it is on screen. `captureRef` draws the INNER view directly into a
   * bitmap, so the parent's clip never applies to the capture.
   */
  cardHost: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden' },
  cardInner: { position: 'absolute', top: 0, left: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 12,
  },
  heading: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  subheading: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 14 },
  friendsLoading: { height: 92, alignItems: 'center', justifyContent: 'center' },
  emptyFriends: { color: COLORS.textSecondary, fontSize: 13, paddingVertical: 18 },
  friendsRow: { paddingVertical: 4, gap: 14 },
  friend: { width: 64, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  friendAvatarWrap: { width: 52, height: 52 },
  friendAvatar: { width: 52, height: 52, borderRadius: 26 },
  friendAvatarFallback: {
    backgroundColor: COLORS.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInitial: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  // A 16px dot: solid fill is correct here, per the small-indicator exemption to the
  // no-solid-purple rule. An outlined check at this size reads as unchecked.
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  friendName: { color: COLORS.textSecondary, fontSize: 11, marginTop: 6, textAlign: 'center' },
  search: { marginBottom: 12 },
  sendWrap: { marginTop: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginVertical: 16 },
  destRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  destIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  destText: { flex: 1 },
  destLabel: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  destHint: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
});
