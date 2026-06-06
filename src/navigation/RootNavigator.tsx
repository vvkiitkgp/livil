import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState, Linking, type AppStateStatus } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import UploadScreen from '../screens/main/UploadScreen';
import RepostScreen from '../screens/main/RepostScreen';
import StoryViewerScreen from '../screens/main/StoryViewerScreen';
import CollaboratorPickerScreen from '../screens/main/CollaboratorPickerScreen';
import UserProfileScreen from '../screens/main/UserProfileScreen';
import PlaylistScreen from '../screens/main/PlaylistScreen';
import FollowingScreen from '../screens/main/FollowingScreen';
import RecentlyPlayedScreen from '../screens/main/RecentlyPlayedScreen';
import CreatePlaylistScreen from '../screens/main/CreatePlaylistScreen';
import InboxScreen from '../screens/main/InboxScreen';
import ConversationScreen from '../screens/main/ConversationScreen';
import NewConversationScreen from '../screens/main/NewConversationScreen';
import GroupInfoScreen from '../screens/main/GroupInfoScreen';
import JamRoomScreen from '../screens/main/JamRoomScreen';
import FriendRequestsScreen from '../screens/main/FriendRequestsScreen';
import { JamProvider } from '../contexts/JamContext';
import { JamRealtimeProvider } from '../contexts/JamRealtimeContext';
import { RelationshipProvider } from '../contexts/RelationshipContext';
import { StoriesProvider } from '../contexts/StoriesContext';
import FloatingPlayer from '../components/FloatingPlayer';
import FullScreenPlayer from '../components/FullScreenPlayer';
import GlobalAudioPlayer from '../components/GlobalAudioPlayer';
import NotificationPermissionModal from '../components/NotificationPermissionModal';
import { RootStackParamList } from './types';
import { COLORS } from '../theme/colors';
import { updatePresenceHeartbeat } from '../services/conversations';
import { messageCache } from '../services/messageCache';
import {
  initPush,
  registerDeviceForUser,
  unregisterDevice,
  shouldShowPushPrompt,
  requestPushPermissionInteractive,
  deferPushPrompt,
} from '../services/pushNotifications';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushUserIdRef = useRef<string | null>(null);
  const [pushPromptVisible, setPushPromptVisible] = useState(false);
  const [pushPromptBusy, setPushPromptBusy] = useState(false);

  useEffect(() => {
    initPush();
  }, []);

  // After sign-in, decide whether to surface the notification pre-prompt.
  // Runs after a short delay so the user sees the home screen mount first
  // (Android 13+ shows the modal less jarringly when it's not racing the
  // first frame).
  useEffect(() => {
    if (!session?.user?.id) {
      setPushPromptVisible(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void shouldShowPushPrompt().then(should => {
        if (!cancelled && should) setPushPromptVisible(true);
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session?.user?.id]);

  const handleEnableNotifications = async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setPushPromptVisible(false);
      return;
    }
    setPushPromptBusy(true);
    try {
      await requestPushPermissionInteractive(uid);
    } finally {
      setPushPromptBusy(false);
      setPushPromptVisible(false);
    }
  };

  const handleDeferNotifications = async () => {
    setPushPromptVisible(false);
    void deferPushPrompt();
  };

  // Presence heartbeat: update last_seen_at every 30s while app is foregrounded
  useEffect(() => {
    if (!session) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    void updatePresenceHeartbeat();
    heartbeatRef.current = setInterval(() => void updatePresenceHeartbeat(), 30_000);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void updatePresenceHeartbeat();
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => void updatePresenceHeartbeat(), 30_000);
        }
      } else {
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      }
    });

    return () => {
      sub.remove();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [session]);

  // Handle deep links for email confirmation (livil://auth?code=...)
  // After exchangeCodeForSession resolves, onAuthStateChange fires SIGNED_IN
  // and the session state update switches the navigator to the App screens.
  useEffect(() => {
    const handleDeepLink = async (url: string) => {
      if (!url.startsWith('livil://auth')) return;
      await supabase.auth.exchangeCodeForSession(url);
    };

    Linking.getInitialURL().then(url => {
      if (url) void handleDeepLink(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => void handleDeepLink(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (!cancelled) {
          // Realtime channels gate on the user's JWT; without this, RLS-protected
          // postgres_changes events (chat messages, reactions) are dropped silently.
          console.log(`[realtime] initial setAuth token=${s?.access_token ? 'present' : 'null'}`);
          supabase.realtime.setAuth(s?.access_token ?? null);
          setSession(s);
          if (s?.user?.id) {
            pushUserIdRef.current = s.user.id;
            void registerDeviceForUser(s.user.id);
          }
        }
      })
      .catch(() => {
        // Offline / transient fetch failures — stay signed out but never hang on splash.
        if (!cancelled) {
          setSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (!cancelled) {
        console.log(`[realtime] auth event=${event} token=${s?.access_token ? 'present' : 'null'}`);
        supabase.realtime.setAuth(s?.access_token ?? null);
        setSession(s);
        // Clear cached chat data when the user signs out so stale messages
        // aren't briefly visible if a different user signs in on the same device.
        if (event === 'SIGNED_OUT') {
          void messageCache.clearAll();
          const prevUserId = pushUserIdRef.current;
          pushUserIdRef.current = null;
          if (prevUserId) void unregisterDevice(prevUserId);
        } else if (event === 'SIGNED_IN' && s?.user?.id && pushUserIdRef.current !== s.user.id) {
          pushUserIdRef.current = s.user.id;
          void registerDeviceForUser(s.user.id);
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.purple} />
      </View>
    );
  }

  return (
    <JamProvider>
    <JamRealtimeProvider>
    <RelationshipProvider>
    <StoriesProvider>
    <View style={styles.root}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'none',
          contentStyle: { backgroundColor: COLORS.bg },
        }}
      >
        {session ? (
          <>
            <Stack.Screen name="App" component={AppNavigator} />
            <Stack.Screen
              name="Upload"
              component={UploadScreen}
              options={{
                presentation: 'modal',
                gestureEnabled: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="Repost"
              component={RepostScreen}
              options={{
                presentation: 'modal',
                gestureEnabled: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="StoryViewer"
              component={StoryViewerScreen}
              options={{
                presentation: 'transparentModal',
                gestureEnabled: false,
                animation: 'fade',
              }}
            />
            <Stack.Screen
              name="CollaboratorPicker"
              component={CollaboratorPickerScreen}
              options={{
                presentation: 'modal',
                gestureEnabled: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="UserProfile"
              component={UserProfileScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="PlaylistDetail"
              component={PlaylistScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="Following"
              component={FollowingScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="RecentlyPlayed"
              component={RecentlyPlayedScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="CreatePlaylist"
              component={CreatePlaylistScreen}
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                gestureEnabled: true,
              }}
            />
            {/* ── Chat screens (full-screen, no bottom tab bar) ── */}
            <Stack.Screen
              name="Inbox"
              component={InboxScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Conversation"
              component={ConversationScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="NewConversation"
              component={NewConversationScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="GroupInfo"
              component={GroupInfoScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="JamRoom"
              component={JamRoomScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="FriendRequests"
              component={FriendRequestsScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>

      {/* Rendered above the entire stack so they appear on every screen */}
      {session && (
        <>
          <GlobalAudioPlayer />
          <FullScreenPlayer />
          <FloatingPlayer />
        </>
      )}

      <NotificationPermissionModal
        visible={pushPromptVisible}
        busy={pushPromptBusy}
        onEnable={handleEnableNotifications}
        onMaybeLater={handleDeferNotifications}
      />
    </View>
    </StoriesProvider>
    </RelationshipProvider>
    </JamRealtimeProvider>
    </JamProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
