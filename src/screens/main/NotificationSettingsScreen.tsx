import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { SettingsRow } from '../../components/SettingsRow';
import {
  SettingsSection,
  SETTINGS_PAGE_INSET,
} from '../../components/SettingsSection';
import { SettingsHeader } from '../../components/SettingsHeader';
import { FLOATING_PLAYER_HEIGHT } from '../../constants/layout';
import { useToast } from '../../contexts/ToastContext';
import {
  NOTIFICATION_CHANNELS,
  disablePushForUser,
  getBlockedChannelIds,
  isPushEnabled,
  openOsNotificationSettings,
  requestPushPermissionInteractive,
} from '../../services/pushNotifications';
import { supabase } from '../../../lib/supabase';

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [blockedChannels, setBlockedChannels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const [on, blocked] = await Promise.all([isPushEnabled(), getBlockedChannelIds()]);
      if (!mounted.current) {
        return;
      }
      setUserId(data.user?.id ?? null);
      setEnabled(on);
      setBlockedChannels(blocked);
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The OS permission can change while we're backgrounded — the user taps a
  // channel row, revokes the whole app's notifications in system settings, and
  // comes back. Without this the master toggle would lie until a remount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const onToggle = useCallback(
    async (next: boolean) => {
      if (busy || !userId) {
        return;
      }
      setBusy(true);
      // Optimistic: the switch must move under the finger. Reverted below if
      // the OS refuses.
      setEnabled(next);
      try {
        if (next) {
          const granted = await requestPushPermissionInteractive(userId);
          if (!mounted.current) {
            return;
          }
          setEnabled(granted);
          if (!granted) {
            // Android stops showing the runtime dialog after two refusals, so
            // "nothing happened" is the common case here — point at the only
            // place the user can actually fix it.
            showToast('Notifications are blocked. Turn them on in system settings.', {
              kind: 'info',
            });
          }
        } else {
          await disablePushForUser(userId);
          if (mounted.current) {
            setEnabled(false);
          }
        }
      } catch {
        if (mounted.current) {
          setEnabled(!next);
          showToast('Could not update notifications.', { kind: 'error' });
        }
      } finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    },
    [busy, showToast, userId],
  );

  const openChannel = useCallback(
    async (channelId?: string) => {
      try {
        await openOsNotificationSettings(channelId);
      } catch {
        showToast('Could not open system settings.', { kind: 'error' });
      }
    },
    [showToast],
  );

  const isAndroid = Platform.OS === 'android';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Notifications" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection>
          <SettingsRow
            icon={enabled ? 'bell' : 'bellOff'}
            label="Push notifications"
            subtitle={
              enabled
                ? 'This device receives Livil notifications'
                : 'Turn on to hear about messages, friends and activity'
            }
            toggle={{ value: enabled, onValueChange: onToggle, disabled: busy || loading }}
          />
        </SettingsSection>

        {isAndroid ? (
          <>
            <SettingsSection title="Categories">
              {NOTIFICATION_CHANNELS.map(channel => {
                const blocked = blockedChannels.has(channel.id);
                return (
                  <SettingsRow
                    key={channel.id}
                    icon={blocked ? 'bellOff' : 'bell'}
                    iconColor={blocked ? COLORS.textMuted : undefined}
                    iconBackground={blocked ? COLORS.inputBg : undefined}
                    label={channel.name}
                    subtitle={channel.description}
                    // The state is Android's, read back via getChannels() — we
                    // report it rather than storing our own copy that could
                    // disagree with what the OS actually does.
                    value={loading ? undefined : blocked ? 'Off' : 'On'}
                    external
                    disabled={!enabled}
                    onPress={() => void openChannel(channel.id)}
                  />
                );
              })}
            </SettingsSection>
            <Text style={styles.note}>
              Sound, vibration and importance for each category are controlled by
              Android. Tapping a category opens its system settings.
            </Text>
          </>
        ) : (
          <SettingsSection title="Categories">
            <SettingsRow
              icon="settings"
              label="Open system settings"
              subtitle="Manage Livil notifications in iOS Settings"
              external
              onPress={() => void openChannel()}
            />
          </SettingsSection>
        )}

        {!enabled && !loading ? (
          <View style={styles.blockedNote}>
            <Text style={styles.blockedText}>
              With notifications off you'll still see everything in the app — you
              just won't be alerted when it happens.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { paddingTop: 8 },
  note: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: SETTINGS_PAGE_INSET + 4,
    marginTop: -12,
    marginBottom: 22,
  },
  blockedNote: {
    marginHorizontal: SETTINGS_PAGE_INSET,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.infoBorder,
  },
  blockedText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
});
