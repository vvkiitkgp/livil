import React, { useState } from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { renderCommentBody } from '../utils/mentions';
import type { CommentNode } from '../services/comments';

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
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX;
  const isOwn = node.authorId === viewerId;
  const displayName = node.author.displayName || node.author.username;

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
          <Text style={styles.time}>· {relativeTime(node.createdAt)}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={{ paddingHorizontal: 4 }}>
              <Icon name="overflow" size={18} color={COLORS.textSecondary} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.bodyText}>
          {renderCommentBody(node.body, props.onMentionPress, styles.bodyText)}
        </Text>

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

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
          <View style={styles.menuBackdrop}>
            <TouchableWithoutFeedback>
              <View style={[styles.menuCard, { paddingBottom: 12 + insets.bottom }]}>
                {isOwn ? (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => { setMenuOpen(false); props.onDelete(node); }}
                  >
                    <Text style={[styles.menuText, { color: COLORS.error }]}>Delete</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => { setMenuOpen(false); props.onReport(node); }}
                  >
                    <Text style={styles.menuText}>Report</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.menuItem} onPress={() => setMenuOpen(false)}>
                  <Text style={[styles.menuText, { color: COLORS.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
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
