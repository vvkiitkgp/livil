import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Icon } from './Icon';
import { GradientBorder } from './GradientBorder';
import GroupAvatarCluster from './GroupAvatarCluster';
import { LivilBotAvatar } from './LivilBotAvatar';
import type { GroupFace } from '../utils/groupFaces';
import { supabase } from '../../lib/supabase';
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

/** The pinned cards above the chats: friend requests and livil Bot. */
const CARD_RADIUS = 16;


type Nav = NativeStackNavigationProp<RootStackParamList>;

function initial(name: string | null, fallback: string): string {
  const n = (name?.trim() || fallback || '?').trim();
  return (n[0] ?? '?').toUpperCase();
}

/** Same size as the livil Bot logo, so the two pinned cards line up. */
const CARD_AVATAR = 44;

/**
 * Who is asking: one request is that person's photo; two or more are packed into the same
 * bubble cluster a group chat uses, newest request largest — "several people" reads at a
 * glance the way it does for a group, instead of a row of overlapping coins.
 */
function RequestersPicture({ items, seed }: { items: IncomingFriendRequest[]; seed: number }) {
  const faces = useMemo<GroupFace[]>(
    () => [...items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(i => ({
        userId: i.otherUserId,
        username: i.username,
        displayName: i.displayName,
        avatarUrl: i.avatarUrl,
        // The cluster sizes faces by recency; for a request that is when it was sent.
        lastSentAt: i.createdAt,
      })),
    [items],
  );
  if (faces.length >= 2) {
    return (
      <GroupAvatarCluster
        conversationId="friend-requests"
        faces={faces}
        size={CARD_AVATAR}
        visitSeed={seed}
        fallbackLabel="Friend requests"
      />
    );
  }
  const only = items[0];
  return only.avatarUrl ? (
    <Image source={{ uri: only.avatarUrl }} style={styles.single} />
  ) : (
    <View style={[styles.single, styles.singlePlaceholder]}>
      <Text style={styles.singleInitial}>{initial(only.displayName, only.username)}</Text>
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

  // Same card as the livil Bot row below it: Livil's purple outline, and the count in the
  // unread bubble rather than in the title, so the two pinned rows read as one set.
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('FriendRequests')}
      accessibilityRole="button"
      accessibilityLabel={`${count} friend request${count === 1 ? '' : 's'}`}
    >
      <GradientBorder borderRadius={CARD_RADIUS} />
      <RequestersPicture items={items} seed={refreshKey} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          Friend request{count === 1 ? '' : 's'}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>{namesPreview}</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
      </View>
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
  // refetch closure shared between the focus-refresh effect and the realtime
  // subscription — keeps both paths in lock-step without duplicating logic.
  const refetchRef = useRef<() => Promise<void>>(async () => { });

  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      try {
        const [count, items] = await Promise.all([
          getActivityUnreadCount(),
          // Only the preview TEXT is shown here, so skip the per-post lookup.
          listActivity(undefined, { postDetails: false }),
        ]);
        if (!cancelled) {
          setUnread(count);
          setPreview(items[0] ? activitySummary(items[0]) : null);
        }
      } catch {
        // leave previous data
      }
    };
    refetchRef.current = refetch;
    void refetch();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Live updates: any change on activity_notifications for the current user
  // refreshes the badge count and the preview text — so the livil Bot row in
  // the Inbox stays current without backing out of the screen. Subscription
  // is keyed on myId so it tears down + reattaches cleanly if auth changes
  // (sign-in/out across the lifetime of the banner).
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setMyId(data?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!myId) { return; }
    console.log('[realtime] activity-banner subscribing', { myId });
    const channel = supabase
      .channel(`activity-banner:${myId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'activity_notifications',
          filter: `recipient_id=eq.${myId}`,
        },
        (payload) => {
          console.log('[realtime] activity-banner got event', payload.eventType);
          void refetchRef.current();
        },
      )
      .subscribe(status => {
        console.log('[realtime] activity-banner status', status);
      });
    return () => {
      console.log('[realtime] activity-banner unsubscribing');
      void supabase.removeChannel(channel);
    };
  }, [myId]);

  return (
    // Livil's own voice in the inbox, so it wears Livil's purple outline rather than the
    // grey divider the chat rows use. No chevron: the card shape already says "tap me".
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('ActivityCenter')}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `livil Bot, ${unread} new` : 'livil Bot'}
    >
      <GradientBorder borderRadius={CARD_RADIUS} />
      <LivilBotAvatar size={CARD_AVATAR} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>livil Bot</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {preview ?? 'Likes, comments & milestones on your tracks'}
        </Text>
      </View>
      {/* New activity → the count. All caught up → a quiet bell, so the card still says
          what it is (your notifications) rather than ending in empty space. */}
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : (
        <Icon name="bell" size={22} color={COLORS.purpleLight} />
      )}
    </TouchableOpacity>
  );
}


const styles = StyleSheet.create({
  // No `overflow: 'hidden'` (CLAUDE.md): GradientBorder draws inward, and clipping would
  // shave the outer edge of the glow.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderRadius: CARD_RADIUS,
  },
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
  single: { width: CARD_AVATAR, height: CARD_AVATAR, borderRadius: CARD_AVATAR / 2 },
  singlePlaceholder: {
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center', justifyContent: 'center',
  },
  singleInitial: { color: COLORS.purpleLight, fontWeight: '700', fontSize: 17 },
  body: { flex: 1, gap: 2 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12 },
});
