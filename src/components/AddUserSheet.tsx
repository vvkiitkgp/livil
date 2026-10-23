import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import UsernameBadges from './UsernameBadges';
import { Button } from './Button';
import SheetModal, { SheetScrollView } from './SheetModal';
import { useRelationships } from '../contexts/RelationshipContext';

type ProfilePreview = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type ConfirmState = null | {
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

export default function AddUserSheet({
  userId,
  visible,
  onClose,
}: {
  userId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const rel = useRelationships();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<ProfilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  useEffect(() => {
    if (!visible) { return; }
    setError('');
    setConfirm(null);
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('username, display_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();
      if (!cancelled && data) {
        setProfile({
          username: (data.username as string | null) ?? '',
          displayName: (data.display_name as string | null) ?? null,
          avatarUrl: (data.avatar_url as string | null) ?? null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [userId, visible]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [onClose]);

  const handleAddFriend = useCallback(() => {
    const s = rel.status(userId);
    if (s === 'pending_incoming') {
      void run(() => rel.acceptFriendRequest(userId));
      return;
    }
    void run(() => rel.sendFriendRequest(userId));
  }, [rel, run, userId]);

  const handleAddStar = useCallback(() => {
    if (rel.status(userId) === 'friend') {
      setConfirm({
        message: `You're already friends with @${profile?.username ?? 'this user'}. Star instead? This will remove the friendship.`,
        confirmLabel: 'Yes, star them',
        onConfirm: async () => {
          await rel.removeFriend(userId);
          await rel.addStar(userId);
        },
      });
      return;
    }
    void run(() => rel.addStar(userId));
  }, [rel, run, userId, profile]);

  const handleCancelRequest = useCallback(
    () => run(() => rel.cancelFriendRequest(userId)),
    [rel, run, userId],
  );
  const handleRejectRequest = useCallback(
    () => run(() => rel.rejectFriendRequest(userId)),
    [rel, run, userId],
  );
  const handleRemoveFriend = useCallback(
    () => run(() => rel.removeFriend(userId)),
    [rel, run, userId],
  );
  const handleRemoveStar = useCallback(
    () => run(() => rel.removeStar(userId)),
    [rel, run, userId],
  );
  const handleUnblock = useCallback(
    () => run(() => rel.unblockUser(userId)),
    [rel, run, userId],
  );

  const status = rel.status(userId);
  const handle = profile ? `@${profile.username}` : '';
  const name = profile?.displayName || profile?.username || '';

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      fit
      style={styles.sheet}
      header={
        <View style={styles.header}>
          {profile?.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {(name || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.headerText}>
            <View style={styles.nameLine}>
              <Text style={[styles.name, styles.nameFlex]} numberOfLines={1}>{name || 'User'}</Text>
              <UsernameBadges userId={userId} size={17} />
            </View>
            {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
          </View>
        </View>
      }
    >
      {/* In the sheet's scroll body, so a drag down anywhere on it closes the sheet. */}
      <SheetScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 28 + insets.bottom }]}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {confirm ? (
          <View style={styles.confirmWrap}>
            <Text style={styles.confirmMsg}>{confirm.message}</Text>
            <View style={styles.confirmRow}>
              <Button
                label="Cancel"
                onPress={() => setConfirm(null)}
                variant="secondary"
                size="md"
                disabled={busy}
                style={styles.confirmBtn}
              />
              <Button
                label={confirm.confirmLabel}
                onPress={() => run(confirm.onConfirm)}
                variant="primary"
                size="md"
                disabled={busy}
                style={styles.confirmBtn}
              />
            </View>
          </View>
        ) : (
          renderActions({
            status,
            busy,
            onAddFriend: handleAddFriend,
            onAddStar: handleAddStar,
            onCancelRequest: handleCancelRequest,
            onRejectRequest: handleRejectRequest,
            onRemoveFriend: handleRemoveFriend,
            onRemoveStar: handleRemoveStar,
            onUnblock: handleUnblock,
          })
        )}

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={busy}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </SheetScrollView>
    </SheetModal>
  );
}

type ActionsProps = {
  status: ReturnType<ReturnType<typeof useRelationships>['status']>;
  busy: boolean;
  onAddFriend: () => void;
  onAddStar: () => void;
  onCancelRequest: () => void;
  onRejectRequest: () => void;
  onRemoveFriend: () => void;
  onRemoveStar: () => void;
  onUnblock: () => void;
};

function renderActions(p: ActionsProps) {
  if (p.status === 'me') {
    return <Text style={styles.muted}>This is you.</Text>;
  }

  // Must come before every other branch. Without it a blocked user falls through
  // to the default "Add Friend / Star" actions, both of which the server refuses
  // — the user would be offered a button that can only produce an error.
  if (p.status === 'blocked') {
    return (
      <View style={styles.actionsCol}>
        <Text style={styles.muted}>You blocked this person.</Text>
        <Button
          label="Unblock"
          onPress={p.onUnblock}
          variant="secondary"
          size="md"
          busy={p.busy}
          fullWidth
        />
      </View>
    );
  }

  if (p.status === 'pending_outgoing') {
    return (
      <View style={styles.actionsCol}>
        <Text style={styles.muted}>Friend request sent.</Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnDanger]}
          onPress={p.onCancelRequest}
          disabled={p.busy}
        >
          <Text style={styles.btnDangerText}>Cancel Request</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (p.status === 'pending_incoming') {
    return (
      <View style={styles.actionsCol}>
        <Text style={styles.muted}>Wants to be friends.</Text>
        <Button
          label="Accept Friend Request"
          onPress={p.onAddFriend}
          variant="primary"
          size="md"
          busy={p.busy}
          fullWidth
        />
        <Button
          label="Decline"
          onPress={p.onRejectRequest}
          variant="secondary"
          size="md"
          disabled={p.busy}
          fullWidth
        />
      </View>
    );
  }

  if (p.status === 'friend') {
    return (
      <View style={styles.actionsCol}>
        <Text style={styles.muted}>You're friends.</Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnDanger]}
          onPress={p.onRemoveFriend}
          disabled={p.busy}
        >
          <Text style={styles.btnDangerText}>Remove Friend</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (p.status === 'star') {
    return (
      <View style={styles.actionsCol}>
        <Text style={styles.muted}>You star this user.</Text>
        <Button
          label="Send friend request"
          onPress={p.onAddFriend}
          variant="primary"
          size="md"
          disabled={p.busy}
          fullWidth
        />
        <TouchableOpacity
          style={[styles.btn, styles.btnDanger]}
          onPress={p.onRemoveStar}
          disabled={p.busy}
        >
          <Text style={styles.btnDangerText}>Remove Star</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // status === 'none'
  return (
    <View style={styles.actionsCol}>
      <Button
        label="Send friend request"
        onPress={p.onAddFriend}
        variant="primary"
        size="md"
        busy={p.busy}
        fullWidth
      />
      <Button
        label="Star the Artist"
        onPress={p.onAddStar}
        variant="secondary"
        size="md"
        disabled={p.busy}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The surface only — height, grabber, backdrop and drag come from SheetModal.
  sheet: { backgroundColor: COLORS.surface },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 18,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1, borderColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.purpleLight, fontWeight: '700', fontSize: 18 },
  headerText: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameFlex: { flexShrink: 1 },
  name: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  handle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  muted: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 8, textAlign: 'center' },
  error: {
    color: COLORS.error, fontSize: 13, marginBottom: 8, textAlign: 'center',
  },
  actionsCol: { gap: 10 },
  btn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: COLORS.errorBorder,
  },
  btnDangerText: { color: COLORS.error, fontSize: 15, fontWeight: '600' },
  confirmWrap: { gap: 12 },
  confirmMsg: { color: COLORS.white, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10 },
  confirmBtn: { flex: 1 },
  closeBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  closeBtnText: { color: COLORS.textSecondary, fontSize: 14 },
});
