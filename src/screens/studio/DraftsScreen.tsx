import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DraftsList, DRAFTS_ON_PHONE_NOTE } from '../../components/DraftsList';
import { Icon } from '../../components/Icon';
import { useMyDrafts } from '../../hooks/useMyDrafts';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';

/**
 * "Drafts" from + Post: every draft on this phone, each with Edit. Upload drafts only in the
 * store app, while the Editor is developer-only (see `useMyDrafts`).
 */
export default function DraftsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { drafts, remove } = useMyDrafts();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerSide} accessibilityLabel="Back" hitSlop={10}>
          <Icon name="back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.title}>Drafts</Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {drafts.length > 0 ? (
          <DraftsList
            drafts={drafts}
            onOpen={d => (d.uploadKind
              ? navigation.push('Upload', { draftId: d.id })
              : navigation.push('Studio', { draftId: d.id }))}
            onDelete={remove}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No drafts yet</Text>
            <Text style={styles.emptyBody}>Save an upload as a draft and it waits here.</Text>
            <Text style={styles.emptyNote}>{DRAFTS_ON_PHONE_NOTE}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  empty: { gap: 8, paddingTop: 24 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  emptyNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
});
