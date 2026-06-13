import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import { listPostLikers, type PostLiker } from '../services/posts';

type Props = {
  postId: string;
  likesCount: number;
  /** True when the viewer is one of the likers — used as a fallback label while
   *  the latest-liker fetch is in flight so the row doesn't show "Liked by …". */
  viewerHasLiked: boolean;
  onPress: () => void;
};

/**
 * Instagram-style "Liked by **vvk** and 5 others" row. Lazy-fetches the single
 * most recent liker (the one whose name appears bold). Returns null when
 * `likesCount === 0`. Tapping the row opens the post's `PostLikersSheet`.
 *
 * The latest-liker fetch reruns whenever `likesCount` or `viewerHasLiked`
 * changes — when the viewer toggles their like, the "newest liker" flips
 * between them and whoever was first before, and we need to refresh the bold
 * name to match.
 */
export default function LikedByLine({ postId, likesCount, viewerHasLiked, onPress }: Props) {
  const [latest, setLatest] = useState<PostLiker | null>(null);
  const [viewerId, setViewerId] = useState<string>('');
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) { setViewerId(data?.user?.id ?? ''); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (likesCount === 0) {
      setLatest(null);
      return;
    }
    const myRun = ++runIdRef.current;
    listPostLikers(postId, { limit: 1 })
      .then(rows => {
        if (runIdRef.current !== myRun) { return; }
        setLatest(rows[0] ?? null);
      })
      .catch(() => { /* silent — fall back to the count-only label */ });
  }, [postId, likesCount, viewerHasLiked]);

  if (likesCount === 0) { return null; }

  const latestIsViewer = latest != null && viewerId !== '' && latest.userId === viewerId;
  const nameLabel = !latest
    ? (viewerHasLiked ? 'you' : '…')
    : latestIsViewer
      ? 'you'
      : (latest.displayName?.trim() || `@${latest.username}`);
  const others = Math.max(0, likesCount - 1);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={styles.row}
      accessibilityLabel="See everyone who liked this"
    >
      <Text style={styles.text}>
        Liked by <Text style={styles.name}>{nameLabel}</Text>
        {others > 0 ? (
          <Text style={styles.text}>
            {' and '}
            <Text style={styles.name}>{others} other{others === 1 ? '' : 's'}</Text>
          </Text>
        ) : null}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginTop: 4,
  },
  text: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  name: {
    color: COLORS.white,
    fontWeight: '700',
  },
});
