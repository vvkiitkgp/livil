import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, StackActions, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import UsernameBadges from '../../components/UsernameBadges';
import FormInput from '../../components/FormInput';
import { haptics } from '../../utils/haptics';
import { listProfileFriends, type ProfileFriend } from '../../services/follows';
import { Icon } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function FriendRow({ item, onPress }: { item: ProfileFriend; onPress: () => void }) {
  const displayName = item.displayName || item.username;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.avatar}>
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitials}>{avatarInitials(displayName)}</Text>
        )}
      </View>
      <View style={styles.meta}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, styles.nameFlex]} numberOfLines={1}>{displayName}</Text>
          <UsernameBadges userId={item.userId} size={15} />
        </View>
        <Text style={styles.sub} numberOfLines={1}>@{item.username}</Text>
      </View>
      <Icon name="forward" size={22} color={COLORS.textMuted} />
    </Pressable>
  );
}

/**
 * Anyone's friends list. Public to every signed-in viewer — with no suggestions
 * graph yet, browsing a friend's friends is how people find each other. Tapping a
 * row opens that profile, where Add Friend lives.
 *
 * The whole list is fetched once and searched client-side: friend lists are small,
 * and filtering locally keeps typing instant with no request per keystroke.
 */
export default function ProfileFriendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ProfileFriends'>>();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<ProfileFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setFriends(await listProfileFriends(params.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load friends.');
    } finally {
      setLoading(false);
    }
  }, [params.userId]);

  useEffect(() => { void load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    haptics.select();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) { return friends; }
    return friends.filter(f =>
      f.username.toLowerCase().includes(q) ||
      (f.displayName ?? '').toLowerCase().includes(q),
    );
  }, [friends, query]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ProfileFriend>) => (
    <FriendRow
      item={item}
      onPress={() => navigation.dispatch(StackActions.push('UserProfile', { userId: item.userId }))}
    />
  ), [navigation]);

  const subtitle = loading
    ? params.username ? `@${params.username}` : null
    : `${params.username ? `@${params.username} · ` : ''}${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Friends</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchWrap}>
        <FormInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.userId}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.list, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.purpleLight}
              colors={[COLORS.purple]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              {friends.length === 0 ? (
                <>
                  <Icon name="friends" size={28} color={COLORS.purpleLight} />
                  <Text style={styles.emptyTitle}>No friends yet</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>No matches</Text>
                  <Text style={styles.emptyBody}>Nobody here matches “{query.trim()}”.</Text>
                </>
              )}
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
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },

  loader: { marginTop: 60 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },

  list: { paddingHorizontal: 16, paddingTop: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  rowPressed: { opacity: 0.6 },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { color: COLORS.purpleLight, fontSize: 15, fontWeight: '700' },

  meta: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameFlex: { flexShrink: 1 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  empty: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
