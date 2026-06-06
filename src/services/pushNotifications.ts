import {
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  deleteToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { navigateWhenReady } from '../navigation/navigationRef';
import type { RootStackParamList } from '../navigation/types';

const DEVICE_ID_KEY = 'livil.device_id';

function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function handleNotificationData(data: Record<string, string> | undefined): void {
  if (!data?.route) return;
  const { route, ...rest } = data;
  navigateWhenReady(route as keyof RootStackParamList, rest);
}

const unsubFns: Array<() => void> = [];
let initialized = false;
let tokenRefreshUnsub: (() => void) | null = null;

export function initPush(): void {
  if (initialized) return;
  initialized = true;

  const messaging = getMessaging();

  const offMessage = onMessage(messaging, msg => {
    console.log('[push] foreground', msg.notification?.title, msg.data);
  });
  unsubFns.push(offMessage);

  const offOpened = onNotificationOpenedApp(messaging, msg => {
    handleNotificationData(msg.data as Record<string, string> | undefined);
  });
  unsubFns.push(offOpened);

  void getInitialNotification(messaging).then(msg => {
    if (msg) handleNotificationData(msg.data as Record<string, string> | undefined);
  });
}

async function ensurePermission(): Promise<boolean> {
  const messaging = getMessaging();
  const status = await requestPermission(messaging);
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

async function upsertToken(userId: string, token: string, deviceId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from('device_tokens')
    .upsert(
      {
        user_id: userId,
        token,
        device_id: deviceId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_id' },
    );
  if (error) throw new Error(error.message);
}

export async function registerDeviceForUser(userId: string): Promise<void> {
  try {
    const granted = await ensurePermission();
    if (!granted) {
      console.log('[push] permission not granted');
      return;
    }
    const messaging = getMessaging();
    const token = await getToken(messaging);
    const deviceId = await getOrCreateDeviceId();
    await upsertToken(userId, token, deviceId);

    if (tokenRefreshUnsub) {
      tokenRefreshUnsub();
      tokenRefreshUnsub = null;
    }
    tokenRefreshUnsub = onTokenRefresh(messaging, async (newToken: string) => {
      try {
        await upsertToken(userId, newToken, deviceId);
      } catch (e) {
        console.warn('[push] token refresh upsert failed', e);
      }
    });
  } catch (e) {
    console.warn('[push] registerDeviceForUser failed', e);
  }
}

export async function unregisterDevice(userId: string): Promise<void> {
  try {
    if (tokenRefreshUnsub) {
      tokenRefreshUnsub();
      tokenRefreshUnsub = null;
    }
    const deviceId = await getOrCreateDeviceId();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId);
    try {
      await deleteToken(getMessaging());
    } catch {
      // best-effort: token may already be gone
    }
  } catch (e) {
    console.warn('[push] unregisterDevice failed', e);
  }
}
