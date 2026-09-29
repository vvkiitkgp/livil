import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';
import FormInput from './FormInput';
import CommentItem from './CommentItem';
import CommentReportModal from './CommentReportModal';
import ConfirmActionModal from './ConfirmActionModal';
import MentionSuggestions from './MentionSuggestions';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import {
  createComment,
  deleteComment,
  fetchPostComments,
  subscribeToPostComments,
  toggleCommentLike,
  unsubscribeFromPostComments,
  type CommentNode,
  type MentionProfile,
} from '../services/comments';
import { detectMentionTrigger } from '../utils/mentions';
import { friendlyErrorMessage } from '../utils/errorMessages';

type Props = {
  visible: boolean;
  postId: string | null;
  onClose: () => void;
  /**
   * Called with the net delta to apply to the post's commentsCount (+1 on send,
   * -1 on delete, etc.). Used by the feed/screen owner to keep PostCard's stat
   * in sync without refetching.
   */
  onCommentsCountChange?: (delta: number) => void;
  /**
   * Optional id of a comment to scroll to and pulse briefly when the sheet
   * opens. Set by activity-center deep links so the originating comment is
   * surfaced. The pulse reuses the same flashHighlight() path used for new
   * realtime inserts (~1.5s tint).
   */
  highlightCommentId?: string | null;
};

type FlatRow =
  | { kind: 'comment'; key: string; node: CommentNode; depth: number }
  | { kind: 'composer'; key: string; parentId: string | null; depth: number };

const HIGHLIGHT_MS = 1500;
const COMPOSER_KEY = '__composer__';
const MAX_INDENT_DEPTH = 4;

function flattenTree(nodes: CommentNode[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const n of nodes) {
    out.push({ kind: 'comment', key: n.id, node: n, depth });
    if (n.replies.length > 0) {
      flattenTree(n.replies, depth + 1, out);
    }
  }
  return out;
}

/**
 * Splice the inline composer into the rows list at the position where the
 * resulting comment will land:
 *   - No reply: at index 0 (top-level comments prepend).
 *   - Replying: directly after the parent comment row, at parentDepth + 1
 *     so it visually sits where the reply will appear.
 */
function withComposerRow(rows: FlatRow[], replyingTo: CommentNode | null): FlatRow[] {
  if (!replyingTo) {
    return [{ kind: 'composer', key: COMPOSER_KEY, parentId: null, depth: 0 }, ...rows];
  }
  const out: FlatRow[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.kind === 'comment' && r.node.id === replyingTo.id) {
      out.push({
        kind: 'composer',
        key: COMPOSER_KEY,
        parentId: replyingTo.id,
        depth: r.depth + 1,
      });
    }
  }
  return out;
}

function countNodes(nodes: CommentNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1 + countNodes(node.replies);
  }
  return n;
}

function insertNode(
  tree: CommentNode[],
  newNode: CommentNode,
  parentId: string | null,
): CommentNode[] {
  if (!parentId) {
    return [newNode, ...tree];
  }
  return tree.map(n => {
    if (n.id === parentId) {
      return { ...n, replies: [newNode, ...n.replies] };
    }
    if (n.replies.length === 0) { return n; }
    return { ...n, replies: insertNode(n.replies, newNode, parentId) };
  });
}

function replaceNode(tree: CommentNode[], tempId: string, replacement: CommentNode): CommentNode[] {
  return tree.map(n => {
    if (n.id === tempId) {
      return { ...replacement, replies: n.replies };
    }
    if (n.replies.length === 0) { return n; }
    return { ...n, replies: replaceNode(n.replies, tempId, replacement) };
  });
}

function pruneNode(tree: CommentNode[], idToRemove: string): { tree: CommentNode[]; removed: number } {
  let removed = 0;
  const out: CommentNode[] = [];
  for (const n of tree) {
    if (n.id === idToRemove) {
      removed += 1 + countNodes(n.replies);
      continue;
    }
    const result = pruneNode(n.replies, idToRemove);
    removed += result.removed;
    out.push({ ...n, replies: result.tree });
  }
  return { tree: out, removed };
}

function updateLikeCount(tree: CommentNode[], id: string, likeCount: number): CommentNode[] {
  return tree.map(n => {
    if (n.id === id) {
      return { ...n, likeCount };
    }
    if (n.replies.length === 0) { return n; }
    return { ...n, replies: updateLikeCount(n.replies, id, likeCount) };
  });
}

