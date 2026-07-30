import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import {
  getGroupMembers,
  removeGroupMember,
  updateGroupName,
  addGroupMember,
  leaveConversation,
  getConversationDetails,
  type GroupMember,
} from '../../services/conversations';
import { supabase } from '../../../lib/supabase';
import AddBadge from '../../components/AddBadge';
import { Icon } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import FeedEndMessage from '../../components/FeedEndMessage';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { useToast } from '../../contexts/ToastContext';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'GroupInfo'>;

function initials(name: string | null, username: string): string {
  const n = name?.trim() || username;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

type Friend = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

function MemberAvatar({ member, size = 44 }: { member: GroupMember | Friend; size?: number }) {
  const r = size / 2;
  const url = 'avatarUrl' in member ? member.avatarUrl : null;
  const name = 'displayName' in member ? member.displayName : null;
  const uname = member.username;
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: r }} />;
  }
  return (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: r }]}>
      <Text style={styles.avatarText}>{initials(name, uname)}</Text>
    </View>
  );
}

export default function GroupInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { conversationId } = route.params;
  const { showToast } = useToast();

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [myRole, setMyRole] = useState<'admin' | 'member'>('member');
  const [groupName, setGroupName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<GroupMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Add-member picker state
  const [showPicker, setShowPicker] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [friendQuery, setFriendQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? '';
      if (!cancelled) { setMyId(uid); }

      // Fetch conversation name
      const conv = await getConversationDetails(conversationId);
      if (!cancelled && conv) {
        setGroupName(conv.name ?? '');
        setSavedName(conv.name ?? '');
      }

      // Fetch members
      const mems = await getGroupMembers(conversationId);
      if (!cancelled) {
        setMembers(mems);
        setLoading(false);
        const me = mems.find(m => m.userId === uid);
        if (me) { setMyRole(me.role); }
      }
    })();

    return () => { cancelled = true; };
  }, [conversationId]);

  const handleSaveName = useCallback(async () => {
    const trimmed = groupName.trim();
    if (!trimmed || trimmed === savedName) { return; }
    setSaving(true);
    try {
      await updateGroupName(conversationId, trimmed);
      setSavedName(trimmed);
    } catch (err) {
      console.warn('[group] updateGroupName failed', err);
      showToast("Couldn't update group name.", { kind: 'error' });
      setGroupName(savedName);
    } finally {
      setSaving(false);
    }
  }, [groupName, savedName, conversationId, showToast]);

  const handleRemoveMember = useCallback((member: GroupMember) => {
    setRemoveTarget(member);
  }, []);

  const confirmRemoveMember = useCallback(async () => {
    if (!removeTarget) { return; }
    const member = removeTarget;
    setRemovingId(member.userId);
    try {
      await removeGroupMember(conversationId, member.userId);
      setMembers(prev => prev.filter(m => m.userId !== member.userId));
      setRemoveTarget(null);
    } catch (err) {
      console.warn('[group] removeGroupMember failed', err);
      showToast("Couldn't remove member.", { kind: 'error' });
      setRemoveTarget(null);
    } finally {
      setRemovingId(null);
    }
  }, [removeTarget, conversationId, showToast]);

  const handleLeave = useCallback(() => {
    setLeaveOpen(true);
  }, []);

  const confirmLeave = useCallback(async () => {
    setLeaving(true);
    try {
      await leaveConversation(conversationId);
      setLeaveOpen(false);
      navigation.navigate('Inbox');
    } catch (err) {
      console.warn('[group] leaveConversation failed', err);
      showToast("Couldn't leave the group.", { kind: 'error' });
      setLeaving(false);
      setLeaveOpen(false);
    }
  }, [conversationId, navigation, showToast]);

  const loadFriends = useCallback(async () => {
    if (friendsLoading || friends.length > 0) {
      setShowPicker(true);
      return;
    }
    setFriendsLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const me = userData?.user?.id;
    if (!me) { setFriendsLoading(false); return; }

    const { data, error } = await db
      .from('friendships')
      .select(`
        user_a_id, user_b_id,
        profile_a:profiles!friendships_user_a_id_fkey(id, username, display_name, avatar_url),
        profile_b:profiles!friendships_user_b_id_fkey(id, username, display_name, avatar_url)
      `)
      .eq('status', 'accepted')
      .or(`user_a_id.eq.${me},user_b_id.eq.${me}`);

    if (!error) {
      const currentMemberIds = new Set(members.map(m => m.userId));
      const list: Friend[] = (data ?? [])
        .map((row: Record<string, unknown>) => {
          const isA = row.user_a_id === me;
          const p = isA ? row.profile_b as Record<string, unknown> : row.profile_a as Record<string, unknown>;
          return {
            id: p.id as string,
            username: p.username as string,
            displayName: (p.display_name as string | null) ?? null,
            avatarUrl: (p.avatar_url as string | null) ?? null,
          };
        })
        .filter((f: Friend) => !currentMemberIds.has(f.id));

      list.sort((a: Friend, b: Friend) =>
        (a.displayName || a.username).localeCompare(b.displayName || b.username),
      );
      setFriends(list);
    }
    setFriendsLoading(false);
    setShowPicker(true);
  }, [friendsLoading, friends, members]);

  const handleAddMember = useCallback(async (friend: Friend) => {
    setAddingId(friend.id);
    try {
      await addGroupMember(conversationId, friend.id);
      const newMember: GroupMember = {
        userId: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatarUrl: friend.avatarUrl,
        role: 'member',
      };
      setMembers(prev => [...prev, newMember]);
      setFriends(prev => prev.filter(f => f.id !== friend.id));
      setShowPicker(false);
    } catch (err) {
      console.warn('[group] addGroupMember failed', err);
      showToast("Couldn't add member.", { kind: 'error' });
    } finally {
      setAddingId(null);
    }
  }, [conversationId, showToast]);

  const filteredFriends = friendQuery.trim()
    ? friends.filter(f =>
        f.username.toLowerCase().includes(friendQuery.toLowerCase()) ||
        (f.displayName ?? '').toLowerCase().includes(friendQuery.toLowerCase()),
      )
    : friends;

  const renderMember = useCallback(({ item }: { item: GroupMember }) => {
    const isMe = item.userId === myId;
    const canRemove = myRole === 'admin' && !isMe;
    return (
      <View style={styles.memberRow}>
        <MemberAvatar member={item} />
        <View style={styles.memberInfo}>
          <View style={styles.nameRowInline}>
            <Text style={styles.memberName}>{item.displayName || item.username}</Text>
            <AddBadge userId={item.userId} size="sm" />
          </View>
          <Text style={styles.memberUsername}>@{item.username}</Text>
        </View>
        <View style={styles.memberRight}>
          {item.role === 'admin' && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
          {canRemove && (
            removingId === item.userId ? (
              <ActivityIndicator size="small" color={COLORS.error} style={{ marginLeft: 8 }} />
            ) : (
              <TouchableOpacity
                style={styles.removeBtn}
                activeOpacity={0.7}
                onPress={() => handleRemoveMember(item)}
              >
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    );
  }, [myId, myRole, removingId, handleRemoveMember]);

  const renderFriendPickerItem = useCallback(({ item }: { item: Friend }) => (
    <TouchableOpacity
      style={styles.memberRow}
      activeOpacity={0.75}
      onPress={() => void handleAddMember(item)}
      disabled={!!addingId}
    >
      <MemberAvatar member={item} />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{item.displayName || item.username}</Text>
        <Text style={styles.memberUsername}>@{item.username}</Text>
      </View>
      {addingId === item.id && (
        <ActivityIndicator size="small" color={COLORS.purple} />
      )}
    </TouchableOpacity>
  ), [handleAddMember, addingId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      </SafeAreaView>
    );
  }

  // Add-member picker overlay
  if (showPicker) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => { setShowPicker(false); setFriendQuery(''); }}>
            <Icon name="back" size={28} color={COLORS.purple} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Member</Text>
        </View>
        <View style={styles.searchWrap}>
          <FormInput
            value={friendQuery}
            onChangeText={setFriendQuery}
            placeholder="Search friends…"
            placeholderTextColor={COLORS.textMuted}
            autoFocus
          />
        </View>
        {friendsLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.purple} />
          </View>
        ) : (
          <FlatList
            data={filteredFriends}
            keyExtractor={item => item.id}
            renderItem={renderFriendPickerItem}
            contentContainerStyle={
              filteredFriends.length === 0
                ? styles.emptyContent
                : [styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {friendQuery ? 'No matches.' : 'All friends are already in the group.'}
                </Text>
              </View>
            }
            ListFooterComponent={
              filteredFriends.length > 0 ? (
                <FeedEndMessage
                  title="End of the guest list"
                  subtitle="Every friend who isn’t already in the group. Invite away."
                />
              ) : null
            }
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => navigation.goBack()}>
          <Icon name="back" size={28} color={COLORS.purple} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Info</Text>
        {myRole === 'admin' && (
          <TouchableOpacity
            style={[styles.saveBtn, (saving || !groupName.trim() || groupName.trim() === savedName) && styles.saveBtnDisabled]}
            activeOpacity={0.8}
            onPress={() => void handleSaveName()}
            disabled={saving || !groupName.trim() || groupName.trim() === savedName}
          >
            {saving
              ? <ActivityIndicator size="small" color={COLORS.purple} />
              : <Text style={styles.saveBtnText}>Save</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {/* Group name */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>GROUP NAME</Text>
        <View style={styles.nameInputWrap}>
          <FormInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name…"
            placeholderTextColor={COLORS.textMuted}
            editable={myRole === 'admin'}
          />
        </View>
      </View>

      {/* Members list */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>MEMBERS ({members.length})</Text>
        {myRole === 'admin' && (
          <TouchableOpacity
            style={styles.addMemberBtn}
            activeOpacity={0.8}
            onPress={() => void loadFriends()}
          >
            <Text style={styles.addMemberBtnText}>+ Add member</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={members}
        keyExtractor={item => item.userId}
        renderItem={renderMember}
        contentContainerStyle={[styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
        style={styles.memberList}
        ListFooterComponent={
          members.length > 0 ? (
            <FeedEndMessage
              title="Full ensemble"
              subtitle="Everyone in this group. Keep the convo going."
            />
          ) : null
        }
      />

      {/* Leave group */}
      <View style={styles.leaveWrap}>
        <TouchableOpacity
          style={[styles.leaveBtn, leaving && styles.leaveBtnDisabled]}
          activeOpacity={0.8}
          onPress={handleLeave}
          disabled={leaving}
        >
          {leaving
            ? <ActivityIndicator size="small" color={COLORS.error} />
            : <Text style={styles.leaveBtnText}>Leave Group</Text>
          }
        </TouchableOpacity>
      </View>

      <ConfirmActionModal
        visible={!!removeTarget}
        title="Remove member?"
        message={`Remove ${removeTarget?.displayName || removeTarget?.username || 'this member'} from the group?`}
        glyph="−"
        tone="destructive"
        confirmLabel="Remove"
        cancelLabel="Keep in group"
        busy={removingId === removeTarget?.userId}
        onConfirm={confirmRemoveMember}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmActionModal
        visible={leaveOpen}
        title="Leave this group?"
        message="You'll stop receiving messages from this group."
        bullets={[
          'Past messages stay visible only to remaining members',
          'You can be added back by any admin',
        ]}
        glyph="↪"
        tone="destructive"
        confirmLabel="Leave group"
        cancelLabel="Stay in group"
        busy={leaving}
        onConfirm={confirmLeave}
        onCancel={() => setLeaveOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  backButton: { padding: 4, marginRight: 4 },
  headerTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', flex: 1 },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: COLORS.purpleDim, borderWidth: 1, borderColor: COLORS.purple },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '700' },
  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, flex: 1 },
  nameInputWrap: { marginTop: 8 },
  memberList: { flex: 1 },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700' },
  memberInfo: { flex: 1 },
  nameRowInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  memberUsername: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adminBadge: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  adminBadgeText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  removeBtnText: { color: COLORS.error, fontSize: 12, fontWeight: '600' },
  addMemberBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
  },
  addMemberBtnText: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '600' },
  leaveWrap: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
  },
  leaveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  leaveBtnDisabled: { opacity: 0.5 },
  leaveBtnText: { color: COLORS.error, fontSize: 15, fontWeight: '700' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
});
