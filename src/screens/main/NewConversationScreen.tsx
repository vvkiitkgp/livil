import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import { getOrCreateDm } from '../../services/conversations';
import { supabase } from '../../../lib/supabase';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

export default function NewConversationScreen() {
  const navigation = useNavigation<Nav>();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [filtered, setFiltered] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const me = userData?.user?.id;
      if (!me || cancelled) { return; }

      // Fetch accepted friends
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
    if (!lq) {
      setFiltered(friends);
      return;
    }
    setFiltered(
      friends.filter(f =>
        f.username.toLowerCase().includes(lq) ||
        (f.displayName ?? '').toLowerCase().includes(lq),
      ),
    );
  }, [friends]);

  const handleSelectFriend = useCallback(async (friend: Friend) => {
    if (startingId) { return; }
    setStartingId(friend.id);
    try {
      const conversationId = await getOrCreateDm(friend.id);
      navigation.replace('Conversation', {
        conversationId,
        title: friend.displayName || friend.username,
      });
    } catch (err) {
      setStartingId(null);
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? JSON.stringify(err);
      Alert.alert('Could not open chat', msg);
    }
  }, [startingId, navigation]);

  const renderItem = useCallback(({ item }: { item: Friend }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      onPress={() => void handleSelectFriend(item)}
      disabled={!!startingId}
    >
      {item.avatarUrl ? (
        <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>{initials(item.displayName, item.username)}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name}>{item.displayName || item.username}</Text>
        <Text style={styles.username}>@{item.username}</Text>
      </View>
      {startingId === item.id && (
        <ActivityIndicator size="small" color={COLORS.purple} />
      )}
    </TouchableOpacity>
  ), [handleSelectFriend, startingId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Message</Text>
      </View>

      <View style={styles.searchWrap}>
        <FormInput
          value={query}
          onChangeText={handleSearch}
          placeholder="Search friends…"
          placeholderTextColor={COLORS.textMuted}
          autoFocus
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
          renderItem={renderItem}
          contentContainerStyle={
            filtered.length === 0 ? styles.emptyContent : styles.listContent
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {query ? 'No friends match that search.' : 'No friends yet.'}
              </Text>
            </View>
          }
        />
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
  backIcon: { color: COLORS.purple, fontSize: 28, lineHeight: 32 },
  headerTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
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
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
});
