import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { Button } from '../../components/Button';
import { SettingsHeader } from '../../components/SettingsHeader';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import { useRelationships } from '../../contexts/RelationshipContext';
import { useToast } from '../../contexts/ToastContext';
import { listBlockedAccounts, type BlockedAccount } from '../../services/relationships';
import type { RootStackParamList } from '../../navigation/types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * The list of people you have blocked, and the only place you can reliably
 * get back to them.
 *
 * WHY THIS SCREEN HAS TO EXIST. Blocking severs the friendship, so a blocked
 * account leaves every other list in the app — friends, stars, requests. The
 * unblock controls on UserProfileScreen and AddUserSheet only help someone who
 * can still FIND the profile, which means remembering a username they
 * deliberately pushed out of their life. Without this screen, blocking is a
 * one-way door.
 *
 * The list is fetched rather than read from RelationshipContext: the context
 * holds ids, and a screenful of uuids is not something a person can act on.
 */
export default function BlockedAccountsScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const rel = useRelationships();
  const { showToast } = useToast();

  const [items, setItems] = useState<BlockedAccount[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<BlockedAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setItems(await listBlockedAccounts());
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Could not load blocked accounts.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleUnblock = useCallback(async () => {
    if (!confirm) { return; }
    const target = confirm;
    setBusy(true);
    try {
      await rel.unblockUser(target.userId);
      // Drop it locally rather than refetching: the row is gone either way, and
      // a refetch would make the list flicker under the modal's dismissal.
      setItems(prev => (prev ?? []).filter(i => i.userId !== target.userId));
      setConfirm(null);
      showToast(
        target.username ? `Unblocked @${target.username}.` : 'Unblocked.',
        { kind: 'success' },
      );
    } catch {
      showToast("Couldn't unblock. Please try again.", { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [confirm, rel, showToast]);

  const renderItem = useCallback(({ item }: { item: BlockedAccount }) => {
    const name = item.displayName || item.username || 'Unknown';
    return (
      <View style={styles.row}>
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{(name[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {item.username ? (
            <Text style={styles.subtitle} numberOfLines={1}>@{item.username}</Text>
          ) : null}
        </View>
        <Button
          label="Unblock"
          size="sm"
          variant="secondary"
          onPress={() => setConfirm(item)}
        />
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Blocked accounts" onBack={() => navigation.goBack()} />

      {items === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.userId}
          renderItem={renderItem}
          contentContainerStyle={[
            items.length === 0 ? styles.emptyContent : null,
            { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
          ]}
          ListHeaderComponent={
            items.length > 0 ? (
              <Text style={styles.intro}>
                Blocked accounts can't message you, send you a friend request, star
                you or comment on your posts. Their music stays visible on Livil.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {error ? "Couldn't load this" : 'Nobody blocked'}
              </Text>
              <Text style={styles.emptyBody}>
                {error
                  ? error
                  : 'You can block someone from the ⋯ menu on their profile.'}
              </Text>
            </View>
          }
        />
      )}

      <ConfirmActionModal
        visible={confirm !== null}
        title="Unblock this person?"
        message={
          confirm?.username
            ? `@${confirm.username} will be able to message you, send a friend request and comment again.`
            : 'They will be able to message you, send a friend request and comment again.'
        }
        // Said plainly because it is the one thing people assume unblocking undoes.
        bullets={['Your friendship and stars are not restored']}
        glyph="🔓"
        tone="primary"
        confirmLabel="Unblock"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={handleUnblock}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContent: { flexGrow: 1 },
  intro: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.purpleLight, fontWeight: '700', fontSize: 18 },
  body: { flex: 1, minWidth: 0 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
