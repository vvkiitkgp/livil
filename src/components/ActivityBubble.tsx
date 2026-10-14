import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';
import CollabAvatar from './CollabAvatar';
import UsernameBadges from './UsernameBadges';
import { SpotifyLogo } from './SpotifyLogo';
import { resolveAuthorDisplay } from '../utils/authorDisplay';
import {
  activityBubbleParts,
  type ActivityItem,
  type ActivityPostRef,
} from '../services/activity';
import { artistLine, useSpotifyTrack } from '../services/spotify';

// The Livil bot avatar shown on every message (this is a chat "from livil Bot",
// so the actor's own profile picture is NOT the sender avatar — it sits inside
// the bubble, beside their name).
const LIVIL_LOGO = require('../assets/livil-logo.png');

/** The face of the person a message is about, inside the bubble. */
const ACTOR_AVATAR_SIZE = 24;

// ── Extensibility seam ───────────────────────────────────────────────────────
// Every activity type maps to one RenderFormat. Adding a new activity kind
// means adding a union member in services/activity.ts and a `case` below — the
// render formats (text / post / track) are reused as-is. The message text comes
// from activityBubbleParts(), which also surfaces the actor as a tappable name.

type RenderFormat =
  | { format: 'text'; icon: IconName }           // new_fan, friend outcomes
  | { format: 'post'; post: ActivityPostRef }   // like, comment, repost, milestone
  | { format: 'track'; post: ActivityPostRef }  // reserved for a future music card
  // A credit ASKS something, which no other activity does. `answered` is null while the
  // question stands and the answer afterwards, so the bubble never offers buttons on a
  // credit that is already settled — including after a reload, because the answer is
  // recorded on the row itself rather than held in screen state.
  | {
      format: 'actions';
      post: ActivityPostRef;
      creditId: string | null;
      answered: 'accepted' | 'declined' | null;
    };

function toRenderFormat(item: ActivityItem): RenderFormat {
  switch (item.type) {
    case 'like':
    case 'comment':
    case 'repost':
    case 'play_milestone':
      return { format: 'post', post: item.post };
    // Text, not 'post': there is no track behind a badge. The icon is the generic award
    // mark rather than the badge artwork — the bubble is a 20px monochrome slot and the
    // marks are gradient SVGs that would read as mud at that size.
    case 'badge_granted':
      return { format: 'text', icon: 'seal' };
    // Text, not 'post': the post is gone — that is the whole message. A 'post' format
    // would try to render a tappable card for something that no longer exists.
    //
    // `warningTriangle` rather than `block` or `error`: the person reading this may have
    // done nothing wrong at all — a reposter loses their post because somebody else's
    // track went — and a red stop sign would say otherwise before they read a word.
    case 'content_removed':
      return { format: 'text', icon: 'warningTriangle' };
    case 'new_fan':
      return { format: 'text', icon: 'star' };
    case 'friend_accepted':
      return { format: 'text', icon: 'handshake' };
    case 'friend_rejected':
      return { format: 'text', icon: 'wave' };
    case 'credited':
      return {
        format: 'actions',
        post: item.post,
        creditId: item.creditId,
        answered: item.answered,
      };
    // The uploader's side of the answer is just news; it needs no buttons.
    case 'credit_accepted':
      return { format: 'post', post: item.post };
    case 'credit_declined':
      return { format: 'post', post: item.post };
  }
}

