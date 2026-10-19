import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';
import { useToast } from '../contexts/ToastContext';
import {
  getPushPromptStatus,
  canShowPermissionDialog,
  isPushEnabled,
  isPushOffFor,
  openOsNotificationSettings,
  registerIfNewlyAllowed,
  requestPushPermissionInteractive,
} from '../services/pushNotifications';

const DISMISS_KEY = 'livil.notifyNudge.dismissedAt.v1';
/** "Not now" hides it for a week; it comes back until notifications are on. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const CARD_RADIUS = 16;

/** ask = the phone can still show its dialog; settings = it was refused, only Settings can turn it on. */
type Mode = 'hidden' | 'ask' | 'settings';

/**
 * "Turn on notifications", at the top of the chat list while this phone cannot get pushes
 * (owner, 2026-10-19: 45 of 63 accounts had no registered device, so friends' messages
 * never arrived). Re-checked whenever the screen or the app comes back, so it disappears
 * the moment notifications work — including after allowing Livil in the phone's settings.
 *
 * Not shown to someone who switched notifications off in Livil's own Settings ('off'): that
 * was a choice, not a missed prompt. "Not now" snoozes it for a week.
 */
export default function NotificationNudge({ userId }: { userId: string | null }) {
  const [mode, setMode] = useState<Mode>('hidden');
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const check = useCallback(async () => {
    if (!userId) { setMode('hidden'); return; }
    try {
      // Allowed in the phone's settings while away? Register first, so the answer is current.
      await registerIfNewlyAllowed(userId);
      if (await isPushEnabled()) { setMode('hidden'); return; }
      if (await isPushOffFor(userId)) { setMode('hidden'); return; }
      const dismissedAt = Number(await AsyncStorage.getItem(DISMISS_KEY).catch(() => null)) || 0;
      if (Date.now() - dismissedAt < SNOOZE_MS) { setMode('hidden'); return; }
      // Straight to "Settings" when the phone will not show its dialog again — a "Turn on"
      // that only flips to "Settings" on the first tap felt broken (owner, 2026-10-19).
      setMode((await canShowPermissionDialog()) ? 'ask' : 'settings');
    } catch {
      setMode('hidden');
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { void check(); }, [check]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') { void check(); } });
    return () => sub.remove();
  }, [check]);

  const turnOn = useCallback(async () => {
    if (!userId || busy) {return;}
    if (mode === 'settings') {
      // Back in the app afterwards, the AppState check above registers and hides this.
      await openOsNotificationSettings().catch(() => {});
      return;
    }
    setBusy(true);
    const granted = await requestPushPermissionInteractive(userId);
    setBusy(false);
    if (granted) {
      setMode('hidden');
      showToast('Notifications are on', { kind: 'success' });
    } else if ((await getPushPromptStatus()) === 'denied') {
      // Refused (or refused before, with no dialog left to show): Settings is the only way.
      setMode('settings');
    } else {
      // Allowed, but registering this phone failed (network): asking again is the fix.
      showToast("Couldn't turn on notifications. Try again.", { kind: 'error' });
    }
  }, [userId, busy, mode, showToast]);

  const notNow = useCallback(() => {
    AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {});
    setMode('hidden');
  }, []);

  if (mode === 'hidden') {return null;}

  return (
    <View style={styles.card}>
      <GradientBorder borderRadius={CARD_RADIUS} />
      <View style={styles.bell}>
        <Icon name="bell" size={20} color={COLORS.purpleLight} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>Turn on notifications</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {mode === 'settings' ? "Allow Livil in your phone's settings." : 'Get messages the moment they arrive.'}
        </Text>
      </View>
      <Button
        label={mode === 'settings' ? 'Settings' : 'Turn on'}
        onPress={() => { void turnOn(); }}
        busy={busy}
        variant="primary"
        size="sm"
      />
      <Pressable
        onPress={notNow}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Icon name="close" size={14} color={COLORS.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same card as the inbox's other pinned rows (InboxBanner). No `overflow: 'hidden'`:
  // GradientBorder draws inward, and clipping would shave the glow.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 12,
    gap: 12,
    borderRadius: CARD_RADIUS,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12 },
  close: { padding: 4 },
  pressed: { opacity: 0.6 },
});
