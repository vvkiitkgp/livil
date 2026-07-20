import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Text, Image, StatusBar, Dimensions, StyleSheet, AppState, Linking, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import ChooseUsernameScreen from '../screens/auth/ChooseUsernameScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import { getUsernameSet } from '../services/profileService';
import UploadScreen from '../screens/main/UploadScreen';
import RepostScreen from '../screens/main/RepostScreen';
import StoryViewerScreen from '../screens/main/StoryViewerScreen';
import CollaboratorPickerScreen from '../screens/main/CollaboratorPickerScreen';
import UserProfileScreen from '../screens/main/UserProfileScreen';
import PlaylistScreen from '../screens/main/PlaylistScreen';
import AlbumDetailScreen from '../screens/main/AlbumDetailScreen';
import CreateAlbumScreen from '../screens/main/CreateAlbumScreen';
import EditAlbumScreen from '../screens/main/EditAlbumScreen';
import EditPlaylistScreen from '../screens/main/EditPlaylistScreen';
import FollowingScreen from '../screens/main/FollowingScreen';
import RecentlyPlayedScreen from '../screens/main/RecentlyPlayedScreen';
import CreatePlaylistScreen from '../screens/main/CreatePlaylistScreen';
import InboxScreen from '../screens/main/InboxScreen';
import ConversationScreen from '../screens/main/ConversationScreen';
import NewConversationScreen from '../screens/main/NewConversationScreen';
import GroupInfoScreen from '../screens/main/GroupInfoScreen';
import JamRoomScreen from '../screens/main/JamRoomScreen';
import FriendRequestsScreen from '../screens/main/FriendRequestsScreen';
import ActivityCenterScreen from '../screens/main/ActivityCenterScreen';
import EditProfileScreen from '../screens/main/EditProfileScreen';
import { JamProvider } from '../contexts/JamContext';
import { JamRealtimeProvider } from '../contexts/JamRealtimeContext';
import { RelationshipProvider } from '../contexts/RelationshipContext';
import { StoriesProvider } from '../contexts/StoriesContext';
import { ChromeVisibilityProvider } from '../contexts/ChromeVisibilityContext';
import FloatingPlayer from '../components/FloatingPlayer';
import FullScreenPlayer from '../components/FullScreenPlayer';
import GlobalAudioPlayer from '../components/GlobalAudioPlayer';
import NotificationPermissionModal from '../components/NotificationPermissionModal';
import { RootStackParamList } from './types';
import { COLORS } from '../theme/colors';
import { useToast } from '../contexts/ToastContext';
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
const { width } = Dimensions.get('window');

function DotsLoader() {
  const dots = useRef([
    new Animated.Value(0.3),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.delay((2 - i) * 200),
        ]),
      ),
    );
    animations.forEach(a => a.start());
    return () => animations.forEach(a => a.stop());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.dotsRow}>
      {dots.map((opacity, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity }]} />
      ))}
    </View>
  );
}

function SplashScreen() {
  // The waveform mark is the continuity anchor — it matches the native splash
  // icon, so it's already on screen at full opacity the instant the native
  // splash hands off. Everything else "blooms" in around it.
  const enter = useRef(new Animated.Value(0)).current;
  const loaderOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 460,
      delay: 90,
      useNativeDriver: true,
    }).start();
    // Fade the dots in just after the brand settles so they're reliably
    // visible during the wait (not held back long enough to miss on fast starts).
    const t = setTimeout(() => {
      Animated.timing(loaderOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }).start();
    }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <SafeAreaView style={styles.splashContainer} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <Animated.View style={[styles.orbContainer, { opacity: enter }]} pointerEvents="none">
        <View style={styles.orbOuter} />
        <View style={styles.orbMiddle} />
        <View style={styles.orbInner} />
      </Animated.View>
      <View style={styles.heroSection}>
        <Image source={require('../assets/livil-mark.png')} style={styles.mark} resizeMode="contain" />
        <Animated.View style={[styles.brandBlock, { opacity: enter, transform: [{ translateY: rise }] }]}>
          <Text style={styles.logoText}>livil</Text>
          <View style={styles.logoDivider} />
          <Text style={styles.tagline}>Your music, your world.</Text>
          <Text style={styles.caption}>Live . Vibe . Link</Text>
        </Animated.View>
      </View>
      <Animated.View style={{ opacity: loaderOpacity }}>
        <DotsLoader />
      </Animated.View>
    </SafeAreaView>
  );
}