export default function ActivityBubble({
  item,
  onActorPress,
  onPostPress,
  onRespondToCredit,
  responding = false,
}: {
  item: ActivityItem;
  onActorPress?: (actorId: string) => void;
  onPostPress?: (item: ActivityItem) => void;
  /** Answering a credit. Absent on surfaces that only preview activity. */
  onRespondToCredit?: (creditId: string, accept: boolean) => void;
  /** An answer is in flight for this item — both buttons lock, so a double tap cannot
      send two answers to a function that only honours the first. */
  responding?: boolean;
}) {
  const body = toRenderFormat(item);
  const post =
    body.format === 'post' || body.format === 'track' || body.format === 'actions'
      ? body.post
      : null;
  const parts = activityBubbleParts(item);
  const actor = parts.actor;
  const name = actor ? (actor.displayName?.trim() || `@${actor.username}`) : null;

  return (
    <View style={styles.bubbleRow}>
      <View style={styles.senderAvatarWrap}>
        <Image source={LIVIL_LOGO} style={styles.senderAvatar} />
      </View>

      <View style={styles.bubbleColumn}>
        <View style={[styles.bubble, styles.bubbleThem]}>
          <View style={styles.bubbleTextRow}>
            {/* The person a message is about gets their face beside their name, tappable like
                the name. It takes the type icon's slot on text messages: the sentence already
                says what happened, and the face says who. */}
            {actor && name ? (
              <TouchableOpacity
                style={styles.actorAvatar}
                activeOpacity={0.7}
                onPress={actor.id ? () => onActorPress?.(actor.id) : undefined}
                disabled={!actor.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${name}'s profile`}
              >
                <CollabAvatar
                  uri={actor.avatarUrl}
                  display={resolveAuthorDisplay(actor)}
                  size={ACTOR_AVATAR_SIZE}
                />
              </TouchableOpacity>
            ) : body.format === 'text' ? (
              <View style={styles.bubbleIcon}>
                <Icon name={body.icon} size={15} color={COLORS.textSecondary} />
              </View>
            ) : null}
            {/* A person's name gets its own line so their badges can sit beside it — a badge is
                an SVG, which React Native will not lay out inside a run of text. Every message
                about a person takes this shape, badged or not, so nothing shifts when the
                badges arrive from their batched fetch. */}
            {actor && name ? (
              <View style={styles.bubbleTextFlex}>
                <View style={styles.actorNameRow}>
                  <Text
                    style={[styles.bubbleText, styles.actorName]}
                    numberOfLines={1}
                    suppressHighlighting
                    onPress={actor.id ? () => onActorPress?.(actor.id) : undefined}
                  >
                    {name}
                  </Text>
                  <UsernameBadges userId={actor.id || null} size={15} />
                </View>
                <Text style={styles.bubbleText}>{parts.text.trimStart()}</Text>
              </View>
            ) : (
              <Text style={[styles.bubbleText, styles.bubbleTextFlex]}>{parts.text}</Text>
            )}
          </View>

          {post && (
            <TouchableOpacity
              style={styles.trackCard}
              activeOpacity={0.7}
              onPress={post.postId ? () => onPostPress?.(item) : undefined}
              disabled={!post.postId}
            >
              {post.spotifyTrackId ? (
                <SpotifyCardBody spotifyTrackId={post.spotifyTrackId} />
              ) : (
                <>
                  {post.coverArtUrl ? (
                    <Image source={{ uri: post.coverArtUrl }} style={styles.trackCardArt} />
                  ) : (
                    <View style={[styles.trackCardArt, styles.trackCardArtPlaceholder]}>
                      <Icon name="musicNote" size={20} color={COLORS.textSecondary} />
                    </View>
                  )}
                  <View style={styles.trackCardInfo}>
                    <Text style={styles.trackCardTitle} numberOfLines={1}>
                      {post.title || 'Your post'}
                    </Text>
                    <Text style={styles.trackCardArtist} numberOfLines={1}>
                      {post.artistName ?? 'Tap to view'}
                    </Text>
                  </View>
                </>
              )}
            </TouchableOpacity>
          )}

          {body.format === 'actions' && body.creditId && !body.answered && (
            <View style={styles.creditActions}>
              <TouchableOpacity
                style={[styles.creditBtn, styles.creditBtnPrimary]}
                activeOpacity={0.85}
                disabled={responding}
                onPress={() => onRespondToCredit?.(body.creditId!, true)}
              >
                <Text style={styles.creditBtnPrimaryText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.creditBtn}
                activeOpacity={0.85}
                disabled={responding}
                onPress={() => onRespondToCredit?.(body.creditId!, false)}
              >
                <Text style={styles.creditBtnText}>Not me</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * The card for a Spotify repost. Livil stores only the Spotify id, never the song's details
 * (ADR-0027), so they are looked up from Spotify as the card mounts. Spotify's rules, as in
 * the chat song row: artwork as given (corners ≤ 4px, nothing drawn over it) and the
 * Spotify mark beside the details it supplied.
 */
function SpotifyCardBody({ spotifyTrackId }: { spotifyTrackId: string }) {
  const meta = useSpotifyTrack(spotifyTrackId);
  const track = meta.status === 'ready' ? meta.track : null;
  return (
    <>
      {track?.imageUrl ? (
        <Image source={{ uri: track.imageUrl }} style={[styles.trackCardArt, styles.spotifyArt]} />
      ) : (
        <View style={[styles.trackCardArt, styles.spotifyArt, styles.trackCardArtPlaceholder]}>
          <Icon name="musicNote" size={20} color={COLORS.textSecondary} />
        </View>
      )}
      <View style={styles.trackCardInfo}>
        <Text style={styles.trackCardTitle} numberOfLines={1}>
          {track?.title ?? (meta.status === 'loading' ? ' ' : 'Your Spotify repost')}
        </Text>
        <Text style={styles.trackCardArtist} numberOfLines={1}>
          {track ? artistLine(track) : 'Tap to view'}
        </Text>
      </View>
      <SpotifyLogo size="xs" />
    </>
  );
}

// Mirrors ConversationScreen's incoming ("them") message bubble + track card.
const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: 6,
    paddingHorizontal: 12,
  },
  senderAvatarWrap: {},
  senderAvatar: { width: 28, height: 28, borderRadius: 14 },
  bubbleColumn: { maxWidth: '75%' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  bubbleThem: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  // Outlined, never filled — a confirm here is a normal choice, not a destructive one, and
  // purple outlines rather than fills throughout the app.
  creditActions: { flexDirection: 'row', gap: 8 },
  creditBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  creditBtnPrimary: { borderColor: COLORS.purple },
  creditBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  creditBtnPrimaryText: { color: COLORS.purpleNeon, fontSize: 14, fontWeight: '700' },
  bubbleText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 21 },
  bubbleTextRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bubbleIcon: { marginRight: 5, marginTop: 3 },
  // Centred on the first line of text (lineHeight 21), so a one-line message reads level.
  actorAvatar: { marginRight: 8, marginTop: (21 - ACTOR_AVATAR_SIZE) / 2 },
  bubbleTextFlex: { flexShrink: 1 },
  actorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actorName: { color: COLORS.white, fontWeight: '700', flexShrink: 1 },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 8,
  },
  trackCardArt: { width: 44, height: 44, borderRadius: 6 },
  spotifyArt: { borderRadius: 4 },
  trackCardArtPlaceholder: {
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCardInfo: { flex: 1 },
  trackCardTitle: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  trackCardArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
});
