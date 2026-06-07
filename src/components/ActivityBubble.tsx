import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import {
  activitySummary,
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
// from the shared activitySummary().

type RenderFormat =
  | { format: 'text'; icon: string }            // new_fan, friend outcomes
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
      return { format: 'text', icon: '⭐' };
    case 'friend_accepted':
      return { format: 'text', icon: '🤝' };
    case 'friend_rejected':
      return { format: 'text', icon: '👋' };
  }
}

export default function ActivityBubble({
  item,
  onPlayPost,
}: {
  item: ActivityItem;
  onPlayPost?: (postId: string) => void;
}) {
  const body = toRenderFormat(item);
  const post = body.format === 'post' || body.format === 'track' ? body.post : null;

  return (
    <View style={styles.bubbleRow}>
      <View style={styles.senderAvatarWrap}>
        <Image source={LIVIL_LOGO} style={styles.senderAvatar} />
      </View>

      <View style={styles.bubbleColumn}>
        <View style={[styles.bubble, styles.bubbleThem]}>
          <Text style={styles.bubbleText}>
            {body.format === 'text' ? `${body.icon} ` : ''}
            {activitySummary(item)}
          </Text>

          {post && (
            <TouchableOpacity
              style={styles.trackCard}
              activeOpacity={0.7}
              onPress={post.postId ? () => onPlayPost?.(post.postId) : undefined}
              disabled={!post.postId}
            >
              {post.coverArtUrl ? (
                <Image source={{ uri: post.coverArtUrl }} style={styles.trackCardArt} />
              ) : (
                <View style={[styles.trackCardArt, styles.trackCardArtPlaceholder]}>
                  <Text style={styles.trackCardNote}>🎵</Text>
                </View>
              )}
              <View style={styles.trackCardInfo}>
                <Text style={styles.trackCardTitle} numberOfLines={1}>
                  {post.title || 'Your track'}
                </Text>
                <Text style={styles.trackCardArtist} numberOfLines={1}>
                  Tap to play
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
    marginVertical: 2,
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
  trackCardNote: { fontSize: 20 },
  trackCardInfo: { flex: 1 },
  trackCardTitle: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  trackCardArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
});
