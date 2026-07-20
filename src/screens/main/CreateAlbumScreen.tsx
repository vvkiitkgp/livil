import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import { createAlbum, addTrackToAlbum, fetchUploaderAvailableTracks, type UploaderTrackOption } from '../../services/albums';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateAlbum'>;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

function TrackPickRow({
  item, index, selected, onToggle,
}: {
  item: UploaderTrackOption;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initial = item.title.trim().charAt(0).toUpperCase() || '♪';
  return (
    <View style={styles.pickRow}>
      <View style={[styles.cover, { backgroundColor: accents[0] }]}>
        <View style={[styles.coverAccent, { backgroundColor: accents[1] }]} />
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.coverInitial}>{initial}</Text>
        )}
      </View>
      <View style={styles.pickMeta}>
        <Text style={styles.pickTitle} numberOfLines={1}>{item.title}</Text>
      </View>
      <TouchableOpacity
        style={[styles.addBtn, selected && styles.addBtnSelected]}
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        {selected ? <GradientBorder borderRadius={16} /> : null}
        <Icon name={selected ? 'check' : 'add'} size={16} color={selected ? COLORS.purpleNeon : COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

export default function CreateAlbumScreen({ route }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const initialTrackId = route.params?.initialTrackId;

  const [name, setName] = useState('');
  const [tracks, setTracks] = useState<UploaderTrackOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialTrackId ? new Set([initialTrackId]) : new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchUploaderAvailableTracks()
      .then(data => { if (!cancelled) { setTracks(data); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback((trackId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) { next.delete(trackId); } else { next.add(trackId); }
      return next;
    });
  }, []);

  const canCreate = name.trim().length > 0;

  const handleCreate = useCallback(async () => {
    if (!canCreate || creating) { return; }
    setCreating(true);
    try {
      const { id } = await createAlbum({ title: name.trim() });
      // Insert in selection order. addTrackToAlbum picks the next position
      // sequentially via nextAlbumPosition, so a serial loop is correct here.
      for (const trackId of selectedIds) {
        await addTrackToAlbum(id, trackId);
      }
      navigation.replace('AlbumDetail', { albumId: id, albumTitle: name.trim() });
    } catch {
      // TODO: surface error toast
    } finally {
      setCreating(false);
    }
  }, [canCreate, creating, name, selectedIds, navigation]);

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<UploaderTrackOption>) => (
    <TrackPickRow
      item={item}
      index={index}
      selected={selectedIds.has(item.trackId)}
      onToggle={() => toggle(item.trackId)}
    />
  ), [selectedIds, toggle]);

  const ListHeader = (
    <View>
      <View style={styles.nameSection}>
        <Text style={styles.label}>Album name</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Demo EP"
          placeholderTextColor={COLORS.textMuted}
          autoFocus
          returnKeyType="done"
          maxLength={120}
        />
      </View>
      <View style={styles.suggHeader}>
        <Text style={styles.suggHeaderTitle}>Add your tracks</Text>
        {selectedIds.size > 0 && (
          <Text style={styles.suggHeaderCount}>{selectedIds.size} selected</Text>
        )}
      </View>
      {loading && <ActivityIndicator color={COLORS.purpleLight} style={{ marginTop: 20 }} />}
      {!loading && tracks.length === 0 && (
        <Text style={styles.noSugg}>
          You don't have any untagged uploads. Upload a track first — it'll appear here ready to add.
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New album</Text>
        <Button
          label="Create"
          onPress={handleCreate}
          variant="primary"
          size="sm"
          disabled={!canCreate}
          busy={creating}
          style={styles.createBtn}
        />
      </View>

      <FlatList
        data={loading ? [] : tracks}
        keyExtractor={item => item.trackId}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={{ paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
  createBtn: { minWidth: 68 },

  nameSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  nameInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: COLORS.white, fontSize: 17, fontWeight: '600',
  },

  suggHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10 },
  suggHeaderTitle: { color: COLORS.white, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  suggHeaderCount: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '600' },
  noSugg: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingTop: 8 },

  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 20 },
  cover: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  coverAccent: { position: 'absolute', width: 40, height: 40, borderRadius: 20, bottom: -14, right: -14, opacity: 0.65 },
  coverInitial: { color: COLORS.white, fontSize: 20, fontWeight: '900' },
  pickMeta: { flex: 1, minWidth: 0 },
  pickTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },

  addBtn: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: COLORS.surface,
  },
  addBtnSelected: {
    borderColor: 'transparent',
  },
});
