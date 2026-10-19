import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { listFriends, type FriendRef } from '../services/relationships';
import { listConversations } from '../services/conversations';
import { orderByRecentChat } from '../utils/friendOrder';
import FormInput from './FormInput';
import { Icon } from './Icon';

/**
 * The "send to friends" half of a share sheet: a horizontal strip of friend avatars you
 * tap to select. Shared by `SharePostSheet` (a song) and `ShareProfileSheet` (a person),
 * so sending anything to friends looks and behaves the same.
 *
 * Friends come in chat order — whoever you messaged most recently first, as in the inbox.
 *
 * Owns loading the friend list and the search query; the SELECTION is the parent's,
 * because the parent's Send button is what acts on it. Loads when `visible` turns on and
 * clears its query when it turns off — mounted for the life of the sheet, like the sheet.
 */
type Props = {
  visible: boolean;
  selected: Set<string>;
  onToggle: (userId: string) => void;
  /** Shown when the viewer has no friends yet — say what sending would have done. */
  emptyText: string;
  /**
   * A friend to put FIRST, with a line under their name — the reposter when a repost is
   * being sent ("Reposted this"), so it can go straight back to them. Ignored when they
   * are not a friend: a DM needs a friendship (20260809030000).
   */
  pinned?: { userId: string; label: string };
};

/**
 * Search is shown only past a handful of friends. Below that the strip is faster to
 * scan than a text field is to type into, and an empty search box over four avatars
 * is furniture.
 */
const SEARCH_THRESHOLD = 6;

function initials(name: string | null, username: string): string {
  const n = name?.trim() || username;
  return (n[0] ?? '♪').toUpperCase();
}

export function FriendPickerStrip({ visible, selected, onToggle, emptyText, pinned }: Props) {
  const [friends, setFriends] = useState<FriendRef[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) {
      setQuery('');
      return;
    }
    let cancelled = false;
    setLoadingFriends(true);
    // In chat order, most recent first (friendOrder.ts). The chat list is only for ordering:
    // when it fails, the friends still show, alphabetically.
    Promise.all([listFriends(), listConversations().catch(() => [])])
      .then(([rows, chats]) => { if (!cancelled) { setFriends(orderByRecentChat(rows, chats)); } })
      .catch(() => { if (!cancelled) { setFriends([]); } })
      .finally(() => { if (!cancelled) { setLoadingFriends(false); } });
    return () => { cancelled = true; };
  }, [visible]);

  /**
   * Matches display name AND username, because people search for whichever they know —
   * "Bipasa" and "bipasa_b" have to find the same person. Selected friends are never
   * filtered out: narrowing the query would otherwise silently drop someone you had
   * already picked, and "Send to 3" would send to one.
   */
  const q = query.trim().toLowerCase();
  const pinnedId = pinned?.userId;
  const ordered = pinnedId && friends.some(f => f.id === pinnedId)
    ? [...friends.filter(f => f.id === pinnedId), ...friends.filter(f => f.id !== pinnedId)]
    : friends;
  const visibleFriends = q
    ? ordered.filter(
        f =>
          selected.has(f.id) ||
          (f.displayName ?? '').toLowerCase().includes(q) ||
          f.username.toLowerCase().includes(q),
      )
    : ordered;

  if (loadingFriends) {
    return (
      <View style={styles.friendsLoading}>
        <ActivityIndicator color={COLORS.purpleNeon} />
      </View>
    );
  }

  if (friends.length === 0) {
    return <Text style={styles.emptyFriends}>{emptyText}</Text>;
  }

  return (
    <>
      {friends.length > SEARCH_THRESHOLD ? (
        <FormInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          wrapperStyle={styles.search}
        />
      ) : null}
      <FlatList
        horizontal
        data={visibleFriends}
        keyExtractor={f => f.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.friendsRow}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isOn = selected.has(item.id);
          return (
            <Pressable
              style={({ pressed }) => [styles.friend, pressed && styles.pressed]}
              onPress={() => onToggle(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isOn }}
              accessibilityLabel={`Send to ${item.displayName || item.username}`}
            >
              <View style={styles.friendAvatarWrap}>
                {item.avatarUrl ? (
                  <Image source={{ uri: item.avatarUrl }} style={styles.friendAvatar} />
                ) : (
                  <View style={[styles.friendAvatar, styles.friendAvatarFallback]}>
                    <Text style={styles.friendInitial}>
                      {initials(item.displayName, item.username)}
                    </Text>
                  </View>
                )}
                {isOn ? (
                  <View style={styles.check}>
                    <Icon name="check" size={12} color={COLORS.white} weight="bold" />
                  </View>
                ) : null}
              </View>
              <Text style={styles.friendName} numberOfLines={1}>
                {item.displayName || item.username}
              </Text>
              {item.id === pinnedId ? (
                <Text style={styles.pinnedLabel} numberOfLines={1}>{pinned!.label}</Text>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.emptyFriends}>No friends match “{query}”.</Text>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  friendsLoading: { height: 92, alignItems: 'center', justifyContent: 'center' },
  emptyFriends: { color: COLORS.textSecondary, fontSize: 13, paddingVertical: 18 },
  friendsRow: { paddingVertical: 4, gap: 14 },
  friend: { width: 64, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  friendAvatarWrap: { width: 52, height: 52 },
  friendAvatar: { width: 52, height: 52, borderRadius: 26 },
  friendAvatarFallback: {
    backgroundColor: COLORS.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInitial: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  // A 16px dot: solid fill is correct here, per the small-indicator exemption to the
  // no-solid-purple rule. An outlined check at this size reads as unchecked.
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  friendName: { color: COLORS.textSecondary, fontSize: 11, marginTop: 6, textAlign: 'center' },
  pinnedLabel: { color: COLORS.purpleLight, fontSize: 10, marginTop: 1, textAlign: 'center' },
  search: { marginBottom: 12 },
});
