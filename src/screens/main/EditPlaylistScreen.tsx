import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { supabase } from '../../../lib/supabase';
import {
  deletePlaylist,
  updatePlaylist,
  fetchPlaylistPosts,
  removePostFromPlaylist,
  type PlaylistVisibility,
  type PlaylistItem,
} from '../../services/playlists';
import VisibilitySelector from '../../components/VisibilitySelector';
import PlaylistCoverPicker from '../../components/PlaylistCoverPicker';
import ConfirmActionModal from '../../components/ConfirmActionModal';

type Props = NativeStackScreenProps<RootStackParamList, 'EditPlaylist'>;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

export default function EditPlaylistScreen({ route }: Props) {
  const { playlistId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<PlaylistVisibility>('public');
  const [coverEmoji, setCoverEmoji] = useState<string | null>(null);
  const [coverColor, setCoverColor] = useState<string | null>(null);
  const [coverColor2, setCoverColor2] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState('');
  const [originalVisibility, setOriginalVisibility] = useState<PlaylistVisibility>('public');
  const [originalCoverEmoji, setOriginalCoverEmoji] = useState<string | null>(null);
  const [originalCoverColor, setOriginalCoverColor] = useState<string | null>(null);
  const [originalCoverColor2, setOriginalCoverColor2] = useState<string | null>(null);
  const [posts, setPosts] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemovePost, setConfirmRemovePost] = useState<PlaylistItem | null>(null);
  const [removingPostId, setRemovingPostId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [metaRes, postsList] = await Promise.all([
        supabase
          .from('playlists')
          .select('name, visibility, cover_emoji, cover_color, cover_color_2')
          .eq('id', playlistId)
          .maybeSingle(),
        fetchPlaylistPosts(playlistId).catch(() => [] as PlaylistItem[]),
      ]);
      if (cancelled) { return; }
      if (metaRes.data && !metaRes.error) {
        setName(metaRes.data.name);
        setOriginalName(metaRes.data.name);
        setVisibility(metaRes.data.visibility);
        setOriginalVisibility(metaRes.data.visibility);
        setCoverEmoji(metaRes.data.cover_emoji);
        setCoverColor(metaRes.data.cover_color);
        setCoverColor2(metaRes.data.cover_color_2);
        setOriginalCoverEmoji(metaRes.data.cover_emoji);
        setOriginalCoverColor(metaRes.data.cover_color);
        setOriginalCoverColor2(metaRes.data.cover_color_2);
      }
      setPosts(postsList);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [playlistId]);

  const dirty =
    name.trim() !== originalName.trim() ||
    visibility !== originalVisibility ||
    coverEmoji !== originalCoverEmoji ||
    coverColor !== originalCoverColor ||
    coverColor2 !== originalCoverColor2;
  const canSave = name.trim().length > 0 && dirty;

  const handleSave = useCallback(async () => {
    if (!canSave || saving) { return; }
    setSaving(true);
    try {
      await updatePlaylist(playlistId, {
        name: name.trim(),
        visibility,
        coverEmoji,
        coverColor,
        coverColor2,
      });
      navigation.goBack();
    } catch {
      // TODO: surface error toast
    } finally {
      setSaving(false);
    }
  }, [canSave, saving, playlistId, name, visibility, coverEmoji, coverColor, coverColor2, navigation]);

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    try {
      await deletePlaylist(playlistId);
      navigation.popToTop();
    } catch {
      // TODO: surface error toast
    }
  }, [playlistId, navigation]);

  const handleRemovePost = useCallback(async () => {
    const p = confirmRemovePost;
    setConfirmRemovePost(null);
    if (!p) { return; }
    setRemovingPostId(p.postId);
    try {
      await removePostFromPlaylist(playlistId, p.postId);
      setPosts(prev => prev.filter(x => x.postId !== p.postId));
    } catch {
      // TODO: surface error toast
    } finally {
      setRemovingPostId(null);
    }
  }, [confirmRemovePost, playlistId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit playlist</Text>
        <Button
          label="Save"
          onPress={handleSave}
          variant="primary"
          size="sm"
          disabled={!canSave}
          busy={saving}
          style={styles.saveBtn}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="done"
            maxLength={80}
          />

          <Text style={[styles.label, { marginTop: 24 }]}>Cover</Text>
          <PlaylistCoverPicker
            emoji={coverEmoji}
            color={coverColor}
            color2={coverColor2}
            onChange={next => {
              setCoverEmoji(next.emoji);
              setCoverColor(next.color);
              setCoverColor2(next.color2);
            }}
          />

          <Text style={[styles.label, { marginTop: 24 }]}>Visibility</Text>
          <VisibilitySelector value={visibility} onChange={setVisibility} />

          {/* Posts — ✕ removes the post from this playlist; the post itself
              stays on the original poster's profile. */}
          <View style={styles.tracksHeader}>
            <Text style={styles.label}>Posts</Text>
            <Text style={styles.tracksCount}>{posts.length}</Text>
          </View>
          {posts.length === 0 ? (
            <Text style={styles.emptyTracksText}>
              No posts in this playlist yet. Add some from the player using the + button.
            </Text>
          ) : (
            <View style={styles.tracksList}>
              {posts.map((p, idx) => {
                const accents = FALLBACK_ACCENTS[idx % FALLBACK_ACCENTS.length]!;
                const initial = p.title.trim().charAt(0).toUpperCase() || '♪';
                const isRemoving = removingPostId === p.postId;
                return (
                  <View key={p.postId} style={[styles.trackRow, isRemoving && { opacity: 0.5 }]}>
                    <Text style={styles.trackNum}>{idx + 1}</Text>
                    <View style={[styles.trackCover, { backgroundColor: accents[0] }]}>
                      {p.coverArtUrl ? (
                        <Image source={{ uri: p.coverArtUrl }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={styles.trackCoverInitial}>{initial}</Text>
                      )}
                    </View>
                    <View style={styles.trackBody}>
                      <Text style={styles.trackTitle} numberOfLines={1}>{p.title}</Text>
                      <Text style={styles.trackSub} numberOfLines={1}>{p.artistName}</Text>
                    </View>
                    <Pressable
                      onPress={() => setConfirmRemovePost(p)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={isRemoving}
                      style={styles.removeBtn}
                      android_ripple={{ color: COLORS.errorBg, borderless: true }}
                    >
                      {isRemoving
                        ? <ActivityIndicator size="small" color={COLORS.error} />
                        : <Icon name="minusCircle" size={18} color={COLORS.error} weight="bold" />}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => setConfirmDelete(true)}
            activeOpacity={0.7}
          >
            <Icon name="trash" size={16} color={COLORS.error} />
            <Text style={styles.deleteBtnText}>Delete playlist</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <ConfirmActionModal
        visible={confirmDelete}
        title="Delete this playlist?"
        message="The posts inside stay on the original poster's profile — only the playlist is removed."
        confirmLabel="Delete playlist"
        tone="destructive"
        glyph="🗑"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />

      <ConfirmActionModal
        visible={!!confirmRemovePost}
        title="Remove from playlist?"
        message={`"${confirmRemovePost?.title ?? 'This post'}" will leave the playlist. The post stays on the original poster's profile.`}
        confirmLabel="Remove"
        tone="destructive"
        glyph="⊖"
        onCancel={() => setConfirmRemovePost(null)}
        onConfirm={handleRemovePost}
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
  headerTitle: { flex: 1, textAlign: 'center', color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveBtn: { minWidth: 68 },

  body: { paddingHorizontal: 20, paddingTop: 20 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: COLORS.white, fontSize: 16,
  },

  tracksHeader: { flexDirection: 'row', alignItems: 'baseline', marginTop: 28, marginBottom: 10, gap: 8 },
  tracksCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  emptyTracksText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  tracksList: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: 'hidden' },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  trackNum: { width: 16, color: COLORS.textMuted, fontSize: 12, textAlign: 'right' },
  trackCover: {
    width: 40, height: 40, borderRadius: 6, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  trackCoverInitial: { color: COLORS.white, fontSize: 16, fontWeight: '900' },
  trackBody: { flex: 1, minWidth: 0 },
  trackTitle: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  trackSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  removeBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.errorBorder, backgroundColor: COLORS.errorBg,
    alignItems: 'center', justifyContent: 'center',
  },

  deleteBtn: {
    marginTop: 32, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.errorBorder, backgroundColor: COLORS.errorBg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  deleteBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '700' },
});
