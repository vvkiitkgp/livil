import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState, type AppStateStatus } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import UploadScreen from '../screens/main/UploadScreen';
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
import FloatingPlayer from '../components/FloatingPlayer';
import FullScreenPlayer from '../components/FullScreenPlayer';
import GlobalAudioPlayer from '../components/GlobalAudioPlayer';
import { RootStackParamList } from './types';
import { COLORS } from '../theme/colors';
import { updatePresenceHeartbeat } from '../services/conversations';
import { messageCache } from '../services/messageCache';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (!cancelled) {
          setSession(s);
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
        setSession(s);
        // Clear cached chat data when the user signs out so stale messages
        // aren't briefly visible if a different user signs in on the same device.
        if (event === 'SIGNED_OUT') {
          void messageCache.clearAll();
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
    </View>
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
