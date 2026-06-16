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
import {
  fetchAlbumDetail,
  updateAlbum,
  deleteAlbum,
  removeTrackFromAlbum,
  pickAlbumCoverFromLibrary,
  uploadAlbumCover,
  type AlbumDetail,
  type PickedAlbumCover,
} from '../../services/albums';
import { supabase } from '../../../lib/supabase';
import ConfirmActionModal from '../../components/ConfirmActionModal';

type Props = NativeStackScreenProps<RootStackParamList, 'EditAlbum'>;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#7C3AED', '#3B1E6E'],
  ['#EC4899', '#7C3AED'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

export default function EditAlbumScreen({ route }: Props) {
  const { albumId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [originalDescription, setOriginalDescription] = useState('');
  const [tracks, setTracks] = useState<AlbumDetail['tracks']>([]);
  // Cover state:
  //   'remote' — currently-saved cover from the DB
  //   'local'  — user just picked a new image; URI is local file, not yet uploaded
  //   'removed' — user cleared the saved cover; save → cover_art_url = null
  const [cover, setCover] = useState<
    | { kind: 'remote'; url: string | null }
    | { kind: 'local'; asset: PickedAlbumCover }
    | { kind: 'removed' }
  >({ kind: 'remote', url: null });
  const [originalCoverUrl, setOriginalCoverUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Track id whose remove confirmation is currently shown (or null).
  const [confirmRemoveTrack, setConfirmRemoveTrack] = useState<AlbumDetail['tracks'][number] | null>(null);
  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAlbumDetail(albumId)
      .then(a => {
        if (cancelled) { return; }
        setTitle(a.title);
        setOriginalTitle(a.title);
        setDescription(a.description ?? '');
        setOriginalDescription(a.description ?? '');
        setTracks(a.tracks);
        setCover({ kind: 'remote', url: a.coverArtUrl });
        setOriginalCoverUrl(a.coverArtUrl);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setLoading(false); } });
    return () => { cancelled = true; };
  }, [albumId]);

  const coverDirty =
    cover.kind === 'local' ||
    (cover.kind === 'removed' && originalCoverUrl !== null) ||
    (cover.kind === 'remote' && cover.url !== originalCoverUrl);
  const dirty =
    title.trim() !== originalTitle.trim() ||
    description.trim() !== originalDescription.trim() ||
    coverDirty;
  const canSave = title.trim().length > 0 && dirty;

  const handleSave = useCallback(async () => {
    if (!canSave || saving) { return; }
    setSaving(true);
    try {
      // Resolve next cover URL: upload local pick, or null when removed, or
      // keep the existing remote URL.
      let nextCoverUrl: string | null | undefined = undefined;
      if (cover.kind === 'local') {
        const { data: sess } = await supabase.auth.getSession();
        const { data: userData } = await supabase.auth.getUser();
        const accessToken = sess.session?.access_token;
        const userId = userData?.user?.id;
        if (accessToken && userId) {
          nextCoverUrl = await uploadAlbumCover(userId, cover.asset, accessToken);
        }
      } else if (cover.kind === 'removed') {
        nextCoverUrl = null;
      }
      await updateAlbum(albumId, {
        title: title.trim(),
        description: description.trim(),
        ...(nextCoverUrl !== undefined ? { coverArtUrl: nextCoverUrl } : {}),
      });
      navigation.goBack();
    } catch {
      // TODO: surface error toast
    } finally {
      setSaving(false);
    }
  }, [canSave, saving, albumId, title, description, cover, navigation]);

  const handlePickFromLibrary = useCallback(async () => {
    try {
      const asset = await pickAlbumCoverFromLibrary();
      if (asset) { setCover({ kind: 'local', asset }); }
    } catch (e) {
      console.warn('[album] pickAlbumCoverFromLibrary failed', e);
    }
  }, []);

  const handleRemoveCover = useCallback(() => { setCover({ kind: 'removed' }); }, []);

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    try {
      await deleteAlbum(albumId);
      navigation.popToTop();
    } catch {
      // TODO: surface error toast
    }
  }, [albumId, navigation]);

  const handleRemoveTrack = useCallback(async () => {
    const t = confirmRemoveTrack;
    setConfirmRemoveTrack(null);
    if (!t) { return; }
    setRemovingTrackId(t.trackId);
    try {
      await removeTrackFromAlbum(t.trackId);
      setTracks(prev => prev.filter(x => x.trackId !== t.trackId));
    } catch {
      // TODO: surface error toast
    } finally {
      setRemovingTrackId(null);
    }
  }, [confirmRemoveTrack]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit album</Text>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
          activeOpacity={0.75}
        >
          {saving
            ? <ActivityIndicator size="small" color={COLORS.white} />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cover photo — tap the tile to pick a new one (library only,
              no camera CTA). When no custom cover is set, the tile shows the
              default fallback (first track's art via fetchAlbumDetail). A
              tiny "Remove" link below appears only when a custom cover is
              currently set — removing falls back to the default. */}
          <Text style={styles.label}>Cover photo</Text>
          <View style={styles.coverWrap}>
            <Pressable
              style={styles.coverTile}
              onPress={handlePickFromLibrary}
              android_ripple={{ color: COLORS.purpleDim }}
            >
              {cover.kind === 'local' ? (
                <Image source={{ uri: cover.asset.uri }} style={StyleSheet.absoluteFill} />
              ) : cover.kind === 'remote' && cover.url ? (
                <Image source={{ uri: cover.url }} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Icon name="musicNotes" size={32} color={COLORS.textMuted} />
                </View>
              )}
              <View style={styles.coverOverlayCenter}>
                <View style={styles.coverOverlayChip}>
                  <Icon name="edit" size={12} color={COLORS.white} />
                  <Text style={styles.coverOverlayText}>Change</Text>
                </View>
              </View>
            </Pressable>
            {((cover.kind === 'remote' && cover.url) || cover.kind === 'local') ? (
              <Pressable onPress={handleRemoveCover} hitSlop={6}>
                <Text style={styles.coverRemoveLink}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={[styles.label, { marginTop: 22 }]}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Album title"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="done"
            maxLength={120}
          />

          <Text style={[styles.label, { marginTop: 22 }]}>Description</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Optional"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={1000}
          />

          {/* Tracks — tap the ✕ to remove a track from this album. The
              underlying upload stays on the creator's profile. */}
          <View style={styles.tracksHeader}>
            <Text style={styles.label}>Tracks</Text>
            <Text style={styles.tracksCount}>{tracks.length}</Text>
          </View>
          {tracks.length === 0 ? (
            <Text style={styles.emptyTracksText}>
              No tracks in this album. Add one from the track's overflow menu (⋯ → Add to album).
            </Text>
          ) : (
            <View style={styles.tracksList}>
              {tracks.map((t, idx) => {
                const accents = FALLBACK_ACCENTS[idx % FALLBACK_ACCENTS.length]!;
                const initial = t.title.trim().charAt(0).toUpperCase() || '♪';
                const isRemoving = removingTrackId === t.trackId;
                return (
                  <View key={t.trackId} style={[styles.trackRow, isRemoving && { opacity: 0.5 }]}>
                    <Text style={styles.trackNum}>{idx + 1}</Text>
                    <View style={[styles.trackCover, { backgroundColor: accents[0] }]}>
                      {t.coverArtUrl ? (
                        <Image source={{ uri: t.coverArtUrl }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={styles.trackCoverInitial}>{initial}</Text>
                      )}
                    </View>
                    <View style={styles.trackBody}>
                      <Text style={styles.trackTitle} numberOfLines={1}>{t.title}</Text>
                    </View>
                    <Pressable
                      onPress={() => setConfirmRemoveTrack(t)}
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
            <Text style={styles.deleteBtnText}>Delete album</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <ConfirmActionModal
        visible={confirmDelete}
        title="Delete this album?"
        message="Tracks stay on your profile — only the album grouping is removed."
        confirmLabel="Delete album"
        tone="destructive"
        glyph="🗑"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />

      <ConfirmActionModal
        visible={!!confirmRemoveTrack}
        title="Remove from album?"
        message={`"${confirmRemoveTrack?.title ?? 'This track'}" will leave the album. The upload stays on your profile.`}
        confirmLabel="Remove"
        tone="destructive"
        glyph="⊖"
        onCancel={() => setConfirmRemoveTrack(null)}
        onConfirm={handleRemoveTrack}
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
  saveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.purple, minWidth: 68, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.purple, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.45, shadowRadius: 6, elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.35, shadowOpacity: 0 },
  saveBtnText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },

  body: { paddingHorizontal: 20, paddingTop: 20 },
  coverWrap: { alignItems: 'center', gap: 8 },
  coverTile: {
    width: 160, height: 160, borderRadius: 14, overflow: 'hidden',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    position: 'relative',
    alignItems: 'center', justifyContent: 'center',
  },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Centered chip overlay so the "Change" affordance reads as an inline edit
  // hint regardless of whether there's an image behind it.
  coverOverlayCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  coverOverlayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  coverOverlayText: { color: COLORS.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  coverRemoveLink: { color: COLORS.error, fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: COLORS.white, fontSize: 16,
  },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },

  tracksHeader: { flexDirection: 'row', alignItems: 'baseline', marginTop: 26, marginBottom: 10, gap: 8 },
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
