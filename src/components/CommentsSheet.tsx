import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type FlatList,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import FormInput from './FormInput';
import CommentItem from './CommentItem';
import CommentReportModal from './CommentReportModal';
import ConfirmActionModal from './ConfirmActionModal';
import SheetModal, { SheetFlatList } from './SheetModal';
import MentionSuggestions from './MentionSuggestions';
import { GradientBorder } from './GradientBorder';
import { SpotifyLogo } from './SpotifyLogo';
import { MusicToggleIcon, SongSearchPanel, type PickedSong } from './ChatSongPicker';
import { GifSearchPanel } from './GifPicker';
import { primeCommentSongPost } from './CommentSongCard';
import { gifBox } from './CommentGifCard';
import { OnboardingNoticeHost } from './OnboardingNotice';
import RoundTickButton, { ROUND_TICK_SIZE } from './RoundTickButton';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import {
  composeCommentBody,
  createComment,
  GIF_LABEL,
  deleteComment,
  fetchPostComments,
  gifCommentsSupported,
  songLabelFor,
  subscribeToPostComments,
  toggleCommentLike,
  unsubscribeFromPostComments,
  type CommentGif,
  type CommentNode,
  type CommentSong,
  type MentionProfile,
} from '../services/comments';
import { MAX_GIF_QUERY_LENGTH, prefetchGifs, rememberGif, useGifsEnabled, type Gif } from '../services/gifs';
import { fetchPostById, isPlayableInLivil, type FeedPost } from '../services/posts';
import { toShareablePost } from '../services/share';
import { artistLine, rememberSpotifyTrack, useSpotifyAvailability } from '../services/spotify';
import { detectMentionTrigger } from '../utils/mentions';
import { flattenThread, indentFor, type ThreadPosition } from '../utils/commentThread';
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

/**
 * What is attached to the comment being written — one song or one GIF, never both — as the
 * chip under the box shows it.
 */
type Attachment =
  | {
      kind: 'song';
      song: CommentSong;
      label: string;
      title: string;
      artist: string;
      artUrl: string | null;
    }
  | { kind: 'gif'; gif: Gif };

/** The box is a comment, or a search for something to attach. */
type SearchMode = 'song' | 'gif' | null;

function commentGifOf(gif: Gif): CommentGif {
  return { provider: gif.provider, id: gif.id, width: gif.width, height: gif.height };
}

type FlatRow =
  | { kind: 'comment'; key: string; node: CommentNode; depth: number; thread: ThreadPosition }
  | { kind: 'composer'; key: string; parentId: string | null; depth: number };

const HIGHLIGHT_MS = 1500;
const COMPOSER_KEY = '__composer__';
/**
 * One height for the comment row — the 🎵 button and the box (one line) — so they sit on one
 * centre line. A longer comment grows the box; 🎵 and the ✓ inside it stay at its bottom.
 */
const COMPOSER_ROW_H = 44;
/** FormInput's border, top + bottom. */
const INPUT_BORDER = 3;
/** The attached GIF, inside the box above the words: at most this big. */
const BOX_GIF_MAX = 120;
/**
 * The ✓ / ✕ inside the box: padded to exactly the box's inner height, so on one line it is
 * centred and, as the box grows, it rides the bottom edge (alignSelf: 'flex-end').
 */
const TRAILING_PAD_V = (COMPOSER_ROW_H - INPUT_BORDER - ROUND_TICK_SIZE) / 2;

