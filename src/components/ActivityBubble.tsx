import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';
import {
  activityBubbleParts,
  type ActivityItem,
  type ActivityPostRef,
} from '../services/activity';

// The Livil bot avatar shown on every message (this is a chat "from livil Bot",
// so the actor's own profile picture is intentionally NOT used).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LIVIL_LOGO = require('../assets/livil-logo.png');

// ── Extensibility seam ───────────────────────────────────────────────────────
// Every activity type maps to one RenderFormat. Adding a new activity kind
// means adding a union member in services/activity.ts and a `case` below — the
// render formats (text / post / track) are reused as-is. The message text comes
// from activityBubbleParts(), which also surfaces the actor as a tappable name.

type RenderFormat =
  | { format: 'text'; icon: IconName }           // new_fan, friend outcomes
  | { format: 'post'; post: ActivityPostRef }   // like, comment, repost, milestone
  | { format: 'track'; post: ActivityPostRef }; // reserved for a future music card

function toRenderFormat(item: ActivityItem): RenderFormat {
  switch (item.type) {
    case 'like':
    case 'comment':
    case 'repost':
    case 'play_milestone':
      return { format: 'post', post: item.post };
    case 'new_fan':
      return { format: 'text', icon: 'star' };
    case 'friend_accepted':
      return { format: 'text', icon: 'handshake' };
    case 'friend_rejected':
      return { format: 'text', icon: 'wave' };
  }
}

export default function ActivityBubble({
  item,
  onActorPress,
  onPostPress,
}: {
  item: ActivityItem;
  onActorPress?: (actorId: string) => void;
  onPostPress?: (item: ActivityItem) => void;
}) {
  const body = toRenderFormat(item);
  const post = body.format === 'post' || body.format === 'track' ? body.post : null;
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
            {body.format === 'text' ? (
              <View style={styles.bubbleIcon}>
                <Icon name={body.icon} size={15} color={COLORS.textSecondary} />
              </View>
            ) : null}
            <Text style={[styles.bubbleText, styles.bubbleTextFlex]}>
              {actor && name ? (
                <Text
                  style={styles.actorName}
                  suppressHighlighting
                  onPress={actor.id ? () => onActorPress?.(actor.id) : undefined}
                >
                  {name}
                </Text>
              ) : null}
              {parts.text}
            </Text>
          </View>

          {post && (
            <TouchableOpacity
              style={styles.trackCard}
              activeOpacity={0.7}
              onPress={post.postId ? () => onPostPress?.(item) : undefined}
              disabled={!post.postId}
            >
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
                  Tap to view
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
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
  bubbleText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 21 },
  bubbleTextRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bubbleIcon: { marginRight: 5, marginTop: 3 },
  bubbleTextFlex: { flexShrink: 1 },
  actorName: { color: COLORS.white, fontWeight: '700' },
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
  trackCardArtPlaceholder: {
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCardInfo: { flex: 1 },
  trackCardTitle: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  trackCardArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
});
