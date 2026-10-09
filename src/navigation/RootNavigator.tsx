import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Animated, Text, Image, StatusBar, Dimensions, StyleSheet, AppState, Linking, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { postIdFromUrl, profileUsernameFromUrl } from '../utils/shareLinks';
import { createShareLinkGate } from '../utils/shareLinkGate';
import { clearProfileLinkCache } from '../components/ProfileLinkCard';
import { navigateWhenReady } from './navigationRef';
import { resolveSharedPostTarget, resolveSharedProfile } from '../services/share';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import ChooseUsernameScreen from '../screens/auth/ChooseUsernameScreen';
import TermsAcceptScreen from '../screens/auth/TermsAcceptScreen';
import { hasAcceptedCurrentTerms } from '../services/terms';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import FirstRunGuideScreen from '../screens/auth/FirstRunGuideScreen';
import { getGuideSeen, getUsernameSet, markGuideSeen } from '../services/profileService';
import UploadScreen from '../screens/main/UploadScreen';
import RepostScreen from '../screens/main/RepostScreen';
import AddToLivilScreen from '../screens/main/AddToLivilScreen';
import SpotifyRepostScreen from '../screens/main/SpotifyRepostScreen';
import { OnboardingNoticeHost } from '../components/OnboardingNotice';
import StoryViewerScreen from '../screens/main/StoryViewerScreen';
import CollaboratorPickerScreen from '../screens/main/CollaboratorPickerScreen';
import UserProfileScreen from '../screens/main/UserProfileScreen';
import PlaylistScreen from '../screens/main/PlaylistScreen';
import AlbumDetailScreen from '../screens/main/AlbumDetailScreen';
import CreateAlbumScreen from '../screens/main/CreateAlbumScreen';
import EditAlbumScreen from '../screens/main/EditAlbumScreen';
import EditPlaylistScreen from '../screens/main/EditPlaylistScreen';
import FollowingScreen from '../screens/main/FollowingScreen';
import ProfilePeopleScreen from '../screens/main/ProfilePeopleScreen';
import RecentlyPlayedScreen from '../screens/main/RecentlyPlayedScreen';
import PostDetailScreen from '../screens/main/PostDetailScreen';
import CreatePlaylistScreen from '../screens/main/CreatePlaylistScreen';
import InboxScreen from '../screens/main/InboxScreen';
import ConversationScreen from '../screens/main/ConversationScreen';
import NewConversationScreen from '../screens/main/NewConversationScreen';
import GroupInfoScreen from '../screens/main/GroupInfoScreen';
import JamRoomScreen from '../screens/main/JamRoomScreen';
import FriendRequestsScreen from '../screens/main/FriendRequestsScreen';
import ActivityCenterScreen from '../screens/main/ActivityCenterScreen';
import EditProfileScreen from '../screens/main/EditProfileScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import NotificationSettingsScreen from '../screens/main/NotificationSettingsScreen';
import PrivacyDataScreen from '../screens/main/PrivacyDataScreen';
import ContactTeamScreen from '../screens/main/ContactTeamScreen';
import BlockedAccountsScreen from '../screens/main/BlockedAccountsScreen';
import DeleteAccountScreen from '../screens/main/DeleteAccountScreen';
import { JamProvider } from '../contexts/JamContext';
import { JamRealtimeProvider } from '../contexts/JamRealtimeContext';
import { JamSuggestionsProvider } from '../contexts/JamSuggestionsContext';
import { RelationshipProvider } from '../contexts/RelationshipContext';
import { StoriesProvider } from '../contexts/StoriesContext';
import { ChromeVisibilityProvider } from '../contexts/ChromeVisibilityContext';
import FloatingPlayer from '../components/FloatingPlayer';
import FullScreenPlayer from '../components/FullScreenPlayer';
import GlobalAudioPlayer from '../components/GlobalAudioPlayer';
import ListeningStatusReporter from '../components/ListeningStatusReporter';
import RealtimeConnectionGate from '../components/RealtimeConnectionGate';
import NotificationPermissionModal from '../components/NotificationPermissionModal';
import { AppUpdatePrompt } from '../components/AppUpdatePrompt';
import { RootStackParamList } from './types';
import { nudgeWelcomeEmail } from '../../shared/services/welcomeEmail';
import { COLORS } from '../theme/colors';
import { useToast } from '../contexts/ToastContext';
import { updatePresenceHeartbeat } from '../services/conversations';
import { messageCache } from '../services/messageCache';
import { discardImpressions } from '../services/feedImpressions';
import {
  initPush,
  registerDeviceForUser,
  unregisterDevice,
  shouldShowPushPrompt,
  requestPushPermissionInteractive,
  deferPushPrompt,
} from '../services/pushNotifications';
import { clearAppBadge } from '../services/appBadge';
import { markSignedInHere } from '../utils/returningListener';

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

