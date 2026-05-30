import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { COLORS } from '../theme/colors';
import { useRelationships } from '../contexts/RelationshipContext';
import {
  getNewFansSummary,
  listIncomingFriendRequests,
  markFansSeen,
  type IncomingFriendRequest,
  type NewFansSummary,
} from '../services/relationships';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function initial(name: string | null, fallback: string): string {
  const n = (name?.trim() || fallback || '?').trim();
  return (n[0] ?? '?').toUpperCase();
}

function AvatarStack({
  items,
}: {
  items: Array<{ avatarUrl: string | null; displayName: string | null; username: string }>;
}) {
  return (
    <View style={styles.stack}>
      {items.slice(0, 3).map((it, i) => (
        <View key={i} style={[styles.stackItem, { left: i * 16, zIndex: 3 - i }]}>
          {it.avatarUrl ? (
            <Image source={{ uri: it.avatarUrl }} style={styles.stackAvatar} />
          ) : (
            <View style={styles.stackPlaceholder}>
              <Text style={styles.stackInitial}>{initial(it.displayName, it.username)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * Pinned banner row for the Inbox. Renders friend requests + new fans.
 * Each variant is null when there's nothing to show.
 */
export function FriendRequestsBanner({ refreshKey }: { refreshKey: number }) {
  const navigation = useNavigation<Nav>();
  const rel = useRelationships();
  const [items, setItems] = useState<IncomingFriendRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listIncomingFriendRequests();
        if (!cancelled) { setItems(list); }
      } catch {
        // leave previous data; banner will hide if empty
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, rel.ready]);

  if (items.length === 0) { return null; }

  const count = items.length;
  const namesPreview = (() => {
    const firstTwo = items.slice(0, 2).map(i => i.displayName?.trim() || `@${i.username}`);
    if (count === 1) { return firstTwo[0]; }
    if (count === 2) { return firstTwo.join(', '); }
    return `${firstTwo.join(', ')} +${count - 2} other${count - 2 === 1 ? '' : 's'}`;
  })();

  return (
    <TouchableOpacity
      style={styles.banner}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('FriendRequests')}
    >
      <AvatarStack items={items.map(i => ({
        avatarUrl: i.avatarUrl,
        displayName: i.displayName,
        username: i.username,
      }))} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {count} friend request{count === 1 ? '' : 's'}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>{namesPreview}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export function NewFansBanner({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<NewFansSummary | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getNewFansSummary();
        if (!cancelled) { setSummary(s); }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleDismiss = useCallback(async () => {
    if (dismissing) { return; }
    setDismissing(true);
    try {
      await markFansSeen();
      setSummary({ count: 0, recent: [] });
    } catch {
      setDismissing(false);
    }
  }, [dismissing]);

  if (!summary || summary.count === 0) { return null; }

  const recent = summary.recent[0];
  const title = summary.count === 1
    ? 'You got a new fan'
    : `+${summary.count} new fans`;
  const subtitle = recent
    ? `${recent.displayName || `@${recent.username}`}${summary.count > 1 ? ' and others' : ''} starred you`
    : 'Tap to dismiss';

  return (
    <TouchableOpacity
      style={[styles.banner, styles.bannerFan]}
      activeOpacity={0.7}
      onPress={handleDismiss}
      disabled={dismissing}
    >
      {recent ? (
        recent.avatarUrl ? (
          <Image source={{ uri: recent.avatarUrl }} style={styles.fanAvatar} />
        ) : (
          <View style={[styles.fanAvatar, styles.fanAvatarPlaceholder]}>
            <Text style={styles.stackInitial}>
              {initial(recent.displayName, recent.username)}
            </Text>
          </View>
        )
      ) : (
        <View style={[styles.fanAvatar, styles.fanAvatarPlaceholder]}>
          <Text style={styles.stackInitial}>★</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  bannerFan: {
    backgroundColor: COLORS.purpleDim,
  },
  stack: { width: 52, height: 36, position: 'relative' },
  stackItem: {
    position: 'absolute', top: 2,
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: COLORS.bg,
    overflow: 'hidden',
  },
  stackAvatar: { width: '100%', height: '100%' },
  stackPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center', justifyContent: 'center',
  },
  stackInitial: { color: COLORS.purpleLight, fontWeight: '700', fontSize: 13 },
  fanAvatar: { width: 36, height: 36, borderRadius: 18 },
  fanAvatarPlaceholder: {
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12 },
  chevron: { color: COLORS.purpleLight, fontSize: 24, marginLeft: 4 },
});
