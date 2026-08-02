import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { SettingsRow } from '../../components/SettingsRow';
import { SettingsSection } from '../../components/SettingsSection';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { usePlayback } from '../../contexts/PlaybackContext';
import { supabase } from '../../../lib/supabase';

export default function AccountSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const playback = usePlayback();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  // No navigation reset after signOut: RootNavigator swaps the whole signed-in
  // stack for AuthNavigator on SIGNED_OUT, so this screen unmounts itself.
  const confirmSignOut = useCallback(async () => {
    if (signOutBusy) { return; }
    setSignOutBusy(true);
    playback.pauseAll();
    await supabase.auth.signOut();
    setSignOutBusy(false);
    setSignOutOpen(false);
  }, [playback, signOutBusy]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Account settings</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <SettingsSection>
          <SettingsRow
            label="Edit profile"
            onPress={() => navigation.navigate('EditProfile')}
          />
          <SettingsRow
            label="Sign out"
            chevron={false}
            onPress={() => setSignOutOpen(true)}
          />
          {/* LIV-74's Delete account row goes here, and only here — the deletion
              path is deliberately Profile → Settings → Account settings → Delete.
              It is `<SettingsRow destructive chevron={false} …>`: a red label on
              an otherwise identical row. */}
        </SettingsSection>
      </ScrollView>

      <ConfirmActionModal
        visible={signOutOpen}
        title="Sign out of Livil?"
        message="You'll need your password to sign back in."
        bullets={[
          'Playback stops on this device',
          'Push notifications pause until you sign in again',
          'Your music and friends stay safe',
        ]}
        glyph="↪"
        tone="destructive"
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        busy={signOutBusy}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutOpen(false)}
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
  headerBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  body: { paddingTop: 16, paddingBottom: 40 },
});
