import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { SettingsRow } from '../../components/SettingsRow';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsHeader } from '../../components/SettingsHeader';
import { SettingsProfileCard } from '../../components/SettingsProfileCard';
import { SettingsHighlightCard } from '../../components/SettingsHighlightCard';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { FLOATING_PLAYER_HEIGHT } from '../../constants/layout';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useToast } from '../../contexts/ToastContext';
import { getMyProfile, type MyProfile } from '../../services/profileService';
import { APP_VERSION_LABEL } from '../../constants/appVersion';
import {
  CHILD_SAFETY_URL,
  INSTAGRAM_URL,
  INVITE_SHARE_MESSAGE,
  PLAY_STORE_APP_URL,
  PLAY_STORE_WEB_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_EMAIL,
} from '../../constants/links';
import { supabase } from '../../../lib/supabase';

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const playback = usePlayback();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  // Refetch on focus rather than on mount: returning from EditProfile must show
  // the new name/avatar, and that screen has no way to push back into here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const { data } = await supabase.auth.getUser();
          const user = data.user;
          if (!user) {
            return;
          }
          if (!cancelled) {
            setEmail(user.email ?? null);
          }
          const p = await getMyProfile(user.id);
          if (!cancelled) {
            setProfile(p);
          }
        } catch {
          // Non-fatal: the hero falls back to initials and the rest of the
          // screen is unaffected, so a toast here would be noise.
        } finally {
          if (!cancelled) {
            setLoadingProfile(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const openUrl = useCallback(
    async (url: string, fallback?: string) => {
      try {
        await Linking.openURL(url);
      } catch {
        if (fallback) {
          try {
            await Linking.openURL(fallback);
            return;
          } catch {
            // fall through to the toast
          }
        }
        showToast('Could not open that link.', { kind: 'error' });
      }
    },
    [showToast],
  );

  const onInvite = useCallback(async () => {
    try {
      await Share.share({ message: INVITE_SHARE_MESSAGE });
    } catch {
      showToast('Could not open the share sheet.', { kind: 'error' });
    }
  }, [showToast]);

  const onContactSupport = useCallback(() => {
    const subject = encodeURIComponent(`Livil support (${APP_VERSION_LABEL})`);
    void openUrl(`mailto:${SUPPORT_EMAIL}?subject=${subject}`);
  }, [openUrl]);

  // No navigation reset after signOut: RootNavigator swaps the whole signed-in
  // stack for AuthNavigator on SIGNED_OUT, so this screen unmounts itself.
  const confirmSignOut = useCallback(async () => {
    if (signOutBusy) {
      return;
    }
    setSignOutBusy(true);
    playback.pauseAll();
    await supabase.auth.signOut();
    setSignOutBusy(false);
    setSignOutOpen(false);
  }, [playback, signOutBusy]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsProfileCard
          displayName={profile?.display_name ?? null}
          username={profile?.username ?? null}
          email={email}
          avatarUrl={profile?.avatar_url ?? null}
          loading={loadingProfile}
          onPress={() => navigation.navigate('EditProfile')}
        />

        {/* No "Edit profile" row: the hero card above is already that control,
            and two pressables with the same label is a screen-reader trap. */}
        <SettingsSection title="Preferences">
          <SettingsRow
            icon="bell"
            label="Notifications"
            subtitle="Choose what Livil can notify you about"
            onPress={() => navigation.navigate('NotificationSettings')}
          />
          <SettingsRow
            icon="shield"
            label="Privacy & data"
            subtitle="Activity status, your data, account deletion"
            onPress={() => navigation.navigate('PrivacyData')}
          />
        </SettingsSection>

        <SettingsSection title="Support">
          <SettingsRow
            icon="support"
            label="Contact support"
            subtitle={SUPPORT_EMAIL}
            external
            onPress={onContactSupport}
          />
          <SettingsRow
            icon="star"
            label="Rate Livil on the Play Store"
            external
            onPress={() => void openUrl(PLAY_STORE_APP_URL, PLAY_STORE_WEB_URL)}
          />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow
            icon="document"
            label="Privacy policy"
            external
            onPress={() => void openUrl(PRIVACY_POLICY_URL)}
          />
          <SettingsRow
            icon="shield"
            label="Child safety policy"
            external
            onPress={() => void openUrl(CHILD_SAFETY_URL)}
          />
        </SettingsSection>

        <SettingsHighlightCard
          icon="gift"
          title="Invite your friends"
          subtitle="Livil is better with the people you listen with"
          actionLabel="Invite"
          onPress={onInvite}
        />

        <SettingsSection title="Follow us">
          <SettingsRow
            icon="instagram"
            label="Instagram"
            subtitle="New features, behind the scenes, and what's next"
            external
            onPress={() => void openUrl(INSTAGRAM_URL)}
          />
        </SettingsSection>

        <Pressable
          onPress={() => setSignOutOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
        >
          <Icon name="signOut" size={18} color={COLORS.textSecondary} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>{APP_VERSION_LABEL}</Text>
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
  body: { paddingTop: 8 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  signOutPressed: {
    opacity: 0.6,
  },
  signOutLabel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  version: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
});
