import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import SheetModal, { SheetScrollView } from './SheetModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { addTrackToAlbum, fetchAlbumsByUser, type AlbumSummary } from '../services/albums';
import type { RootStackParamList } from '../navigation/types';

type PickedAlbum = { id: string; title: string; coverArtUrl: string | null };

type Props =
  | {
      visible: boolean;
      mode?: 'tag';
      trackId: string;
      onClose: () => void;
      onAdded?: (albumId: string) => void;
    }
  | {
      // Picker mode — no DB write. Used by the Upload flow to choose an album
      // BEFORE the track exists yet (the parent does the tagging after the
      // track is created).
      visible: boolean;
      mode: 'pick';
      onClose: () => void;
      onPicked: (album: PickedAlbum) => void;
    };

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

export default function AddToAlbumSheet(props: Props) {
  const { visible, onClose } = props;
  const mode = props.mode ?? 'tag';
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) { return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user?.id;
      if (!me) { setAlbums([]); setLoading(false); return; }
      const list = await fetchAlbumsByUser(me).catch(() => [] as AlbumSummary[]);
      if (cancelled) { return; }
      setAlbums(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const handleNewAlbum = useCallback(() => {
    onClose();
    if (mode === 'tag') {
      navigation.navigate('CreateAlbum', { initialTrackId: (props as { trackId: string }).trackId });
    } else {
      // Picker mode: open the create flow with no pre-selected track. The
      // upload flow can't auto-pick the new album (the user navigates away)
      // — that's the documented limitation; users can tag from the track
      // overflow afterwards.
      navigation.navigate('CreateAlbum');
    }
  }, [navigation, onClose, mode, props]);

  const handlePickAlbum = useCallback(async (album: AlbumSummary) => {
    if (busy) { return; }
    if (mode === 'pick') {
      (props as { onPicked: (a: PickedAlbum) => void }).onPicked({
        id: album.id, title: album.title, coverArtUrl: album.coverArtUrl,
      });
      onClose();
      return;
    }
    setBusy(album.id);
    try {
      await addTrackToAlbum(album.id, (props as { trackId: string }).trackId);
      (props as { onAdded?: (id: string) => void }).onAdded?.(album.id);
      onClose();
    } catch {
      // TODO: surface toast
    } finally {
      setBusy(null);
    }
  }, [busy, mode, props, onClose]);

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      header={<Text style={styles.title}>Add to album</Text>}
    >
      <SheetScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}>
        <Pressable style={styles.newRow} onPress={handleNewAlbum} android_ripple={{ color: COLORS.purpleDim }}>
          <View style={styles.newRowIconBox}>
            <Icon name="add" size={18} color={COLORS.purpleLight} />
          </View>
          <Text style={styles.newRowText}>New album</Text>
          <Icon name="forward" size={16} color={COLORS.textSecondary} />
        </Pressable>

        {loading ? (
          <ActivityIndicator color={COLORS.purpleLight} style={styles.loader} />
        ) : albums.length === 0 ? (
          <Text style={styles.emptyText}>
            No albums yet. Tap "New album" to start one with this track.
          </Text>
        ) : (
          <>
            {albums.map((a, idx) => {
              const accents = FALLBACK_ACCENTS[idx % FALLBACK_ACCENTS.length]!;
              const initial = a.title.trim().charAt(0).toUpperCase() || '♪';
              const isBusy = busy === a.id;
              return (
                <Pressable
                  key={a.id}
                  style={[styles.albumRow, isBusy && styles.albumRowBusy]}
                  onPress={() => handlePickAlbum(a)}
                  disabled={!!busy}
                  android_ripple={{ color: COLORS.purpleDim }}
                >
                  <View style={[styles.cover, { backgroundColor: accents[0] }]}>
                    <View style={[styles.coverAccent, { backgroundColor: accents[1] }]} />
                    {a.coverArtUrl ? (
                      <Image source={{ uri: a.coverArtUrl }} style={StyleSheet.absoluteFill} />
                    ) : (
                      <Text style={styles.coverInitial}>{initial}</Text>
                    )}
                  </View>
                  <View style={styles.meta}>
                    <Text style={styles.albumTitle} numberOfLines={1}>{a.title}</Text>
                    <Text style={styles.albumSub}>
                      {a.trackCount} {a.trackCount === 1 ? 'track' : 'tracks'}
                    </Text>
                  </View>
                  {isBusy
                    ? <ActivityIndicator size="small" color={COLORS.purpleLight} />
                    : <Icon name="forward" size={16} color={COLORS.textSecondary} />}
                </Pressable>
              );
            })}
          </>
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  title: { color: COLORS.white, fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  loader: { marginVertical: 30 },

  newRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 22, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  newRowIconBox: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: COLORS.purpleDim,
    alignItems: 'center', justifyContent: 'center',
  },
  newRowText: { flex: 1, color: COLORS.purpleLight, fontSize: 14, fontWeight: '700' },

  albumRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 10 },
  albumRowBusy: { opacity: 0.6 },
  cover: {
    width: 40, height: 40, borderRadius: 8, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  coverAccent: { position: 'absolute', width: 32, height: 32, borderRadius: 16, bottom: -10, right: -10, opacity: 0.65 },
  coverInitial: { color: COLORS.white, fontSize: 16, fontWeight: '900' },
  meta: { flex: 1, minWidth: 0 },
  albumTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  albumSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },

  emptyText: { color: COLORS.textMuted, fontSize: 13, paddingHorizontal: 28, paddingVertical: 18, textAlign: 'center', lineHeight: 18 },

  cancelBtn: { marginTop: 8, paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
