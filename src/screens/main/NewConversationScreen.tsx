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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import { getOrCreateDm, createGroup } from '../../services/conversations';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import FeedEndMessage from '../../components/FeedEndMessage';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'dm' | 'group';

type Friend = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

function initials(name: string | null, username: string): string {
  const n = name?.trim() || username;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function Avatar({ friend, size = 48 }: { friend: Friend; size?: number }) {
  const r = size / 2;
  if (friend.avatarUrl) {
    return <Image source={{ uri: friend.avatarUrl }} style={{ width: size, height: size, borderRadius: r }} />;
  }
  return (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: r }]}>
      <Text style={styles.avatarText}>{initials(friend.displayName, friend.username)}</Text>
    </View>
  );
}

export default function NewConversationScreen() {
  const { showToast } = useToast();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('dm');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [filtered, setFiltered] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // DM state
  const [startingId, setStartingId] = useState<string | null>(null);

  // Group state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const me = userData?.user?.id;
      if (!me || cancelled) { return; }

      const { data, error } = await supabase
        .from('friendships')
        .select(`
          user_a_id, user_b_id,
          profile_a:profiles!friendships_user_a_id_fkey(id, username, display_name, avatar_url),
          profile_b:profiles!friendships_user_b_id_fkey(id, username, display_name, avatar_url)
        `)
        .eq('status', 'accepted')
        .or(`user_a_id.eq.${me},user_b_id.eq.${me}`);

      if (cancelled || error) { return; }

      const list: Friend[] = (data ?? []).map((row: Record<string, unknown>) => {
        const isA = row.user_a_id === me;
        const p = isA ? row.profile_b as Record<string, unknown> : row.profile_a as Record<string, unknown>;
        return {
          id: p.id as string,
          username: p.username as string,
          displayName: (p.display_name as string | null) ?? null,
          avatarUrl: (p.avatar_url as string | null) ?? null,
        };
      });

      list.sort((a, b) =>
        (a.displayName || a.username).localeCompare(b.displayName || b.username),
      );

      if (!cancelled) {
        setFriends(list);
        setFiltered(list);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    const lq = q.toLowerCase().trim();
    setFiltered(
      lq
        ? friends.filter(f =>
            f.username.toLowerCase().includes(lq) ||
            (f.displayName ?? '').toLowerCase().includes(lq),
          )
        : friends,
    );
  }, [friends]);

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    setQuery('');
    setFiltered(friends);
    setSelected(new Set());
    setGroupName('');
  }, [friends]);

  // DM: tap → open conversation immediately
  const handleSelectFriend = useCallback(async (friend: Friend) => {
    if (startingId) { return; }
    setStartingId(friend.id);
    try {
      const conversationId = await getOrCreateDm(friend.id);
      navigation.replace('Conversation', {
        conversationId,
        title: friend.displayName || friend.username,
        kind: 'dm',
      });
    } catch (err) {
      console.warn('[chat] getOrCreateDm failed', err);
      setStartingId(null);
      showToast("Couldn't open chat. Please try again.", { kind: 'error' });
    }
  }, [startingId, navigation, showToast]);

  // Group: tap → toggle selection
  const handleToggleSelect = useCallback((friend: Friend) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(friend.id)) {
        next.delete(friend.id);
      } else {
        next.add(friend.id);
      }
      return next;
    });
  }, []);

  const handleCreateGroup = useCallback(async () => {
    const name = groupName.trim();
    if (!name) {
      showToast('Enter a group name.', { kind: 'info' });
      return;
    }
    if (selected.size < 1) {
      showToast('Select at least one friend.', { kind: 'info' });
      return;
    }
    setCreating(true);
    try {
      const conversationId = await createGroup(name, Array.from(selected));
      navigation.replace('Conversation', {
        conversationId,
        title: name,
        kind: 'group',
      });
    } catch (err) {
      console.warn('[chat] createGroup failed', err);
      showToast("Couldn't create group. Please try again.", { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }, [groupName, selected, navigation, showToast]);

  const renderDmItem = useCallback(({ item }: { item: Friend }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      onPress={() => void handleSelectFriend(item)}
      disabled={!!startingId}
    >
      <Avatar friend={item} />
      <View style={styles.info}>
        <Text style={styles.name}>{item.displayName || item.username}</Text>
        <Text style={styles.username}>@{item.username}</Text>
      </View>
      {startingId === item.id && (
        <ActivityIndicator size="small" color={COLORS.purple} />
      )}
    </TouchableOpacity>
  ), [handleSelectFriend, startingId]);

  const renderGroupItem = useCallback(({ item }: { item: Friend }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.75}
        onPress={() => handleToggleSelect(item)}
      >
        <Avatar friend={item} />
        <View style={styles.info}>
          <Text style={styles.name}>{item.displayName || item.username}</Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Icon name="check" size={14} color={COLORS.white} />}
        </View>
      </TouchableOpacity>
    );
  }, [selected, handleToggleSelect]);

  const selectedFriends = friends.filter(f => selected.has(f.id));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Icon name="back" size={28} color={COLORS.purple} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Message</Text>
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={styles.tabBtn}
          onPress={() => handleTabChange('dm')}
          activeOpacity={0.8}
        >
          {tab === 'dm' ? <GradientBorder borderRadius={8} /> : null}
          <Text style={[styles.tabLabel, tab === 'dm' && styles.tabLabelActive]}>
            Direct Message
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabBtn}
          onPress={() => handleTabChange('group')}
          activeOpacity={0.8}
        >
          {tab === 'group' ? <GradientBorder borderRadius={8} /> : null}
          <Text style={[styles.tabLabel, tab === 'group' && styles.tabLabelActive]}>
            New Group
          </Text>
        </TouchableOpacity>
      </View>

      {/* Group name input (group tab only) */}
      {tab === 'group' && (
        <View style={styles.groupNameWrap}>
          <FormInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name…"
            placeholderTextColor={COLORS.textMuted}
            autoFocus
          />
        </View>
      )}

      {/* Selected members strip (group tab, when some selected) */}
      {tab === 'group' && selectedFriends.length > 0 && (
        <View style={styles.selectedStrip}>
          {selectedFriends.map(f => (
            <TouchableOpacity
              key={f.id}
              style={styles.selectedChip}
              onPress={() => handleToggleSelect(f)}
              activeOpacity={0.7}
            >
              <Avatar friend={f} size={28} />
              <Text style={styles.selectedChipName} numberOfLines={1}>
                {f.displayName || f.username}
              </Text>
              <Icon name="close" size={16} color={COLORS.purpleLight} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <FormInput
          value={query}
          onChangeText={handleSearch}
          placeholder={tab === 'dm' ? 'Search friends…' : 'Search friends to add…'}
          placeholderTextColor={COLORS.textMuted}
          autoFocus={tab === 'dm'}
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={tab === 'dm' ? renderDmItem : renderGroupItem}
          contentContainerStyle={
            filtered.length === 0
              ? styles.emptyContent
              : [styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {query ? 'No friends match that search.' : 'No friends yet.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            filtered.length > 0 ? (
              <FeedEndMessage
                title={tab === 'group' ? 'That’s the whole band' : 'Your whole crew'}
                subtitle={
                  tab === 'group'
                    ? 'Every friend you can invite. Add more pals to grow the lineup.'
                    : 'Every friend you can DM. Make more friends to keep the rotation fresh.'
                }
              />
            ) : null
          }
        />
      )}

      {/* Create group button */}
      {tab === 'group' && (
        <View style={styles.createBtnWrap}>
          <Button
            label={`Create Group${selected.size > 0 ? ` · ${selected.size} member${selected.size > 1 ? 's' : ''}` : ''}`}
            onPress={() => void handleCreateGroup()}
            variant="primary"
            size="md"
            fullWidth
            disabled={selected.size === 0 || !groupName.trim()}
            busy={creating}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backButton: { padding: 4, marginRight: 4 },
  headerTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tabLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.purpleNeon },
  groupNameWrap: { paddingHorizontal: 16, paddingTop: 10 },
  selectedStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
    maxWidth: 150,
  },
  selectedChipName: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '600', flex: 1 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.purpleLight, fontSize: 15, fontWeight: '700' },
  info: { flex: 1 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  username: { color: COLORS.textSecondary, fontSize: 13, marginTop: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
  createBtnWrap: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 8,
  },
});
