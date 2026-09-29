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
import {
  listProfileFriends,
  listProfileStars,
  listMyFans,
  type ProfilePerson,
} from '../../services/follows';
import { Icon, type IconName } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export type ProfilePeopleKind = 'friends' | 'stars' | 'fans';

const COPY: Record<ProfilePeopleKind, {
  title: string;
  one: string;
  many: string;
  search: string;
  empty: string;
  emptyIcon: IconName;
}> = {
  friends: { title: 'Friends', one: 'friend', many: 'friends', search: 'Search friends…', empty: 'No friends yet', emptyIcon: 'friends' },
  stars:   { title: 'Stars',   one: 'star',   many: 'stars',   search: 'Search stars…',   empty: 'Not starring anyone yet', emptyIcon: 'star' },
  fans:    { title: 'Fans',    one: 'fan',    many: 'fans',    search: 'Search fans…',    empty: 'No fans yet', emptyIcon: 'star' },
};

function fetchList(kind: ProfilePeopleKind, userId: string): Promise<ProfilePerson[]> {
  switch (kind) {
    case 'friends': return listProfileFriends(userId);
    case 'stars': return listProfileStars(userId);
    // Only ever the caller's own — there is no way to list someone else's fans.
    case 'fans': return listMyFans();
  }
}

function PersonRow({ item, onPress }: { item: ProfilePerson; onPress: () => void }) {
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
 * A profile's Friends, Stars, or (own profile only) Fans, with a search box.
 *
 * Friends and Stars are public to every signed-in viewer — with no suggestions
 * graph yet, browsing a friend's friends and the artists they star is how people
 * find each other. Fans are owner-only (product decision 2026-09-30): another
 * person's Fans pill shows a notice instead of navigating here.
 *
 * The whole list is fetched once and searched client-side: these lists are small,
 * and filtering locally keeps typing instant with no request per keystroke.
 */
export default function ProfilePeopleScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ProfilePeople'>>();
  const copy = COPY[params.kind];
  // 'fans' always lists the CALLER's own fans (the RPC takes no user id), so never
  // label it with another person's username.
  const headerUsername = params.kind === 'fans' ? undefined : params.username;
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<ProfilePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const fetchPeople = useCallback(async () => {
    setError('');
    try {
      setPeople(await fetchList(params.kind, params.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${copy.many}.`);
    } finally {
      setLoading(false);
    }
  }, [params.kind, params.userId, copy.many]);

  useEffect(() => { void fetchPeople(); }, [fetchPeople]);

  const handleRefresh = useCallback(async () => {
    haptics.select();
    setRefreshing(true);
    await fetchPeople();
    setRefreshing(false);
  }, [fetchPeople]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) { return people; }
    return people.filter(f =>
      f.username.toLowerCase().includes(q) ||
      (f.displayName ?? '').toLowerCase().includes(q),
    );
  }, [people, query]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ProfilePerson>) => (
    <PersonRow
      item={item}
      onPress={() => navigation.dispatch(StackActions.push('UserProfile', { userId: item.userId }))}
    />
  ), [navigation]);

  const subtitle = loading
    ? headerUsername ? `@${headerUsername}` : null
    : `${headerUsername ? `@${headerUsername} · ` : ''}${people.length} ${people.length === 1 ? copy.one : copy.many}`;

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
          <Text style={styles.headerTitle}>{copy.title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchWrap}>
        <FormInput
          value={query}
          onChangeText={setQuery}
          placeholder={copy.search}
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
              {people.length === 0 ? (
                <>
                  <Icon name={copy.emptyIcon} size={28} color={COLORS.purpleLight} />
                  <Text style={styles.emptyTitle}>{copy.empty}</Text>
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
