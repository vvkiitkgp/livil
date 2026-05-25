import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
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
import FloatingPlayer from '../components/FloatingPlayer';
import FullScreenPlayer from '../components/FullScreenPlayer';
import GlobalAudioPlayer from '../components/GlobalAudioPlayer';
import { RootStackParamList } from './types';
import { COLORS } from '../theme/colors';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!cancelled) {
        setSession(s);
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
