import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import UsernameBadges from './UsernameBadges';
import { Icon } from './Icon';
import SheetModal, { SheetScrollView } from './SheetModal';
import CommentSongCard from './CommentSongCard';
import CommentGifCard from './CommentGifCard';
import { useRunAfterDismiss } from '../hooks/useRunAfterDismiss';
import { renderCommentBody } from '../utils/mentions';
import { relativeTime } from '../utils/commentTime';
import { commentDisplayText, type CommentNode } from '../services/comments';
import {
  ELBOW_RADIUS,
  indentFor,
  LINE_WIDTH,
  ROW_PAD_LEFT,
  threadSegments,
  type ThreadPosition,
} from '../utils/commentThread';

type Props = {
  node: CommentNode;
  /** Where this comment sits in its thread: its depth and the lines that cross its row. */
  thread: ThreadPosition;
  viewerId: string;
  /** The post's owner (upload or repost): may delete any comment on it. Null while unknown. */
  postOwnerId: string | null;
  onReply: (node: CommentNode) => void;
  onDelete: (node: CommentNode) => void;
  onReport: (node: CommentNode) => void;
  onToggleLike: (node: CommentNode) => void;
  onMentionPress: (username: string) => void;
  onAvatarPress: (userId: string) => void;
  highlighted: boolean;
};


function avatarInitial(author: CommentNode['author']): string {
  const name = author.displayName?.trim() || author.username;
  return (name || '?').slice(0, 1).toUpperCase();
}

function formatCount(n: number): string {
  if (n < 1000) { return String(n); }
  if (n < 10000) { return `${(n / 1000).toFixed(1)}k`; }
  if (n < 1_000_000) { return `${Math.floor(n / 1000)}k`; }
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export default function CommentItem(props: Props) {
  const { node, thread, viewerId, highlighted } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // Delete and Report open a modal of the comments sheet's; on iOS it must wait until this
  // menu has closed (see useRunAfterDismiss).
  const { runAfterDismiss, onDismiss } = useRunAfterDismiss();
  const indent = indentFor(thread.depth);
  const isOwn = node.authorId === viewerId;
  // Yours, or on your post — the database allows exactly these (post_comments_delete_*).
  const canDelete = isOwn || (!!viewerId && props.postOwnerId === viewerId);
  const displayName = node.author.displayName || node.author.username;
  // With a song or a GIF, the body's last line is its label (for apps that cannot draw
  // it); the card or the GIF replaces it here.
  const text = commentDisplayText(node);

  return (
    <View style={[styles.row, { paddingLeft: ROW_PAD_LEFT + indent }, highlighted && styles.highlighted]}>
      {/* The thread: from under a comment's avatar, curving into each reply's. Drawn
          first, so avatars sit on top of it. */}
      {threadSegments(thread).map((seg, i) => (
        seg.kind === 'elbow' ? (
          <View
            key={i}
            style={[styles.elbow, { left: seg.left, top: seg.top, width: seg.width, height: seg.height }]}
          />
        ) : (
          <View
            key={i}
            style={[
              styles.line,
              { left: seg.left, top: seg.top },
              seg.height === null ? styles.lineToBottom : { height: seg.height },
            ]}
          />
        )
      ))}

      <TouchableOpacity onPress={() => props.onAvatarPress(node.authorId)} activeOpacity={0.7}>
        {node.author.avatarUrl ? (
          <Image source={{ uri: node.author.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{avatarInitial(node.author)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {/* 13 to match the name beside it. headerRow already sets gap: 4. */}
          <UsernameBadges userId={node.authorId} size={13} />
          <Text style={styles.time}>· {relativeTime(node.createdAt)}</Text>
          <View style={styles.spacer} />
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={styles.menuIcon}>
              <Icon name="overflow" size={18} color={COLORS.textSecondary} />
            </View>
          </TouchableOpacity>
        </View>

        {text ? (
          <Text style={styles.bodyText}>
            {renderCommentBody(text, props.onMentionPress, styles.bodyText)}
          </Text>
        ) : null}
        {node.song ? <CommentSongCard song={node.song} label={node.songLabel} /> : null}
        {node.gif ? <CommentGifCard gif={node.gif} /> : null}

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => props.onToggleLike(node)}
            style={styles.actionBtn}
            activeOpacity={0.7}
          >
            <Icon
              name="heart"
              size={16}
              color={node.likedByMe ? '#FF4D6D' : COLORS.textSecondary}
              weight={node.likedByMe ? 'fill' : 'regular'}
            />
            {node.likeCount > 0 ? (
              <Text style={[styles.actionText, node.likedByMe && styles.actionTextActive]}>
                {formatCount(node.likeCount)}
              </Text>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => props.onReply(node)}
            style={styles.actionBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>Reply</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SheetModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismiss={onDismiss}
        fit
        style={styles.menuCard}
        header={null}
      >
        {/* In the sheet's scroll body, so a drag down anywhere on the menu closes it. */}
        <SheetScrollView
          style={styles.menuBody}
          contentContainerStyle={{ paddingBottom: 12 + insets.bottom }}
        >
          {canDelete ? (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); runAfterDismiss(() => props.onDelete(node)); }}
            >
              <Text style={[styles.menuText, { color: COLORS.error }]}>Delete</Text>
            </TouchableOpacity>
          ) : null}
          {!isOwn ? (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); runAfterDismiss(() => props.onReport(node)); }}
            >
              <Text style={styles.menuText}>Report</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.menuItem} onPress={() => setMenuOpen(false)}>
            <Text style={[styles.menuText, { color: COLORS.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </SheetScrollView>
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 16,
    paddingVertical: 10,
    gap: 10,
  },
  highlighted: {
    backgroundColor: COLORS.purpleDim,
  },
  line: {
    position: 'absolute',
    width: LINE_WIDTH,
    backgroundColor: COLORS.border,
  },
  lineToBottom: { bottom: 0 },
  elbow: {
    position: 'absolute',
    borderLeftWidth: LINE_WIDTH,
    borderBottomWidth: LINE_WIDTH,
    borderColor: COLORS.border,
    borderBottomLeftRadius: ELBOW_RADIUS,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: COLORS.purpleLight,
    fontWeight: '700',
    fontSize: 13,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '70%',
  },
  time: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  spacer: {
    flex: 1,
  },
  menuIcon: {
    paddingHorizontal: 4,
  },
  bodyText: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  actionTextActive: {
    color: COLORS.error,
  },
  // The surface only — height, grabber, backdrop and drag come from SheetModal.
  menuCard: { backgroundColor: COLORS.surface },
  menuBody: { flexShrink: 1 },
  menuItem: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  menuText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
