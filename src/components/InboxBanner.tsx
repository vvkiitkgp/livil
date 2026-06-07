import React, { useEffect, useState } from 'react';
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
  listIncomingFriendRequests,
  type IncomingFriendRequest,
} from '../services/relationships';
import {
  activitySummary,
  getActivityUnreadCount,
  listActivity,
} from '../services/activity';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LIVIL_LOGO = require('../assets/livil-logo.png');

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

/**
 * Pinned "Activity" row — the app's in-app notification center, rendered
 * chat-style on tap. Always visible (so history is reachable); shows an unread
 * badge and a live preview of the newest event. Sits just below the friend
 * requests banner. New fans + friend-request outcomes surface here.
 */
export function ActivityBanner({ refreshKey }: { refreshKey: number }) {
  const navigation = useNavigation<Nav>();
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [count, items] = await Promise.all([
          getActivityUnreadCount(),
          listActivity(),
        ]);
        if (!cancelled) {
          setUnread(count);
          setPreview(items[0] ? activitySummary(items[0]) : null);
        }
      } catch {
        // leave previous data
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <TouchableOpacity
      style={styles.banner}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('ActivityCenter')}
    >
      <Image source={LIVIL_LOGO} style={styles.activityAvatar} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>livil Bot</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {preview ?? 'Likes, comments & milestones on your tracks'}
        </Text>
      </View>
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
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
  activityAvatar: { width: 44, height: 44, borderRadius: 22 },
  badge: {
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
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
  body: { flex: 1, gap: 2 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12 },
  chevron: { color: COLORS.purpleLight, fontSize: 24, marginLeft: 4 },
});