export default function RootNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // null = unknown (checking), true = must choose a username (new OAuth user),
  // false = onboarded. Gates the app behind ChooseUsernameScreen.
  const [needsUsername, setNeedsUsername] = useState<boolean | null>(null);
  // Set when a livil://auth deep link carries type=recovery (password reset
  // link) — gates the app behind ResetPasswordScreen until a new password is set.
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const { showToast } = useToast();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushUserIdRef = useRef<string | null>(null);
  const [pushPromptVisible, setPushPromptVisible] = useState(false);
  const [pushPromptBusy, setPushPromptBusy] = useState(false);

  // Cold-start splash overlay — stays mounted on top until the session /
  // onboarding gate resolves, then crossfades into the app underneath.
  const [splashMounted, setSplashMounted] = useState(true);
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashScale = useRef(new Animated.Value(1)).current;

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
      console.log('[deeplink] received:', url);
      if (!url.startsWith('livil://auth')) { return; }

      // type=recovery marks a password-reset link (present alongside the
      // tokens/code, regardless of flow) — gate behind ResetPasswordScreen.
      const queryString = url.split('?')[1]?.split('#')[0] ?? '';
      const fragment = url.split('#')[1] ?? '';
      const isRecovery =
        new URLSearchParams(queryString).get('type') === 'recovery' ||
        new URLSearchParams(fragment).get('type') === 'recovery';

      // PKCE flow: code arrives as a query param (?code=…)
      if (url.includes('code=')) {
        const { error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) { console.error('[deeplink] exchangeCodeForSession error:', error.message, error.status); }
        else if (isRecovery) { setPasswordRecoveryPending(true); }
        return;
      }

      // Implicit / fragment flow: tokens in #access_token=…&refresh_token=…
      if (fragment) {
        const params = new URLSearchParams(fragment);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) { console.error('[deeplink] setSession error:', error.message); }
          else if (isRecovery) { setPasswordRecoveryPending(true); }
          return;
        }
      }

      // Fallback
      console.warn('[deeplink] unrecognised URL format, trying exchangeCodeForSession');
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) { console.error('[deeplink] fallback error:', error.message); }
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
      .then(async ({ data: { session: s } }) => {
        if (cancelled) { return; }
        // Realtime channels gate on the user's JWT; without this, RLS-protected
        // postgres_changes events (chat messages, reactions) are dropped silently.
        console.log(`[realtime] initial setAuth token=${s?.access_token ? 'present' : 'null'}`);
        supabase.realtime.setAuth(s?.access_token ?? null);
        if (s?.user?.id) {
          pushUserIdRef.current = s.user.id;
          void registerDeviceForUser(s.user.id);
          // Resolve onboarding state before clearing the splash so a new OAuth
          // user never sees a flash of the home screen before the username gate.
          try {
            const set = await getUsernameSet(s.user.id);
            if (!cancelled) { setNeedsUsername(!set); }
          } catch {
            if (!cancelled) { setNeedsUsername(false); }
          }
        } else {
          setNeedsUsername(null);
        }
        if (!cancelled) { setSession(s); }
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
          setNeedsUsername(null);
          setPasswordRecoveryPending(false);
          if (prevUserId) void unregisterDevice(prevUserId);
        } else if (event === 'SIGNED_IN' && s?.user?.id && pushUserIdRef.current !== s.user.id) {
          // Fresh sign-in (new user id) — register push + resolve onboarding.
          // The id guard skips re-checks on resume/token-refresh SIGNED_IN events.
          pushUserIdRef.current = s.user.id;
          void registerDeviceForUser(s.user.id);
          setNeedsUsername(null);
          void getUsernameSet(s.user.id)
            .then(set => { if (!cancelled) { setNeedsUsername(!set); } })
            .catch(() => { if (!cancelled) { setNeedsUsername(false); } });
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Splash is showing while we either load or resolve the onboarding gate.
  const onSplash = loading || (!!session && needsUsername === null);

  // Once that resolves, crossfade the splash overlay out (fade + gentle scale)
  // — dissolving into whatever's underneath: the app, or the username gate.
  useEffect(() => {
    if (onSplash || !splashMounted) return;
    const anim = Animated.parallel([
      Animated.timing(splashOpacity, { toValue: 0, duration: 320, useNativeDriver: true }),
      Animated.timing(splashScale, { toValue: 1.06, duration: 320, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setSplashMounted(false);
    });
    return () => anim.stop();
  }, [onSplash, splashMounted, splashOpacity, splashScale]);

  return (
    <View style={styles.root}>
      {!onSplash &&
        (session && passwordRecoveryPending ? (
          <ResetPasswordScreen
            onComplete={() => {
              setPasswordRecoveryPending(false);
              showToast('Password updated.', { kind: 'success' });
            }}
            onCancel={() => setPasswordRecoveryPending(false)}
          />
        ) : session && needsUsername ? (
          <ChooseUsernameScreen
            email={session.user?.email ?? null}
            displayName={
              (session.user?.user_metadata?.full_name as string | undefined) ??
              (session.user?.user_metadata?.name as string | undefined) ??
              null
            }
            avatarUrl={
              (session.user?.user_metadata?.avatar_url as string | undefined) ??
              (session.user?.user_metadata?.picture as string | undefined) ??
              null
            }
            onComplete={() => setNeedsUsername(false)}
          />
        ) : (
    <JamProvider>
    <JamRealtimeProvider>
    <RelationshipProvider>
    <StoriesProvider>
    <ChromeVisibilityProvider>
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
              name="EditProfile"
              component={EditProfileScreen}
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
              name="AlbumDetail"
              component={AlbumDetailScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="CreateAlbum"
              component={CreateAlbumScreen}
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="EditAlbum"
              component={EditAlbumScreen}
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="EditPlaylist"
              component={EditPlaylistScreen}
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                gestureEnabled: true,
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
            <Stack.Screen
              name="ActivityCenter"
              component={ActivityCenterScreen}
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
    </ChromeVisibilityProvider>
    </StoriesProvider>
    </RelationshipProvider>
    </JamRealtimeProvider>
    </JamProvider>
        ))}

      {splashMounted && (
        <Animated.View
          pointerEvents={onSplash ? 'auto' : 'none'}
          style={[
            styles.splashOverlay,
            { opacity: splashOpacity, transform: [{ scale: splashScale }] },
          ]}
        >
          <SplashScreen />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: COLORS.bg,
    zIndex: 10,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  orbContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  orbOuter: {
    position: 'absolute',
    width: width * 1.1,
    height: width * 1.1,
    borderRadius: (width * 1.1) / 2,
    backgroundColor: 'rgba(139, 61, 255, 0.07)',
    top: -width * 0.45,
    alignSelf: 'center',
  },
  orbMiddle: {
    position: 'absolute',
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: (width * 0.7) / 2,
    backgroundColor: 'rgba(139, 61, 255, 0.13)',
    top: -width * 0.2,
    alignSelf: 'center',
  },
  orbInner: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(139, 61, 255, 0.22)',
    top: 30,
    alignSelf: 'center',
  },
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
  },
  mark: {
    width: 300,
    height: 300,
    marginBottom: 2,
  },
  brandBlock: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.white,
    letterSpacing: 1.5,
  },
  logoDivider: {
    width: 56,
    height: 3,
    backgroundColor: COLORS.purple,
    borderRadius: 2,
    marginTop: 6,
    marginBottom: 18,
  },
  tagline: {
    fontSize: 17,
    color: COLORS.textSecondary,
    letterSpacing: 0.4,
  },
  caption: {
    fontSize: 12,
    color: COLORS.purple,
    letterSpacing: 3,
    fontWeight: '600',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 48,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: COLORS.purple,
  },
});
