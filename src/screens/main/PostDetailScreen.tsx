import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { Icon } from '../../components/Icon';
import PostCard from '../../components/PostCard';
import CommentsSheet from '../../components/CommentsSheet';
import PostLikersSheet from '../../components/PostLikersSheet';
import { fetchPostById, type FeedPost } from '../../services/posts';

type Props = NativeStackScreenProps<RootStackParamList, 'PostDetail'>;

/**
 * One post on its own page — where a notification about a post lands.
 *
 * Replaces "open the owner's profile and try to scroll to it", which silently showed the
 * wrong post whenever the target was on the other profile tab or older than the first
 * page: the profile opened, the scroll found nothing, and whatever post sat at the top
 * (often another post of the same song) read as the one that was tapped.
 *
 * Arrival intent is one-shot, like Instagram's post notifications: `openComments` opens
 * the comments with `highlightCommentId` pulsed, `openLikers` opens the likes list. Both
 * wait for the post to load so the sheet opens over the post it belongs to, and neither
 * re-fires on refresh.
 */
export default function PostDetailScreen({ navigation, route }: Props) {
  const { postId, openComments, highlightCommentId, openLikers } = route.params;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [commentsDelta, setCommentsDelta] = useState(0);
  // A ref, not state: flipping state re-ran the effect below, whose cleanup cancelled
  // the very timer that was about to open the sheet — so it never opened.
  const arrivalHandledRef = useRef(false);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (arrivalTimerRef.current) { clearTimeout(arrivalTimerRef.current); }
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const found = await fetchPostById(postId);
      setPost(found);
      setMissing(found === null);
      setCommentsDelta(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this post.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { void load(); }, [load]);

  // One-shot arrival intent. The short delay lets the push animation settle first, so
  // the sheet slides up over a page that is already there.
  useEffect(() => {
    if (arrivalHandledRef.current || !post) { return; }
    arrivalHandledRef.current = true;
    if (!openComments && !openLikers) { return; }
    arrivalTimerRef.current = setTimeout(() => {
      if (openComments) { setCommentsOpen(true); }
      else if (openLikers && post.likesCount > 0) { setLikersOpen(true); }
    }, 350);
  }, [post, openComments, openLikers]);

  const handleRefresh = useCallback(async () => {
    haptics.select();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleDeleted = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const shown = post
    ? { ...post, commentsCount: Math.max(post.commentsCount + commentsDelta, 0) }
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back"
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Post</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={styles.loader} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.purpleLight}
              colors={[COLORS.purple]}
            />
          }
        >
          {shown ? (
            <PostCard
              post={shown}
              onCommentsPress={() => setCommentsOpen(true)}
              onDeleted={handleDeleted}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {missing ? 'This post isn’t available' : 'Couldn’t load this post'}
              </Text>
              <Text style={styles.emptyBody}>
                {missing
                  ? 'It may have been deleted, or you no longer have access to it.'
                  : error || 'Pull down to try again.'}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <CommentsSheet
        visible={commentsOpen && post !== null}
        postId={commentsOpen ? postId : null}
        onClose={() => setCommentsOpen(false)}
        onCommentsCountChange={delta => setCommentsDelta(d => d + delta)}
        highlightCommentId={openComments ? highlightCommentId ?? null : null}
      />
      <PostLikersSheet
        visible={likersOpen}
        postId={likersOpen ? postId : null}
        onClose={() => setLikersOpen(false)}
      />
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

  loader: { marginTop: 60 },
  content: { paddingTop: 8, paddingBottom: 120 },

  empty: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
