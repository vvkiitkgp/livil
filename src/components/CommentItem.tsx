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
import { useRunAfterDismiss } from '../hooks/useRunAfterDismiss';
import { renderCommentBody } from '../utils/mentions';
import { commentDisplayText, type CommentNode } from '../services/comments';

const INDENT_PX = 14;
const MAX_INDENT_DEPTH = 4;

type Props = {
  node: CommentNode;
  depth: number;
  viewerId: string;
  onReply: (node: CommentNode) => void;
  onDelete: (node: CommentNode) => void;
  onReport: (node: CommentNode) => void;
  onToggleLike: (node: CommentNode) => void;
  onMentionPress: (username: string) => void;
  onAvatarPress: (userId: string) => void;
  highlighted: boolean;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) { return ''; }
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) { return `${diffSec}s`; }
  const m = Math.floor(diffSec / 60);
  if (m < 60) { return `${m}m`; }
  const h = Math.floor(m / 60);
  if (h < 24) { return `${h}h`; }
  const d = Math.floor(h / 24);
  if (d < 7) { return `${d}d`; }
  const w = Math.floor(d / 7);
  if (w < 4) { return `${w}w`; }
  const mo = Math.floor(d / 30);
  if (mo < 12) { return `${mo}mo`; }
  return `${Math.floor(d / 365)}y`;
}

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
  const { node, depth, viewerId, highlighted } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // Delete and Report open a modal of the comments sheet's; on iOS it must wait until this
  // menu has closed (see useRunAfterDismiss).
  const { runAfterDismiss, onDismiss } = useRunAfterDismiss();
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX;
  const isOwn = node.authorId === viewerId;
  const displayName = node.author.displayName || node.author.username;
  // With a song, the body's last line is the song's label (for apps that cannot draw the
  // card); the card replaces it here.
  const text = commentDisplayText(node);

  return (
    <View style={[styles.row, { paddingLeft: 16 + indent }, highlighted && styles.highlighted]}>
      {depth > 0 ? (
        <View style={[styles.guide, { left: indent + 16 - 7 }]} />
      ) : null}

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
          {isOwn ? (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); runAfterDismiss(() => props.onDelete(node)); }}
            >
              <Text style={[styles.menuText, { color: COLORS.error }]}>Delete</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); runAfterDismiss(() => props.onReport(node)); }}
            >
              <Text style={styles.menuText}>Report</Text>
            </TouchableOpacity>
          )}
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
  guide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.border,
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
