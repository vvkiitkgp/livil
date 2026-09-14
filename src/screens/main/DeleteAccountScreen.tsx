import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import FormInput from '../../components/FormInput';
import { SettingsHeader } from '../../components/SettingsHeader';
import { SETTINGS_PAGE_INSET } from '../../components/SettingsSection';
import { FLOATING_PLAYER_HEIGHT } from '../../constants/layout';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useToast } from '../../contexts/ToastContext';
import { deleteMyAccount } from '../../services/profileService';
import { SUPPORT_EMAIL } from '../../constants/links';

/** The word the user must type. Compared case-insensitively after trimming. */
export const DELETE_CONFIRM_WORD = 'DELETE';

/**
 * Everything `deleteMyAccount` removes. Kept in sync with the RPC's cascade —
 * a user is entitled to know exactly what "delete" means before they type it,
 * and Play Store data-deletion policy expects it stated up front.
 */
const DELETED_ITEMS = [
  'Your profile, username, avatar and bio',
  'Every track you have uploaded, with its cover art',
  'Your posts, reposts and stories',
  'Your playlists and albums',
  'Your likes, comments and listening history',
  'Your follows, friends and fans',
  'Your direct message threads, for you and the other person',
  'Your messages in group chats',
];

export default function DeleteAccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const playback = usePlayback();
  const { showToast } = useToast();

  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const canDelete = useMemo(
    () => confirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD,
    [confirmText],
  );

  // No success branch: deleteMyAccount signs out, and RootNavigator swaps the
  // whole signed-in stack for AuthNavigator on SIGNED_OUT — this screen is gone
  // before the promise settles. Only the failure path has anything to update.
  const onDelete = useCallback(async () => {
    if (busy || !canDelete) {
      return;
    }
    setBusy(true);
    playback.pauseAll();
    try {
      await deleteMyAccount();
    } catch (e) {
      setBusy(false);
      showToast(e instanceof Error ? e.message : 'Could not delete your account.', {
        kind: 'error',
      });
    }
  }, [busy, canDelete, playback, showToast]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Delete account" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.danger}>
            <Icon name="warningTriangle" size={34} color={COLORS.error} />
            <Text style={styles.dangerTitle}>This action is permanent</Text>
            <Text style={styles.dangerBody}>
              Deleting your account permanently removes everything you have made
              on Livil. This cannot be undone, and your username cannot be
              claimed again.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>What will be deleted</Text>
          <View style={styles.list}>
            {DELETED_ITEMS.map(item => (
              <View key={item} style={styles.listItem}>
                <View style={styles.bullet} />
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.confirmLabel}>
            Type <Text style={styles.confirmWord}>{DELETE_CONFIRM_WORD}</Text> to
            confirm
          </Text>
          <FormInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={`Type ${DELETE_CONFIRM_WORD} here`}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
            returnKeyType="done"
            accessibilityLabel={`Type ${DELETE_CONFIRM_WORD} to confirm`}
            wrapperStyle={styles.input}
          />

          <Button
            label="Delete my account"
            variant="destructive"
            size="lg"
            fullWidth
            disabled={!canDelete}
            busy={busy}
            onPress={onDelete}
            style={styles.deleteBtn}
          />

          <Text style={styles.help}>
            Having trouble? Contact{'\n'}
            <Text style={styles.helpEmail}>{SUPPORT_EMAIL}</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  body: {
    paddingTop: 8,
    paddingHorizontal: SETTINGS_PAGE_INSET,
  },
  danger: {
    alignItems: 'center',
    gap: 8,
    padding: 20,
    borderRadius: 18,
    backgroundColor: COLORS.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.errorBorder,
    marginBottom: 26,
  },
  dangerTitle: {
    color: COLORS.error,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  dangerBody: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  list: {
    gap: 10,
    marginBottom: 28,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  // A 5px hollow dot is invisible — indicators are exempt from the no-fill rule.
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.error,
    marginTop: 7,
  },
  listText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmLabel: {
    color: COLORS.white,
    fontSize: 14.5,
    fontWeight: '600',
    marginBottom: 10,
  },
  confirmWord: {
    color: COLORS.error,
    fontWeight: '800',
  },
  input: {
    marginBottom: 20,
  },
  deleteBtn: {
    marginBottom: 22,
  },
  help: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
  },
  helpEmail: {
    color: COLORS.textSecondary,
  },
});
