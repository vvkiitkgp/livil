import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../../theme/colors';
import { useRelationships } from '../../contexts/RelationshipContext';
import {
  listIncomingFriendRequests,
  type IncomingFriendRequest,
} from '../../services/relationships';

export default function FriendRequestsScreen() {
  const navigation = useNavigation();
  const rel = useRelationships();
  const [items, setItems] = useState<IncomingFriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await listIncomingFriendRequests();
      setItems(list);
    } catch {
      // leave previous
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setBusy = (userId: string, busy: boolean) => {
    setBusyIds(prev => {
      const next = new Set(prev);
      if (busy) { next.add(userId); } else { next.delete(userId); }
      return next;
    });
  };

  const handleAccept = useCallback(async (userId: string) => {
    setBusy(userId, true);
    try {
      await rel.acceptFriendRequest(userId);
      setItems(prev => prev.filter(i => i.otherUserId !== userId));
    } finally {
      setBusy(userId, false);
    }
  }, [rel]);

  const handleDecline = useCallback(async (userId: string) => {
    setBusy(userId, true);
    try {
      await rel.rejectFriendRequest(userId);
      setItems(prev => prev.filter(i => i.otherUserId !== userId));
    } finally {
      setBusy(userId, false);
    }
  }, [rel]);

  const renderItem = useCallback(({ item }: { item: IncomingFriendRequest }) => {
    const busy = busyIds.has(item.otherUserId);
    const name = item.displayName || item.username || 'Unknown';
    return (
      <View style={styles.row}>
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>
              {(name[0] ?? '?').toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            @{item.username} · wants to be friends
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnAccept]}
            onPress={() => handleAccept(item.otherUserId)}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator size="small" color={COLORS.white} />
              : <Text style={styles.btnAcceptText}>Accept</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnDecline]}
            onPress={() => handleDecline(item.otherUserId)}
            disabled={busy}
          >
            <Text style={styles.btnDeclineText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [busyIds, handleAccept, handleDecline]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Friend Requests</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.otherUserId}
          renderItem={renderItem}
          contentContainerStyle={
            items.length === 0 ? styles.emptyContent : styles.listContent
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No pending requests</Text>
              <Text style={styles.emptyBody}>
                When someone adds you as a friend, you'll see them here.
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
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSpacer: { width: 36 },
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
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1, borderColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.purpleLight, fontWeight: '700', fontSize: 18 },
  body: { flex: 1, gap: 2 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    minWidth: 70,
  },
  btnAccept: { backgroundColor: COLORS.purple },
  btnAcceptText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  btnDecline: { borderWidth: 1, borderColor: COLORS.border },
  btnDeclineText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
});