const LAST_SEEN_HEARTBEAT_MS = 5 * 60_000;

/**
 * Finishing a sign-in from a deep link (Google / magic link / password reset) makes a
 * network call the instant the OS brings the app back from the browser — and iOS often
 * has not reconnected the app's network yet, so a single attempt failed with "Network
 * request failed" and the sign-in was simply lost. Retry transient network failures a
 * few times with backoff; any other error (bad or expired code) returns at once.
 */
async function withNetworkRetry<T extends { error: { message: string } | null }>(
  fn: () => Promise<T>,
): Promise<T> {
  let result = await fn();
  for (const waitMs of [800, 1600, 3200]) {
    if (!result.error || !/network request failed|failed to fetch|network/i.test(result.error.message)) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, waitMs));
    result = await fn();
  }
  return result;
}

// iOS 26 turned on swipe-ANYWHERE-to-go-back by default (fullScreenGestureEnabled). On a
// screen with a horizontal scrubber (song cards, the jam seek bar) every rightward drag
// then popped the screen instead of seeking. Those screens keep only the edge swipe.
const SCRUBBER_SCREEN = { animation: 'slide_from_right', fullScreenGestureEnabled: false } as const;

/**
 * A share link (a post or a profile) that arrived before the app was ready to show it.
 *
 * Profiles and posts are only ever shown to a signed-in viewer — the profile web page is
 * a signpost into the app, nothing more — so a tap before the person is all the way in
 * (signed in, terms, username, first-run guide) cannot be served on the spot. Rather than
 * drop it, the gate holds it and hands it back when `appReady` turns true. See
 * src/utils/shareLinkGate.ts for why readiness, not the session, is the one signal.
 */
const shareLinkGate = createShareLinkGate();

/**
 * Open a shared post or profile link. Returns false when the URL is neither, so the
 * caller can go on to try it as an auth link.
 *
 *   livil://post/<id>, https://livil-music.com/p/<id>
 *       → the author's profile, focused on the post (the PostDetail route is where
 *         ActivityCenter notifications land; shared links have not moved to it).
 *   livil://profile/<handle>, https://livil-music.com/@<handle>
 *       → that person's profile.
 *
 * Both resolve under the viewer's own RLS first, so a deleted post, a block, or an
 * account that is gone is said out loud rather than opening an empty screen.
 */
async function openShareLink(
  url: string,
  onUnavailable: (what: 'post' | 'profile') => void,
): Promise<boolean> {
  const postId = postIdFromUrl(url);
  const username = postId ? null : profileUsernameFromUrl(url);
  if (!postId && !username) { return false; }

  // Decided before any await, so a link and a readiness change cannot interleave.
  if (shareLinkGate.offer(url) === 'held') {
    console.log('[deeplink] share link held until the app is ready');
    return true;
  }

  if (postId) {
    const target = await resolveSharedPostTarget(postId);
    if (target) {
      navigateWhenReady('UserProfile', target);
    } else {
      console.log('[deeplink] shared post not resolvable');
      onUnavailable('post');
    }
  } else if (username) {
    const profile = await resolveSharedProfile(username);
    if (profile) {
      navigateWhenReady('UserProfile', { userId: profile.userId });
    } else {
      console.log('[deeplink] shared profile not resolvable');
      onUnavailable('profile');
    }
  }
  return true;
}

