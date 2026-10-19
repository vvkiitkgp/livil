import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { useToast } from '../contexts/ToastContext';
import { useRelationships } from '../contexts/RelationshipContext';
import { sendToFriends, shareRepostToConversations } from '../services/share';
import type { FeedPost } from '../services/posts';
import { repostLabel } from '../utils/repostShare';
import { resolveAuthorDisplay } from '../utils/authorDisplay';
import { Button } from './Button';
import { FriendPickerStrip } from './FriendPickerStrip';
import SheetModal, { SheetScrollView } from './SheetModal';

/**
 * "Send to friends" for a REPOST (owner, 2026-10-19) — Livil or Spotify.
 *
 * Friends only, no destinations: a repost never gets a public link, an Instagram Story or a
 * card image (`canSharePost` stays uploads-only — see services/share.ts). That is also why
 * this is its own sheet rather than a mode of `SharePostSheet`, which mounts the offscreen
 * Story card for its image rows.
 *
 * The reposter comes first in the strip, labelled, so the song can go straight back to
 * them — when they are a friend; chats are friends-only.
 */
type Props = {
  visible: boolean;
  post: FeedPost | null;
  /** The song's title. A Spotify repost's `post.track` is a placeholder, so the card passes it. */
  songTitle: string;
  onClose: () => void;
};

export default function ShareRepostSheet({ visible, post, songTitle, onClose }: Props) {
  const { showToast } = useToast();
  const { meId } = useRelationships();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) { setSelected(new Set()); }
  }, [visible]);

  const toggle = useCallback((userId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!post || selected.size === 0 || sending) { return; }
    setSending(true);
    try {
      const { sent, unreachable } = await sendToFriends(
        [...selected],
        conversationIds => shareRepostToConversations(post, conversationIds),
      );
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

  if (!post) { return null; }

  const reposter = resolveAuthorDisplay(post.author).name;
  const isMine = !!meId && meId === post.author.id;

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      fit
      keyboardAware
      style={styles.sheet}
      header={
        <View style={styles.header}>
          <Text style={styles.heading}>Send to friends</Text>
          <Text style={styles.subheading} numberOfLines={1}>
            {songTitle.trim() ? `${songTitle} · ` : ''}{repostLabel(reposter, isMine)}
          </Text>
        </View>
      }
    >
      <SheetScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <FriendPickerStrip
          visible={visible}
          selected={selected}
          onToggle={toggle}
          emptyText="Add friends to send reposts straight to them."
          pinned={isMine ? undefined : { userId: post.author.id, label: 'Reposted this' }}
        />
        {selected.size > 0 ? (
          <View style={styles.sendWrap}>
            <Button
              variant="primary"
              size="md"
              busy={sending}
              onPress={() => { void handleSend(); }}
              label={`Send to ${selected.size}`}
            />
          </View>
        ) : null}
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  // The surface only — height, grabber, backdrop and drag come from SheetModal.
  sheet: { backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 16 },
  heading: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  subheading: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 14 },
  // A fit sheet caps at its tall height; past it this body scrolls (SheetModal's `fit`).
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 16 },
  sendWrap: { marginTop: 14 },
});
