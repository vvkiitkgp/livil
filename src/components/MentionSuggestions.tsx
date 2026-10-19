import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { COLORS } from '../theme/colors';
import UsernameBadges from './UsernameBadges';
import { useRelationships } from '../contexts/RelationshipContext';
import {
  searchUsernamesForMention,
  type MentionProfile,
} from '../services/comments';

type Props = {
  query: string | null;
  onSelect: (profile: MentionProfile) => void;
  /**
   * 'card' for a caption box: a rounded card ABOVE the field, so the keyboard never covers
   * it (a caption sits low on its screen). Comments keep the strip under their box.
   */
  variant?: 'strip' | 'card';
  style?: StyleProp<ViewStyle>;
};

const DEBOUNCE_MS = 200;

export default function MentionSuggestions({ query, onSelect, variant = 'strip', style }: Props) {
  const [results, setResults] = useState<MentionProfile[]>([]);
  const [loading, setLoading] = useState(false);
  // Friends first, as Instagram puts the people you follow first.
  const { status } = useRelationships();
  const statusRef = React.useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (query === null || query.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const list = await searchUsernamesForMention(query, 6, id => statusRef.current(id) === 'friend');
        if (!cancelled) {
          setResults(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  if (query === null || query.length === 0) { return null; }
  if (!loading && results.length === 0) { return null; }

  return (
    <View style={[styles.container, variant === 'card' && styles.card, style]}>
      {loading && results.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.purpleLight} size="small" />
        </View>
      ) : (
        // ScrollView lets the user pan the suggestion list internally without
        // moving the comments FlatList behind it. `nestedScrollEnabled` is the
        // Android opt-in for nested vertical scroll inside a parent scroller.
        // `keyboardShouldPersistTaps="handled"` keeps the keyboard up when the
        // user taps a suggestion (we want to insert, not dismiss).
        <ScrollView
          style={styles.scroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {results.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.row}
              onPress={() => onSelect(p)}
              activeOpacity={0.7}
            >
              {p.avatarUrl ? (
                <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>
                    {(p.displayName || p.username || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.text}>
                <View style={styles.nameLine}>
                  <Text style={[styles.name, styles.nameFlex]} numberOfLines={1}>
                    {p.displayName || p.username}
                  </Text>
                  <UsernameBadges userId={p.id} size={14} />
                </View>
                <Text style={styles.handle} numberOfLines={1}>@{p.username}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  scroll: {
    maxHeight: 240,
  },
  loadingRow: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: COLORS.purpleLight,
    fontWeight: '700',
    fontSize: 13,
  },
  text: {
    flex: 1,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameFlex: { flexShrink: 1 },
  name: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  handle: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
});