/** Settings → "Replay the guide": the same screen as a pushed route, closing on done. */
function FirstRunGuideReplay({ navigation }: { navigation: { goBack: () => void } }) {
  return <FirstRunGuideScreen mode="replay" onDone={() => navigation.goBack()} />;
}

export default function RootNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // null = unknown (checking), true = must choose a username (new OAuth user),
  // false = onboarded. Gates the app behind ChooseUsernameScreen.
  const [needsUsername, setNeedsUsername] = useState<boolean | null>(null);
  // null = unresolved. Gates the app behind TermsAcceptScreen, ahead of the username
  // gate: agreeing to use the service comes before setting up an identity within it.
  // Also fires for EXISTING users when TERMS_VERSION changes, with source 'reaccept'.
  const [needsTerms, setNeedsTerms] = useState<boolean | null>(null);
  // null = unresolved. Gates the app behind the first-run guide, AFTER terms and the
  // username: it is the last thing before Home, and only ever once per account
  // (`profiles.guide_seen_at`). Resolved alongside the other two so the splash covers
  // it and a new user never sees a flash of Home before their tour.
  const [needsGuide, setNeedsGuide] = useState<boolean | null>(null);
  // Set when a livil://auth deep link carries type=recovery (password reset
  // link) — gates the app behind ResetPasswordScreen until a new password is set.
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const { showToast } = useToast();
  const notifyShareUnavailable = useCallback((what: 'post' | 'profile') => {
    showToast(
      what === 'post' ? 'That track is no longer available' : 'That profile is no longer available',
      { kind: 'info' },
    );
  }, [showToast]);
  // Read through a ref by the deep-link effect, which must subscribe exactly ONCE: it
  // also processes Linking.getInitialURL(), and re-running it would replay a one-shot
  // auth code exchange.
  const notifyShareUnavailableRef = useRef(notifyShareUnavailable);
  notifyShareUnavailableRef.current = notifyShareUnavailable;
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

  // Remember that this install has had a session, so the signed-out onboarding can
  // greet them with "welcome back" after a sign-out.
  useEffect(() => {
    if (session?.user?.id) { void markSignedInHere(); }
  }, [session?.user?.id]);

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

  // One welcome email per account, on the first CONFIRMED session rather than at signup
  // — at signup the address is unverified, and the confirmation email is the one that
  // has to be acted on. Only a nudge: the edge function takes no input and the database
  // decides, atomically and once, whether this call is the one that sends, so firing on
  // every session change (including token refresh) is harmless.
  //
  // Gated on `needsUsername === false` so a new Google account is greeted by the name it
  // chose, not by the `user_xxxxxxxx` placeholder it holds while ChooseUsernameScreen is
  // still up. `passwordRecoveryPending` is excluded for the same reason in reverse: that
  // session belongs to someone mid-password-reset, not to a new arrival.
  useEffect(() => {
    if (needsUsername !== false || passwordRecoveryPending) return;
    void nudgeWelcomeEmail(supabase, session);
  }, [session, needsUsername, passwordRecoveryPending]);

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

  // last_seen_at heartbeat while the app is foregrounded. Only the ops users overview
  // ("last active") reads it — chat no longer shows "online" at all — so minute-level
  // freshness buys nothing; every 5 min instead of every 30s.
  useEffect(() => {
    if (!session) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    void updatePresenceHeartbeat();
    heartbeatRef.current = setInterval(() => void updatePresenceHeartbeat(), LAST_SEEN_HEARTBEAT_MS);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void updatePresenceHeartbeat();
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => void updatePresenceHeartbeat(), LAST_SEEN_HEARTBEAT_MS);
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
      // NEVER log the raw URL. Auth deep links carry access/refresh tokens in the
      // fragment; logging them writes credentials to the device log, readable by
      // other apps on older Android and by anyone with the device connected.
      // Log only the shape.
      console.log('[deeplink] received (scheme only):', url.split('?')[0].split('#')[0]);

      // A shared post or profile (livil://post/<id>, livil://profile/<handle>, or their
      // https forms once App Links / Universal Links verify). Checked BEFORE the auth
      // guard below, which returns early on anything that is not an auth link and would
      // otherwise swallow it. Held until sign-in when nobody is signed in.
      if (await openShareLink(url, what => notifyShareUnavailableRef.current(what))) { return; }

      if (!url.startsWith('livil://auth')) { return; }

      // type=recovery marks a password-reset link (present alongside the
      // tokens/code, regardless of flow) — gate behind ResetPasswordScreen.
      const queryString = url.split('?')[1]?.split('#')[0] ?? '';
      const fragment = url.split('#')[1] ?? '';
      const isRecovery =
        new URLSearchParams(queryString).get('type') === 'recovery' ||
        new URLSearchParams(fragment).get('type') === 'recovery';

      // PKCE flow: code arrives as a query param (?code=…)
      // Not retried: a failed exchange deletes the stored PKCE code verifier (auth-js
      // clears it in its catch), so every retry would fail with "code verifier not
      // found". setSession below has no such one-shot state and IS retried.
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
          const { error } = await withNetworkRetry(() =>
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
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
          // Resolved here too, so the splash covers BOTH gates and a returning user
          // never sees a flash of home before the terms screen. hasAcceptedCurrentTerms
          // fails open, so a network problem lets them in rather than walling them out.
          const accepted = await hasAcceptedCurrentTerms(s.user.id);
          if (!cancelled) { setNeedsTerms(!accepted); }
          // getGuideSeen fails closed, so a network problem skips the tour rather than
          // replaying it on a returning user; Settings can always bring it back.
          try {
            const seen = await getGuideSeen(s.user.id);
            if (!cancelled) { setNeedsGuide(!seen); }
          } catch {
            if (!cancelled) { setNeedsGuide(false); }
          }
        } else {
          setNeedsUsername(null);
          setNeedsTerms(null);
          setNeedsGuide(null);
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
          // Profile-link cards were resolved under the previous account's RLS (its blocks).
          clearProfileLinkCache();
          // Same reason as the line above: the feed-impression buffer is module-global
          // and the server attributes a flush to whoever is signed in when it lands, so
          // ids collected by the previous account would be filed against the next one.
          discardImpressions();
          const prevUserId = pushUserIdRef.current;
          pushUserIdRef.current = null;
          setNeedsUsername(null);
          setNeedsTerms(null);
          setNeedsGuide(null);
          setPasswordRecoveryPending(false);
          if (prevUserId) void unregisterDevice(prevUserId);
          // Same reasoning as the cache clear above, but for the OS icon: the next
          // account must not inherit the previous one's number, and the previous
          // one's notifications must not stay readable from the tray.
          void clearAppBadge();
        } else if (event === 'SIGNED_IN' && s?.user?.id && pushUserIdRef.current !== s.user.id) {
          // Fresh sign-in (new user id) — register push + resolve onboarding.
          // The id guard skips re-checks on resume/token-refresh SIGNED_IN events.
          pushUserIdRef.current = s.user.id;
          void registerDeviceForUser(s.user.id);
          setNeedsUsername(null);
          setNeedsTerms(null);
          setNeedsGuide(null);
          void getUsernameSet(s.user.id)
            .then(set => { if (!cancelled) { setNeedsUsername(!set); } })
            .catch(() => { if (!cancelled) { setNeedsUsername(false); } });
          void hasAcceptedCurrentTerms(s.user.id)
            .then(ok => { if (!cancelled) { setNeedsTerms(!ok); } });
          void getGuideSeen(s.user.id)
            .then(seen => { if (!cancelled) { setNeedsGuide(!seen); } })
            .catch(() => { if (!cancelled) { setNeedsGuide(false); } });
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Splash is showing while we either load or resolve the onboarding gate.
  const onSplash =
    loading || (!!session && (needsUsername === null || needsTerms === null || needsGuide === null));

  // The ONE signal the share-link gate opens on: the app stack (where profiles live) is
  // mounted — past sign-in, terms, username and the first-run guide. A link that arrived
  // earlier lands on the profile now rather than underneath an onboarding screen, and a
  // cold-start link no longer depends on the container's one-time onReady flush.
  const appReady =
    !!session && !onSplash && !passwordRecoveryPending &&
    needsTerms === false && needsUsername === false && needsGuide === false;
  useEffect(() => {
    const url = shareLinkGate.setReady(appReady);
    if (url) { void openShareLink(url, notifyShareUnavailable); }
  }, [appReady, notifyShareUnavailable]);

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
        ) : session?.user?.id && needsTerms ? (
          <TermsAcceptScreen
            userId={session.user.id}
            // A user who has no username yet is brand new, so this is their first
            // acceptance; anyone past that point is re-accepting a changed version.
            source={needsUsername ? 'signup' : 'reaccept'}
            onAccepted={() => setNeedsTerms(false)}
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
            // Sign in with Apple already covered name + email; App Review rejects
            // asking again (guideline 4).
            askForName={session.user?.app_metadata?.provider !== 'apple'}
            userId={session.user?.id ?? null}
            onComplete={() => setNeedsUsername(false)}
          />
        ) : session?.user?.id && needsGuide ? (
          <FirstRunGuideScreen
            onDone={() => {
              // Drop the gate first: the stamp is a courtesy write, and a slow network
              // must not hold a new user on the last card. If it fails they may see the
              // tour once more on another device — acceptable; the reverse (a tour that
              // never ends) is not.
              setNeedsGuide(false);
              void markGuideSeen(session.user.id).catch(() => {});
            }}
          />
        ) : (
    <JamProvider>
    <RealtimeConnectionGate />
    <JamRealtimeProvider>
    <JamSuggestionsProvider>
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
              name="AddToLivil"
              component={AddToLivilScreen}
              options={{
                presentation: 'modal',
                gestureEnabled: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="SpotifyRepost"
              component={SpotifyRepostScreen}
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
              options={SCRUBBER_SCREEN}
            />
            <Stack.Screen
              name="PostDetail"
              component={PostDetailScreen}
              options={SCRUBBER_SCREEN}
            />
            <Stack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="FirstRunGuide"
              component={FirstRunGuideReplay}
              options={{
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="NotificationSettings"
              component={NotificationSettingsScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="PrivacyData"
              component={PrivacyDataScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="ContactTeam"
              component={ContactTeamScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="BlockedAccounts"
              component={BlockedAccountsScreen}
              options={{
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="DeleteAccount"
              component={DeleteAccountScreen}
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
              name="ProfilePeople"
              component={ProfilePeopleScreen}
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
              options={SCRUBBER_SCREEN}
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
          <ListeningStatusReporter />
          <FullScreenPlayer />
          <FloatingPlayer />
        </>
      )}

      {/* "We're still onboarding" notices — before Play on Spotify and before a Jam (ADR-0027). */}
      <OnboardingNoticeHost />

      <NotificationPermissionModal
        visible={pushPromptVisible}
        busy={pushPromptBusy}
        onEnable={handleEnableNotifications}
        onMaybeLater={handleDeferNotifications}
      />

      {/* "Update Livil" — signed in or not, so a blocking update also reaches sign-in. Last,
          so it paints over the players; an overlay rather than a Modal (see the component). */}
      <AppUpdatePrompt />
    </View>
    </ChromeVisibilityProvider>
    </StoriesProvider>
    </RelationshipProvider>
    </JamSuggestionsProvider>
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