function setLikedByMe(tree: CommentNode[], id: string, likedByMe: boolean, deltaCount: number): CommentNode[] {
  return tree.map(n => {
    if (n.id === id) {
      return { ...n, likedByMe, likeCount: Math.max(n.likeCount + deltaCount, 0) };
    }
    if (n.replies.length === 0) { return n; }
    return { ...n, replies: setLikedByMe(n.replies, id, likedByMe, deltaCount) };
  });
}

export default function CommentsSheet({
  visible,
  postId,
  onClose,
  onCommentsCountChange,
  highlightCommentId,
}: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();

  const [viewerId, setViewerId] = useState<string>('');
  const [nodes, setNodes] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState('');
  const [caret, setCaret] = useState(0);
  const [replyingTo, setReplyingTo] = useState<CommentNode | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<CommentNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CommentNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Remembers the deep-link highlight id we've already handled for the current
  // open of the sheet — keeps the scroll+pulse from re-firing on every render.
  const deepLinkFiredFor = useRef<string | null>(null);
  const composerInputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<FlatRow>>(null);
  const insets = useSafeAreaInsets();

  // Resolve viewer id once per sheet open.
  useEffect(() => {
    if (!visible) { return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        setViewerId(data?.user?.id ?? '');
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Initial fetch + realtime subscription per open postId.
  useEffect(() => {
    if (!visible || !postId) { return; }
    let cancelled = false;
    setLoading(true);
    setNodes([]);
    (async () => {
      try {
        const tree = await fetchPostComments(postId, 100);
        if (!cancelled) {
          setNodes(tree);
        }
      } catch (e) {
        if (!cancelled) {
          showToast(friendlyErrorMessage(e, "Couldn't load comments."), { kind: 'error' });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    subscribeToPostComments(postId, {
      onInsert: node => {
        setNodes(prev => insertNode(prev, node, node.parentCommentId));
        flashHighlight(node.id);
        onCommentsCountChange?.(1);
      },
      onDelete: id => {
        setNodes(prev => {
          const { tree, removed } = pruneNode(prev, id);
          if (removed > 0) {
            onCommentsCountChange?.(-removed);
          }
          return tree;
        });
      },
      onLikeCountChange: (id, likeCount) => {
        setNodes(prev => updateLikeCount(prev, id, likeCount));
      },
    });

    return () => {
      cancelled = true;
      if (postId) {
        unsubscribeFromPostComments(postId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, postId]);

  // Clear state when the sheet closes.
  useEffect(() => {
    if (visible) { return; }
    setComposer('');
    setCaret(0);
    setReplyingTo(null);
    setHighlightIds(new Set());
    for (const t of highlightTimers.current.values()) { clearTimeout(t); }
    highlightTimers.current.clear();
    deepLinkFiredFor.current = null;
  }, [visible]);

  // When the user taps Reply, scroll the parent comment to the top of the
  // visible area so both it and the inline composer (one row below) stay
  // visible above the keyboard, then focus the input.
  const scrollReplyIntoView = useCallback(() => {
    if (!replyingTo) { return; }
    // Find the index of the parent comment in the rendered rows. The composer
    // row will be immediately after it.
    const rendered = withComposerRow(flattenTree(nodes), replyingTo);
    const idx = rendered.findIndex(r => r.kind === 'comment' && r.node.id === replyingTo.id);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
    }
  }, [replyingTo, nodes]);

  useEffect(() => {
    if (!replyingTo) { return; }
    const t = setTimeout(() => {
      scrollReplyIntoView();
      composerInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [replyingTo, scrollReplyIntoView]);

  // Re-scroll after the keyboard finishes opening — the FlatList's visible
  // area shrinks at that moment, so the parent row we scrolled to may have
  // moved out of view.
  useEffect(() => {
    if (!replyingTo) { return; }
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(scrollReplyIntoView, 50);
    });
    return () => sub.remove();
  }, [replyingTo, scrollReplyIntoView]);

  const flashHighlight = useCallback((id: string) => {
    setHighlightIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = highlightTimers.current.get(id);
    if (existing) { clearTimeout(existing); }
    const t = setTimeout(() => {
      setHighlightIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      highlightTimers.current.delete(id);
    }, HIGHLIGHT_MS);
    highlightTimers.current.set(id, t);
  }, []);

  // Deep-link arrival from ActivityCenter: when the sheet opens with a target
  // commentId, locate it in the loaded tree, scroll it into view, and pulse.
  // Guarded by a ref so the effect only fires once per (open, id) — re-runs
  // from re-renders of `nodes` won't re-trigger.
  useEffect(() => {
    if (!visible || !highlightCommentId) { return; }
    if (loading) { return; }
    if (deepLinkFiredFor.current === highlightCommentId) { return; }
    const flat = flattenTree(nodes);
    const idx = flat.findIndex(r => r.kind === 'comment' && r.node.id === highlightCommentId);
    if (idx < 0) { return; }  // not in the loaded set — bail silently
    deepLinkFiredFor.current = highlightCommentId;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      flashHighlight(highlightCommentId);
    }, 200);
  }, [visible, loading, nodes, highlightCommentId, flashHighlight]);

  const handleSend = useCallback(async () => {
    if (!postId) { return; }
    const trimmed = composer.trim();
    if (!trimmed || sending) { return; }
    const parentId = replyingTo?.id ?? null;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: CommentNode = {
      id: tempId,
      postId,
      authorId: viewerId,
      author: { id: viewerId, username: 'you', displayName: 'You', avatarUrl: null },
      body: trimmed,
      parentCommentId: parentId,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      replies: [],
    };
    setNodes(prev => insertNode(prev, optimistic, parentId));
    setComposer('');
    setReplyingTo(null);
    setSending(true);
    onCommentsCountChange?.(1);
    try {
      const saved = await createComment(postId, trimmed, parentId);
      setNodes(prev => replaceNode(prev, tempId, saved));
    } catch (e) {
      // Revert optimistic insert
      setNodes(prev => pruneNode(prev, tempId).tree);
      onCommentsCountChange?.(-1);
      showToast(friendlyErrorMessage(e, "Couldn't post your comment."), { kind: 'error' });
    } finally {
      setSending(false);
    }
  }, [composer, postId, replyingTo, sending, viewerId, onCommentsCountChange, showToast]);

  const handleToggleLike = useCallback(async (node: CommentNode) => {
    const wasLiked = node.likedByMe;
    setNodes(prev => setLikedByMe(prev, node.id, !wasLiked, wasLiked ? -1 : 1));
    try {
      const nowLiked = await toggleCommentLike(node.id);
      if (nowLiked !== !wasLiked) {
        // Server diverged — sync back.
        setNodes(prev => setLikedByMe(prev, node.id, nowLiked, nowLiked ? 1 : -1));
      }
    } catch (e) {
      setNodes(prev => setLikedByMe(prev, node.id, wasLiked, wasLiked ? 1 : -1));
      showToast(friendlyErrorMessage(e, "Couldn't update your like."), { kind: 'error' });
    }
  }, [showToast]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) { return; }
    setDeleting(true);
    try {
      const target = confirmDelete;
      const { tree, removed } = pruneNode(nodes, target.id);
      setNodes(tree);
      onCommentsCountChange?.(-removed);
      await deleteComment(target.id);
      setConfirmDelete(null);
    } catch (e) {
      showToast(friendlyErrorMessage(e, "Couldn't delete the comment."), { kind: 'error' });
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, nodes, onCommentsCountChange, showToast]);

  const handleMentionPress = useCallback(async (username: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase())
        .maybeSingle();
      if (error || !data) {
        showToast(`Couldn't find @${username}.`, { kind: 'error' });
        return;
      }
      onClose();
      navigation.navigate('UserProfile', { userId: data.id as string });
    } catch {
      showToast(`Couldn't open @${username}.`, { kind: 'error' });
    }
  }, [navigation, onClose, showToast]);

  const handleAvatarPress = useCallback((userId: string) => {
    onClose();
    navigation.navigate('UserProfile', { userId });
  }, [navigation, onClose]);

  // Composer change with mention trigger detection.
  const handleComposerChange = useCallback((text: string) => {
    setComposer(text);
  }, []);

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const end = e.nativeEvent.selection.end;
      setCaret(end);
    },
    [],
  );

  const mentionTrigger = useMemo(
    () => detectMentionTrigger(composer, caret),
    [composer, caret],
  );

  const handleMentionSelect = useCallback((profile: MentionProfile) => {
    if (!mentionTrigger) { return; }
    const before = composer.slice(0, mentionTrigger.start);
    const after = composer.slice(caret);
    const insertion = `@${profile.username} `;
    const next = `${before}${insertion}${after}`;
    setComposer(next);
    const newCaret = before.length + insertion.length;
    setCaret(newCaret);
  }, [composer, caret, mentionTrigger]);

  const rows = useMemo(
    () => withComposerRow(flattenTree(nodes), replyingTo),
    [nodes, replyingTo],
  );

  const renderRow = useCallback(
    ({ item }: { item: FlatRow }) => {
      if (item.kind === 'comment') {
        return (
          <CommentItem
            node={item.node}
            depth={item.depth}
            viewerId={viewerId}
            highlighted={highlightIds.has(item.node.id)}
            onReply={setReplyingTo}
            onDelete={setConfirmDelete}
            onReport={setReportTarget}
            onToggleLike={handleToggleLike}
            onMentionPress={handleMentionPress}
            onAvatarPress={handleAvatarPress}
          />
        );
      }
      // Composer row — inline either at the top of the list (parentId === null)
      // or right under the comment being replied to.
      const isReply = item.parentId !== null;
      const indent = Math.min(item.depth, MAX_INDENT_DEPTH) * 14;
      const onSendPressed = () => {
        handleSend().catch(() => {/* errors already toasted */});
        // After send, the FlatList list will reflow; scroll to the new row's
        // position so the user sees what they just posted.
        if (!isReply) {
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
        }
      };
      return (
        <View style={[styles.composerRow, { paddingLeft: 16 + indent }, isReply && styles.composerRowReply]}>
          {isReply ? (
            <View style={styles.replyContextBar}>
              <Text style={styles.replyContextText} numberOfLines={1}>
                Replying to @{replyingTo?.author.username}
              </Text>
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.replyContextCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.composerInputRow}>
            <FormInput
              ref={composerInputRef}
              value={composer}
              onChangeText={handleComposerChange}
              onSelectionChange={handleSelectionChange}
              placeholder={isReply ? 'Write a reply…' : 'Add a comment…'}
              multiline
              editable={!sending}
              wrapperStyle={styles.composerInputWrap}
              style={styles.composerInput}
            />
            <Button
              label="Send"
              onPress={onSendPressed}
              variant="primary"
              size="md"
              busy={sending}
              disabled={composer.trim().length === 0}
            />
          </View>
          {/* Mention suggestions render directly under the composer so they
              always appear next to the active input — not at a fixed sheet
              location that could be far away or hidden by the keyboard. */}
          <MentionSuggestions
            query={mentionTrigger?.partial ?? null}
            onSelect={handleMentionSelect}
          />
        </View>
      );
    },
    [
      viewerId,
      highlightIds,
      handleToggleLike,
      handleMentionPress,
      handleAvatarPress,
      composer,
      sending,
      replyingTo,
      handleSend,
      handleComposerChange,
      handleSelectionChange,
      mentionTrigger,
      handleMentionSelect,
    ],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Comments</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.purpleLight} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={item => item.key}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + 8 },
              ]}
              renderItem={renderRow}
              ListEmptyComponent={null}
              ListFooterComponent={
                nodes.length === 0 && !loading ? (
                  <View style={styles.emptyHint}>
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptyBody}>Be the first to say something.</Text>
                  </View>
                ) : null
              }
              onScrollToIndexFailed={info => {
                // FlatList hasn't measured all items yet — wait, then retry.
                setTimeout(() => {
                  listRef.current?.scrollToIndex({
                    index: info.index,
                    animated: true,
                    viewPosition: 0,
                  });
                }, 100);
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      <CommentReportModal
        visible={reportTarget !== null}
        commentId={reportTarget?.id ?? null}
        onClose={() => setReportTarget(null)}
      />

      <ConfirmActionModal
        visible={confirmDelete !== null}
        title="Delete comment?"
        message={
          (confirmDelete?.replies.length ?? 0) > 0
            ? 'This will also delete every reply underneath. This cannot be undone.'
            : 'This cannot be undone.'
        }
        confirmLabel="Delete"
        tone="destructive"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '90%',
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    flex: 1,
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingVertical: 4,
  },
  emptyHint: {
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  composerRow: {
    paddingRight: 12,
    paddingVertical: 10,
  },
  composerRowReply: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
    paddingBottom: 12,
  },
  replyContextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  replyContextText: {
    flex: 1,
    color: COLORS.purpleLight,
    fontSize: 12,
    fontWeight: '600',
  },
  replyContextCancel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerInputWrap: {
    flex: 1,
  },
  composerInput: {
    maxHeight: 120,
    paddingVertical: 10,
  },
  sendBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
