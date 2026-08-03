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
  ALL_CATEGORIES_ON,
  NOTIFICATION_CHANNELS,
  disablePushForUser,
  getBlockedChannelIds,
  getNotificationPreferences,
  isPushEnabled,
  openOsNotificationSettings,
  requestPushPermissionInteractive,
  updateNotificationPreference,
  type NotificationCategoryPrefs,
} from '../../services/pushNotifications';
import { supabase } from '../../../lib/supabase';

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [blockedChannels, setBlockedChannels] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<NotificationCategoryPrefs>(ALL_CATEGORIES_ON);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Per-category, so toggling Messages does not freeze the Jam switch.
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
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
      const uid = data.user?.id ?? null;
      if (mounted.current) {
        setUserId(uid);
      }
      // Settled independently: a failure in any one of these must not blank the
      // others or leave the switches gated on a userId that never got set.
      const [on, blocked, categoryPrefs] = await Promise.allSettled([
        isPushEnabled(),
        getBlockedChannelIds(),
        uid ? getNotificationPreferences(uid) : Promise.resolve(ALL_CATEGORIES_ON),
      ]);
      if (!mounted.current) {
        return;
      }
      if (on.status === 'fulfilled') {
        setEnabled(on.value);
      }
      if (blocked.status === 'fulfilled') {
        setBlockedChannels(blocked.value);
      }
      if (categoryPrefs.status === 'fulfilled') {
        setPrefs(categoryPrefs.value);
      }
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

  const onToggleCategory = useCallback(
    async (category: keyof NotificationCategoryPrefs, next: boolean) => {
      if (!userId || savingCategory) {
        return;
      }
      setSavingCategory(category);
      setPrefs(prev => ({ ...prev, [category]: next }));
      try {
        await updateNotificationPreference(userId, category, next);
      } catch {
        if (mounted.current) {
          setPrefs(prev => ({ ...prev, [category]: !next }));
          showToast('Could not update that notification setting.', { kind: 'error' });
        }
      } finally {
        if (mounted.current) {
          setSavingCategory(null);
        }
      }
    },
    [savingCategory, showToast, userId],
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

        {/* The switch is OUR preference — whether the server sends this category
            at all. That is the only mechanism that works on iOS, and the only one
            that avoids waking the device for something the user muted. Android's
            own channel state is separate and OS-owned: an app cannot change a
            channel once created, so it is reported in the subtitle and fixed
            through the link below, never silently mirrored into our switch. */}
        <SettingsSection title="Categories">
          {NOTIFICATION_CHANNELS.map(channel => {
            const category = channel.id as keyof NotificationCategoryPrefs;
            const on = prefs[category];
            // Only worth surfacing when we WOULD send but Android will not show
            // it — otherwise the user's own switch already explains the silence.
            const silencedByOs = isAndroid && on && blockedChannels.has(channel.id);
            return (
              <SettingsRow
                key={channel.id}
                icon={on ? 'bell' : 'bellOff'}
                iconColor={silencedByOs ? COLORS.warning : undefined}
                iconBackground={silencedByOs ? COLORS.warningBg : undefined}
                label={channel.name}
                subtitle={
                  silencedByOs
                    ? "Silenced in Android settings — these won't appear"
                    : channel.description
                }
                toggle={{
                  value: on,
                  onValueChange: next => void onToggleCategory(category, next),
                  disabled: loading || !userId || savingCategory === channel.id,
                }}
              />
            );
          })}
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            icon="settings"
            label={isAndroid ? 'Android notification settings' : 'iOS notification settings'}
            subtitle={
              isAndroid
                ? 'Sound, vibration and importance for each category'
                : 'Sound, banners and badges for Livil'
            }
            external
            onPress={() => void openChannel()}
          />
        </SettingsSection>

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
