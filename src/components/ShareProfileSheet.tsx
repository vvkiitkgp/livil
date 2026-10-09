import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { profileShareUrl } from '../constants/links';
import {
  sendToFriends,
  shareProfileLink,
  shareProfileToConversations,
  type ShareableProfile,
} from '../services/share';
import { Button } from './Button';
import { FriendPickerStrip } from './FriendPickerStrip';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';

/**
 * The Share sheet for a profile — your own (the "Share profile" button) or someone
 * else's (their ⋯ menu).
 *
 * Same two halves as `SharePostSheet`, in the same order: friends first, then everywhere
 * else. The link itself is printed in the middle, selectable, because the main reason to
 * share your own profile is to paste it into an Instagram bio — and long-press-to-copy on
 * a visible link needs no clipboard library (adding one is a native dependency, and so a
 * store release, for something the OS share sheet's own "Copy" already does).
 */
type Props = {
  visible: boolean;
  profile: ShareableProfile | null;
  /** Your own profile: the share message says "Follow me". */
  isOwn: boolean;
  onClose: () => void;
};

export default function ShareProfileSheet({ visible, profile, isOwn, onClose }: Props) {
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setSharingLink(false);
    }
  }, [visible]);

  const toggle = useCallback((userId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!profile || selected.size === 0 || sending) { return; }
    setSending(true);
    try {
      const { sent, unreachable } = await sendToFriends(
        [...selected],
        conversationIds => shareProfileToConversations(profile, conversationIds),
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
  }, [profile, selected, sending, showToast, onClose]);

  const handleShareLink = useCallback(async () => {
    if (!profile || sharingLink) { return; }
    setSharingLink(true);
    try {
      await shareProfileLink(profile, isOwn);
      onClose();
    } catch {
      showToast("Couldn't share that", { kind: 'error' });
    } finally {
      setSharingLink(false);
    }
  }, [profile, isOwn, sharingLink, showToast, onClose]);

  if (!profile) { return null; }

  // Shown WITH the scheme, because long-press → Copy copies exactly the text shown. The
  // bare `livil-music.com/@you` form is not a link in a Livil chat (the parser requires
  // https), and some apps will not make it tappable either.
  const url = profileShareUrl(profile.username);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.grabber} />
              <Text style={styles.heading}>{isOwn ? 'Share your profile' : 'Share profile'}</Text>
              <Text style={styles.subheading} numberOfLines={1}>
                {profile.displayName?.trim()
                  ? `${profile.displayName.trim()} · @${profile.username}`
                  : `@${profile.username}`}
              </Text>

              <View style={styles.linkPill}>
                <Icon name="link" size={16} color={COLORS.purpleLight} />
                {/* No numberOfLines: a long handle wraps rather than being cut off, so
                    what is copied is always what was seen. */}
                <Text
                  style={styles.linkText}
                  selectable
                  accessibilityLabel={`Profile link, ${url}`}
                >
                  {url}
                </Text>
              </View>
              <Text style={styles.linkHint}>
                {isOwn
                  ? 'Put it in your Instagram bio. Long-press to copy.'
                  : 'Long-press to copy.'}
              </Text>

              <View style={styles.divider} />

              {/* ── Friends ── */}
              <FriendPickerStrip
                visible={visible}
                selected={selected}
                onToggle={toggle}
                emptyText="Add friends to send profiles straight to them."
              />

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
              <Pressable
                style={({ pressed }) => [styles.destRow, pressed && styles.pressed]}
                onPress={() => void handleShareLink()}
                disabled={sharingLink}
                accessibilityRole="button"
                accessibilityLabel="Share link"
              >
                <View style={styles.destIcon}>
                  <GradientBorder borderRadius={999} />
                  {sharingLink ? (
                    <ActivityIndicator size="small" color={COLORS.purpleNeon} />
                  ) : (
                    <Icon name="share" size={18} color={COLORS.purpleNeon} />
                  )}
                </View>
                <View style={styles.destText}>
                  <Text style={styles.destLabel}>Share link</Text>
                  <Text style={styles.destHint}>Instagram, WhatsApp, Copy — anywhere</Text>
                </View>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  linkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  linkText: { flex: 1, color: COLORS.white, fontSize: 14, fontWeight: '600' },
  linkHint: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  pressed: { opacity: 0.6 },
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
