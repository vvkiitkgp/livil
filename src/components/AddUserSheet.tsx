import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
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

  const status = rel.status(userId);
  const handle = profile ? `@${profile.username}` : '';
  const name = profile?.displayName || profile?.username || '';

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.sheet}>
        <View style={styles.grabber} />

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
            <Text style={styles.name} numberOfLines={1}>{name || 'User'}</Text>
            {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {confirm ? (
          <View style={styles.confirmWrap}>
            <Text style={styles.confirmMsg}>{confirm.message}</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={() => setConfirm(null)}
                disabled={busy}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => run(confirm.onConfirm)}
                disabled={busy}
              >
                <Text style={styles.btnPrimaryText}>{confirm.confirmLabel}</Text>
              </TouchableOpacity>
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
          })
        )}

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={busy}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
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
};

function renderActions(p: ActionsProps) {
  if (p.status === 'me') {
    return <Text style={styles.muted}>This is you.</Text>;
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
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={p.onAddFriend}
          disabled={p.busy}
        >
          {p.busy
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.btnPrimaryText}>Accept Friend Request</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={p.onRejectRequest}
          disabled={p.busy}
        >
          <Text style={styles.btnSecondaryText}>Decline</Text>
        </TouchableOpacity>
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
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={p.onAddFriend}
          disabled={p.busy}
        >
          <Text style={styles.btnPrimaryText}>Add as Friend</Text>
        </TouchableOpacity>
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
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary]}
        onPress={p.onAddFriend}
        disabled={p.busy}
      >
        {p.busy
          ? <ActivityIndicator color={COLORS.white} />
          : <Text style={styles.btnPrimaryText}>Add as Friend</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={p.onAddStar}
        disabled={p.busy}
      >
        <Text style={styles.btnSecondaryText}>Add as Star</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  headerText: { flex: 1 },
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
  btnPrimary: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnPrimaryText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: COLORS.border,
  },
  btnSecondaryText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  btnDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: COLORS.errorBorder,
  },
  btnDangerText: { color: COLORS.error, fontSize: 15, fontWeight: '600' },
  confirmWrap: { gap: 12 },
  confirmMsg: { color: COLORS.white, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10 },
  closeBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  closeBtnText: { color: COLORS.textSecondary, fontSize: 14 },
});