function flattenTree(nodes: CommentNode[]): FlatRow[] {
  return flattenThread(nodes).map(({ node, position }) => ({
    kind: 'comment',
    key: node.id,
    node,
    depth: position.depth,
    thread: position,
  }));
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

function gifIdsIn(nodes: CommentNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.gif) { out.push(n.gif.id); }
    gifIdsIn(n.replies, out);
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
  // Who owns the post (an upload, or a repost): they may delete any comment on it.
  const [postOwnerId, setPostOwnerId] = useState<string | null>(null);
  // The latest onClose without depending on it: parents pass an inline arrow, and a
  // callback that changes on every parent render (the player re-renders as music plays)
  // would hand every row new props and redraw the whole list each tick.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // A comment's "just now" / "5m" moves on with this clock, twice a minute — rows are
  // memoized (CommentItem), so they no longer redraw for anything else.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) {return;}
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [visible]);
  const [nodes, setNodes] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(false);
  // The list is built only once the open slide has landed: building it during the slide is
  // what made opening stutter. Comments still load in parallel, behind the spinner.
  const [entered, setEntered] = useState(false);
  const showList = !loading && entered;
  const handleEntered = useCallback(() => setEntered(true), []);
  const [composer, setComposer] = useState('');
  const [caret, setCaret] = useState(0);
  const [replyingTo, setReplyingTo] = useState<CommentNode | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<CommentNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CommentNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  // 🎵 song search and GIF search in the comment box (ADR-0027, ADR-0031). Each has its own
  // query, so what was typed is still there after picking; a pick ATTACHES (chip under the
  // box) and the comment goes when Send is tapped, words or not. One attachment at a time:
  // picking a GIF replaces a song, and the other way round.
  const [searchMode, setSearchMode] = useState<SearchMode>(null);
  const songMode = searchMode === 'song';
  const gifMode = searchMode === 'gif';
  const [songQuery, setSongQuery] = useState('');
  const [gifQuery, setGifQuery] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  // A Livil pick may need a lookup first (a repost is attached as its original upload).
  const [attaching, setAttaching] = useState(false);
  const { search: spotifySearchOn } = useSpotifyAvailability();
  // No GIF button until the `gifs` function answers that search is configured, nor once
  // this backend has shown it cannot store a GIF.
  const gifsOn = useGifsEnabled() && gifCommentsSupported();
  // Bumped by every pick, ✕ and close: a Livil song still being looked up attaches only if
  // nothing happened since — otherwise it would replace a GIF picked after it, or turn up
  // attached the next time the sheet opens.
  const pickSeqRef = useRef(0);

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
    setPostOwnerId(null);
    Promise.resolve(supabase.from('posts').select('author_id').eq('id', postId).maybeSingle())
      .then(({ data }) => {
        if (!cancelled) { setPostOwnerId((data?.author_id as string | undefined) ?? null); }
      })
      .catch(() => { /* no owner known: Delete stays on your own comments only */ });
    (async () => {
      try {
        const tree = await fetchPostComments(postId, 100);
        if (!cancelled) {
          // Every GIF in the sheet in one lookup, before the rows mount in batches.
          prefetchGifs(gifIdsIn(tree));
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
    setSearchMode(null);
    setSongQuery('');
    setGifQuery('');
    pickSeqRef.current += 1;
    setAttachment(null);
    setHighlightIds(new Set());
    setEntered(false);
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
    if (!showList) { return; }
    if (deepLinkFiredFor.current === highlightCommentId) { return; }
    const flat = flattenTree(nodes);
    const idx = flat.findIndex(r => r.kind === 'comment' && r.node.id === highlightCommentId);
    if (idx < 0) { return; }  // not in the loaded set — bail silently
    deepLinkFiredFor.current = highlightCommentId;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      flashHighlight(highlightCommentId);
    }, 200);
  }, [visible, showList, nodes, highlightCommentId, flashHighlight]);

  const handleSend = useCallback(async () => {
    if (!postId) { return; }
    const trimmed = composer.trim();
    if ((!trimmed && !attachment) || sending || attaching) { return; }
    const parentId = replyingTo?.id ?? null;
    const song = attachment?.kind === 'song' ? { song: attachment.song, label: attachment.label } : null;
    const gif = attachment?.kind === 'gif' ? commentGifOf(attachment.gif) : null;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: CommentNode = {
      id: tempId,
      postId,
      authorId: viewerId,
      author: { id: viewerId, username: 'you', displayName: 'You', avatarUrl: null },
      body: composeCommentBody(trimmed, song?.label ?? (gif ? GIF_LABEL : null)),
      song: song?.song ?? null,
      songLabel: song?.label ?? null,
      gif,
      parentCommentId: parentId,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      replies: [],
    };
    setNodes(prev => insertNode(prev, optimistic, parentId));
    setComposer('');
    setAttachment(null);
    setReplyingTo(null);
    setSending(true);
    onCommentsCountChange?.(1);
    try {
      const saved = await createComment(postId, trimmed, parentId, song, gif);
      setNodes(prev => replaceNode(prev, tempId, saved));
    } catch (e) {
      // Revert optimistic insert
      setNodes(prev => pruneNode(prev, tempId).tree);
      onCommentsCountChange?.(-1);
      showToast(friendlyErrorMessage(e, "Couldn't post your comment."), { kind: 'error' });
    } finally {
      setSending(false);
    }
  }, [composer, attachment, attaching, postId, replyingTo, sending, viewerId, onCommentsCountChange, showToast]);

  /** 🎵 on: the box becomes a song search, starting from "Recently played". */
  const openSongSearch = useCallback(() => {
    setSongQuery('');
    setSearchMode('song');
    composerInputRef.current?.focus();
  }, []);

  /** GIF on: the box becomes a GIF search, starting from what is trending. */
  const openGifSearch = useCallback(() => {
    setGifQuery('');
    setSearchMode('gif');
    composerInputRef.current?.focus();
  }, []);

  const closeSearch = useCallback(() => setSearchMode(null), []);

  const removeAttachment = useCallback(() => {
    pickSeqRef.current += 1;
    setAttachment(null);
  }, []);

  /** A GIF tapped in the search → attached, and the box goes back to the comment. */
  const handlePickGif = useCallback((gif: Gif) => {
    pickSeqRef.current += 1;
    setAttaching(false);
    setSearchMode(null);
    // Its own comment then draws at once, without a lookup.
    rememberGif(gif);
    setAttachment({ kind: 'gif', gif });
  }, []);

  /**
   * A song tapped in the search → attached, and the box goes back to the comment.
   *
   *   Livil   → by its post, always the ORIGINAL upload: a repost is swapped for the post it
   *             reposts, so the card names the artist (as chat's track_share does).
   *   Spotify → by its track id; its details are kept for the card (rememberSpotifyTrack).
   */
  const handlePickSong = useCallback(async (picked: PickedSong) => {
    const seq = ++pickSeqRef.current;
    setSearchMode(null);
    if (picked.kind === 'spotify') {
      rememberSpotifyTrack(picked.track);
      const artist = artistLine(picked.track);
      setAttachment({
        kind: 'song',
        song: { kind: 'spotify', trackId: picked.track.id },
        label: songLabelFor(picked.track.title, artist),
        title: picked.track.title,
        artist,
        artUrl: picked.track.imageUrl,
      });
      return;
    }
    setAttaching(true);
    try {
      let post: FeedPost | null = picked.kind === 'livil' ? picked.post : await fetchPostById(picked.postId);
      if (post && post.kind === 'repost' && post.originalPostId) {
        post = (await fetchPostById(post.originalPostId)) ?? post;
      }
      if (seq !== pickSeqRef.current) { return; }
      // Still a repost = its original is gone or hidden from us; never attach that.
      if (!post || post.kind === 'repost' || !isPlayableInLivil(post)) {
        showToast('That song is no longer available', { kind: 'info' });
        return;
      }
      const shareable = toShareablePost(post);
      primeCommentSongPost(post);
      setAttachment({
        kind: 'song',
        song: { kind: 'livil', postId: post.id },
        label: songLabelFor(shareable.title, shareable.artistName),
        title: shareable.title,
        artist: shareable.artistName,
        artUrl: shareable.coverArtUrl,
      });
    } catch (e) {
      if (seq === pickSeqRef.current) {
        showToast(friendlyErrorMessage(e, "Couldn't add that song. Please try again."), { kind: 'error' });
      }
    } finally {
      if (seq === pickSeqRef.current) { setAttaching(false); }
    }
  }, [showToast]);

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
    const target = confirmDelete;
    const before = nodes;
    const { tree, removed } = pruneNode(nodes, target.id);
    try {
      setNodes(tree);
      onCommentsCountChange?.(-removed);
      await deleteComment(target.id);
      setConfirmDelete(null);
    } catch (e) {
      // Refused or failed: it is still there, so show it again.
      setNodes(before);
      onCommentsCountChange?.(removed);
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
      onCloseRef.current();
      navigation.navigate('UserProfile', { userId: data.id as string });
    } catch {
      showToast(`Couldn't open @${username}.`, { kind: 'error' });
    }
  }, [navigation, showToast]);

  const handleAvatarPress = useCallback((userId: string) => {
    onCloseRef.current();
    navigation.navigate('UserProfile', { userId });
  }, [navigation]);

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
            thread={item.thread}
            viewerId={viewerId}
            postOwnerId={postOwnerId}
            highlighted={highlightIds.has(item.node.id)}
            now={now}
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
      const indent = indentFor(item.depth);
      // The chip sits under the box, clear of the 🎵 (and GIF) buttons: their width + gap.
      const leadingWidth = (gifsOn ? 2 : 1) * (COMPOSER_ROW_H + 8);
      // A song is a chip under the box; a GIF is drawn inside it (`above`).
      const songChip = attachment?.kind === 'song' ? attachment : null;
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
            {/* 🎵 turns the box into a song search (Livil + Spotify); a tap attaches it. */}
            <TouchableOpacity
              style={[styles.musicBtn, songMode && styles.musicBtnActive]}
              activeOpacity={0.7}
              onPress={songMode ? closeSearch : openSongSearch}
              accessibilityRole="button"
              accessibilityLabel={songMode ? 'Back to your comment' : 'Add a song'}
              accessibilityState={{ selected: songMode }}
            >
              {songMode ? <GradientBorder borderRadius={COMPOSER_ROW_H / 2} /> : null}
              <MusicToggleIcon active={songMode} color={songMode ? COLORS.purpleNeon : COLORS.textSecondary} />
            </TouchableOpacity>
            {/* GIF does the same with GIPHY — only once the `gifs` function says it is on. */}
            {gifsOn ? (
              <TouchableOpacity
                style={[styles.musicBtn, gifMode && styles.musicBtnActive]}
                activeOpacity={0.7}
                onPress={gifMode ? closeSearch : openGifSearch}
                accessibilityRole="button"
                accessibilityLabel={gifMode ? 'Back to your comment' : 'Add a GIF'}
                accessibilityState={{ selected: gifMode }}
                testID="comment-gif-button"
              >
                {gifMode ? <GradientBorder borderRadius={COMPOSER_ROW_H / 2} /> : null}
                <Icon name="gif" size={22} color={gifMode ? COLORS.purpleNeon : COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
            <FormInput
              ref={composerInputRef}
              value={songMode ? songQuery : gifMode ? gifQuery : composer}
              // A search is one line: a pasted newline becomes a space.
              onChangeText={
                songMode
                  ? t => setSongQuery(t.replace(/\n/g, ' ').slice(0, 100))
                  : gifMode
                    ? t => setGifQuery(t.replace(/\n/g, ' ').slice(0, MAX_GIF_QUERY_LENGTH))
                    : handleComposerChange
              }
              onSelectionChange={searchMode ? undefined : handleSelectionChange}
              placeholder={
                songMode
                  ? (spotifySearchOn ? 'Search a song on Livil or Spotify…' : 'Search a song on Livil…')
                  : gifMode
                    ? 'Search GIPHY…'
                    : isReply ? 'Write a reply…' : 'Add a comment…'
              }
              // ALWAYS multiline: on iOS it picks the native view, and swapping it with 🎵
              // dropped the keyboard (as in chat). A search is one line via submitBehavior.
              multiline
              submitBehavior={searchMode ? 'blurAndSubmit' : 'newline'}
              autoCorrect={!searchMode}
              returnKeyType={searchMode ? 'search' : 'default'}
              editable={!sending}
              wrapperStyle={styles.composerInputWrap}
              style={styles.composerInput}
              // The attached GIF, playing, inside the box above the words. Always passed —
              // null when there is none — so the field never changes shape (see FormInput).
              above={
                attachment?.kind === 'gif' && !searchMode ? (
                  <View style={styles.boxGifRow}>
                    <View
                      style={[styles.boxGif, gifBox(attachment.gif.width, attachment.gif.height, BOX_GIF_MAX, BOX_GIF_MAX)]}
                      testID="comment-gif-attachment"
                    >
                      <Image source={{ uri: attachment.gif.url }} style={styles.boxGifImage} resizeMode="cover" />
                      <TouchableOpacity
                        onPress={removeAttachment}
                        style={styles.boxGifRemove}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Remove the GIF"
                      >
                        <Icon name="close" size={12} color={COLORS.white} weight="bold" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null
              }
              // Send is the round ✓ inside the box, as on Upload's "+ Something else" fields.
              // A search swaps it for a ✕ of the same size, so the box never changes width.
              trailing={
                searchMode ? (
                  <TouchableOpacity
                    onPress={closeSearch}
                    activeOpacity={0.7}
                    style={styles.trailingHit}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={gifMode ? 'Close GIF search' : 'Close song search'}
                  >
                    <View style={styles.trailingCircle}>
                      <Icon name="close" size={14} color={COLORS.textSecondary} weight="bold" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <RoundTickButton
                    enabled={(composer.trim().length > 0 || attachment !== null) && !attaching && !sending}
                    onPress={onSendPressed}
                    accessibilityLabel={isReply ? 'Send reply' : 'Send comment'}
                    style={styles.trailingTick}
                  />
                )
              }
            />
          </View>
          {songMode ? (
            // Inline, under the box — the sheet's own list scrolls it.
            <View style={styles.songPanel}>
              <SongSearchPanel
                query={songQuery}
                onPick={picked => { void handlePickSong(picked); }}
                verb="attach"
                scrollable={false}
              />
            </View>
          ) : gifMode ? (
            <View style={styles.songPanel}>
              <GifSearchPanel query={gifQuery} onPick={handlePickGif} />
            </View>
          ) : (
            <>
              {attaching || songChip ? (
                <View style={[styles.attachment, { marginLeft: leadingWidth }]} testID="comment-song-attachment">
                  {songChip?.artUrl ? (
                    <Image source={{ uri: songChip.artUrl }} style={styles.attachmentArt} />
                  ) : (
                    <View style={[styles.attachmentArt, styles.attachmentArtEmpty]}>
                      {attaching
                        ? <ActivityIndicator size="small" color={COLORS.purpleLight} />
                        : <Icon name="musicNote" size={16} color={COLORS.textMuted} />}
                    </View>
                  )}
                  <View style={styles.attachmentText}>
                    <Text style={styles.attachmentTitle} numberOfLines={1}>
                      {songChip?.title ?? 'Adding the song…'}
                    </Text>
                    {songChip ? (
                      <Text style={styles.attachmentArtist} numberOfLines={1}>{songChip.artist}</Text>
                    ) : null}
                  </View>
                  {songChip?.song.kind === 'spotify' ? <SpotifyLogo size="xs" /> : null}
                  {songChip ? (
                    <TouchableOpacity
                      onPress={removeAttachment}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${songChip.title}`}
                    >
                      <Icon name="close" size={18} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              {/* Mention suggestions render directly under the composer so they
                  always appear next to the active input — not at a fixed sheet
                  location that could be far away or hidden by the keyboard. */}
              <MentionSuggestions
                query={mentionTrigger?.partial ?? null}
                onSelect={handleMentionSelect}
              />
            </>
          )}
        </View>
      );
    },
    [
      viewerId,
      postOwnerId,
      highlightIds,
      now,
      handleToggleLike,
      handleMentionPress,
      handleAvatarPress,
      composer,
      sending,
      replyingTo,
      handleSend,
      searchMode,
      songMode,
      gifMode,
      songQuery,
      gifQuery,
      attachment,
      attaching,
      spotifySearchOn,
      gifsOn,
      openSongSearch,
      openGifSearch,
      closeSearch,
      handlePickSong,
      handlePickGif,
      removeAttachment,
      handleComposerChange,
      handleSelectionChange,
      mentionTrigger,
      handleMentionSelect,
    ],
  );

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      keyboardAware
      onEntered={handleEntered}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>Comments</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      }
      outside={
        <>
          {/* The "plays on Spotify" notice for a Spotify song card in a comment. It must be
              presented from inside this sheet: the app's own host, under the open sheet,
              cannot show it on iOS (see OnboardingNotice's `listeners`). */}
          <OnboardingNoticeHost />

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
        </>
      }
    >
      {!showList ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.purpleLight} />
        </View>
      ) : (
        <SheetFlatList
          ref={listRef}
          data={rows}
          keyExtractor={item => item.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
    </SheetModal>
  );
}

const styles = StyleSheet.create({
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
    minHeight: COMPOSER_ROW_H,
  },
  composerInput: {
    maxHeight: 120,
    paddingVertical: 10,
  },
  musicBtn: {
    width: COMPOSER_ROW_H,
    height: COMPOSER_ROW_H,
    borderRadius: COMPOSER_ROW_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // The glow replaces the grey ring while song search is on.
  musicBtnActive: { borderWidth: 0 },
  // Same geometry as RoundTickButton (its padding, a 32 pt ring), for the ✕ in song search.
  trailingHit: { paddingLeft: 8, paddingRight: 10, paddingVertical: TRAILING_PAD_V, alignSelf: 'flex-end' },
  trailingCircle: {
    width: ROUND_TICK_SIZE,
    height: ROUND_TICK_SIZE,
    borderRadius: ROUND_TICK_SIZE / 2,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingTick: { paddingVertical: TRAILING_PAD_V, alignSelf: 'flex-end' },
  songPanel: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    // marginLeft is set inline: under the box, clear of the buttons beside it.
    padding: 6,
    paddingRight: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  // Spotify's rule for its artwork: corners of 4 px at most, nothing drawn on it.
  attachmentArt: { width: 36, height: 36, borderRadius: 4, backgroundColor: COLORS.card },
  attachmentArtEmpty: { alignItems: 'center', justifyContent: 'center' },
  boxGifRow: { paddingTop: 8, paddingHorizontal: 8 },
  boxGif: { borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.card },
  boxGifImage: { width: '100%', height: '100%' },
  // On the GIF's own corner, over whatever it shows: the app's black at ~70%, so the ✕
  // reads on a light GIF as well as a dark one.
  boxGifRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(10, 10, 15, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentText: { flex: 1, minWidth: 0 },
  attachmentTitle: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  attachmentArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  sendBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
