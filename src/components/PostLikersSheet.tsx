import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { Button } from './Button';
import { useToast } from '../contexts/ToastContext';
import { useRelationships, type RelationshipStatus } from '../contexts/RelationshipContext';
import AddUserSheet from './AddUserSheet';
import { listPostLikers, type PostLiker } from '../services/posts';
import { friendlyErrorMessage } from '../utils/errorMessages';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  visible: boolean;
  postId: string | null;
  onClose: () => void;
};

const PAGE_SIZE = 30;

function avatarInitials(liker: PostLiker): string {
  const name = liker.displayName?.trim() || liker.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

type ChipConf = { label: string; primary: boolean } | null;

function chipFor(status: RelationshipStatus): ChipConf {
  switch (status) {
    case 'me': return null;
    // No chip for someone you have blocked. Every action this chip offers —
    // add, accept, star — is refused by the server for a blocked pair, so
    // offering one would only produce an error the user cannot act on. Their
    // like still shows: blocking hides contact, not content.
    case 'blocked': return null;
    case 'none': return { label: 'Add', primary: true };
    case 'pending_outgoing': return { label: 'Requested', primary: false };
    case 'pending_incoming': return { label: 'Add', primary: true };
    case 'friend': return { label: 'Friends ✓', primary: false };
    case 'star': return { label: 'Starred ✓', primary: false };
  }
}

export default function PostLikersSheet({ visible, postId, onClose }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
  const rel = useRelationships();
  const insets = useSafeAreaInsets();

  const [likers, setLikers] = useState<PostLiker[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  // Ignore late results that arrive after the sheet has been closed or moved
  // to a different post.
  const runIdRef = useRef(0);

  // Initial fetch per open (postId, visible).
  useEffect(() => {
    if (!visible || !postId) { return; }
    const myRun = ++runIdRef.current;
    setLikers([]);
    setEndReached(false);
    setLoading(true);
    (async () => {
      try {
        const page = await listPostLikers(postId, { limit: PAGE_SIZE });
        if (runIdRef.current !== myRun) { return; }
        setLikers(page);
        setEndReached(page.length < PAGE_SIZE);
      } catch (e) {
        if (runIdRef.current !== myRun) { return; }
        showToast(friendlyErrorMessage(e, "Couldn't load likes."), { kind: 'error' });
      } finally {
        if (runIdRef.current === myRun) { setLoading(false); }
      }
    })();
  }, [visible, postId, showToast]);

  // Clear state when the sheet closes so the next open starts fresh.
  useEffect(() => {
    if (visible) { return; }
    runIdRef.current += 1;
    setLikers([]);
    setLoading(false);
    setLoadingMore(false);
    setEndReached(false);
    setActionUserId(null);
  }, [visible]);

  const handleEndReached = useCallback(async () => {
    if (!postId || loadingMore || endReached || likers.length === 0) { return; }
    const last = likers[likers.length - 1]!;
    const myRun = runIdRef.current;
    setLoadingMore(true);
    try {
      const more = await listPostLikers(postId, { limit: PAGE_SIZE, before: last.likedAt });
      if (runIdRef.current !== myRun) { return; }
      if (more.length === 0) {
        setEndReached(true);
      } else {
        const seen = new Set(likers.map(l => l.userId));
        const appended = more.filter(l => !seen.has(l.userId));
        setLikers(prev => [...prev, ...appended]);
        if (more.length < PAGE_SIZE) { setEndReached(true); }
      }
    } catch (e) {
      if (runIdRef.current === myRun) {
        showToast(friendlyErrorMessage(e, "Couldn't load more likes."), { kind: 'error' });
      }
    } finally {
      if (runIdRef.current === myRun) { setLoadingMore(false); }
    }
  }, [postId, loadingMore, endReached, likers, showToast]);

  const handleRowPress = useCallback((userId: string) => {
    onClose();
    navigation.navigate('UserProfile', { userId });
  }, [navigation, onClose]);

  const renderRow = useCallback(({ item }: { item: PostLiker }) => {
    const status = rel.status(item.userId);
    const chip = chipFor(status);
    const initials = avatarInitials(item);
    const displayName = item.displayName?.trim() || `@${item.username}`;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => handleRowPress(item.userId)}
      >
        <View style={styles.avatar}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.handle} numberOfLines={1}>@{item.username}</Text>
        </View>
        {chip ? (
          <Button
            label={chip.label}
            onPress={() => setActionUserId(item.userId)}
            variant={chip.primary ? 'primary' : 'secondary'}
            size="sm"
            style={styles.chip}
          />
        ) : null}
      </TouchableOpacity>
    );
  }, [rel, handleRowPress]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Likes</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.purpleLight} />
            </View>
          ) : likers.length === 0 ? (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyTitle}>No likes yet</Text>
              <Text style={styles.emptyBody}>Be the first to like this post.</Text>
            </View>
          ) : (
            <FlatList
              data={likers}
              keyExtractor={item => item.userId}
              renderItem={renderRow}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + 12 },
              ]}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.footerLoading}>
                    <ActivityIndicator color={COLORS.purpleLight} />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </View>

      {actionUserId !== null && (
        <AddUserSheet
          userId={actionUserId}
          visible={actionUserId !== null}
          onClose={() => setActionUserId(null)}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '75%',
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    flex: 1,
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyHint: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  handle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  chip: {
    minWidth: 80,
  },
  footerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
