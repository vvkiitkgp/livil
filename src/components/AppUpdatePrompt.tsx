import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  BackHandler,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { APP_VERSION_CODE } from '../constants/appVersion';
import { useToast } from '../contexts/ToastContext';
import {
  chooseUpdateAction,
  decideUpdate,
  fetchUpdatePolicy,
  isPlayDownloading,
  isUpdateSnoozed,
  NO_UPDATE,
  promptWithPlay,
  snoozeUpdate,
  storeUrls,
  type PromptState,
  type UpdateVerdict,
} from '../services/appUpdate';
import {
  checkPlayUpdate,
  completePlayUpdate,
  startPlayUpdate,
  subscribePlayInstallState,
} from '../native/playInAppUpdate';
import { Button } from './Button';
import { Logo } from './Logo';

/**
 * "Update Livil" — gentle (Update / Later) or blocking (Update only), driven by the
 * per-platform row in `app_update_policy` (src/services/appUpdate.ts).
 *
 * An OVERLAY at the root, not an RN <Modal>. iOS silently refuses to present a modal while
 * another is presenting or animating away, and this one appears on its own schedule (launch,
 * return to foreground) — exactly when NotificationPermissionModal or a sheet may be up.
 * A refused modal would never show, and a refused BLOCKING one would let an unsupported
 * build carry on. A plain view cannot be refused. Mounted at RootNavigator's ROOT, outside
 * every session gate, so it covers the sign-in, terms, username and password-reset screens
 * as well as the app — those gates are where an outdated build is most likely to break — and
 * survives signing in without losing its state. The splash (zIndex 10) covers it while up.
 *
 * Checked on mount and on every return to the foreground (throttled while nothing is shown,
 * immediate while blocking — so lowering `minimum_build` unblocks without a restart).
 * FAIL-OPEN only while nothing is known: a recheck that cannot read the policy keeps the last
 * answer, so a dropped connection (or airplane mode) never lifts a known block.
 *
 * ANDROID installs through Google Play inside the app (In-App Updates; the rules are in
 * src/services/appUpdate.ts): Update on the gentle prompt starts a background download and
 * the card steps aside; when the download lands it returns as "Update ready — Restart".
 * Update on the blocking prompt opens Play's full-screen updater, with this card still
 * underneath if they back out of it. When Play can't do it, Update opens the store listing,
 * as it always has — and as it still does on iOS, which none of the Play paths touch.
 */
const RECHECK_MS = 30 * 60 * 1000;

const COPY = {
  soft: {
    title: 'New version of Livil',
    body: 'Get the newest features and fixes.',
  },
  hard: {
    title: 'Please update Livil',
    body: 'This version no longer works.',
  },
  ready: {
    title: 'Update ready',
    body: 'Restart Livil to finish updating.',
  },
} as const;

/** Whether the card offers a way out (Later, back, a tap outside). Never while blocking. */
function hasCancel(p: PromptState): boolean {
  return p.kind === 'soft' || (p.kind === 'ready' && !p.blocking);
}

export function AppUpdatePrompt({ build = APP_VERSION_CODE }: { build?: number }) {
  const { showToast } = useToast();
  const [verdict, setVerdict] = useState<PromptState>(NO_UPDATE);
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;
  // The policy's own answer, kept while the card steps aside for a background download, so
  // "Update ready" knows whether it must block.
  const policyVerdictRef = useRef<UpdateVerdict>(NO_UPDATE);
  const lastCheckRef = useRef(0);
  const inFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // Android: following a Play background download, until it lands or fails.
  const [watchingDownload, setWatchingDownload] = useState(false);

  const check = useCallback(async () => {
    if (inFlightRef.current) {return;}
    const blocking = verdictRef.current.kind !== 'none' && !hasCancel(verdictRef.current);
    if (!blocking && Date.now() - lastCheckRef.current < RECHECK_MS) {return;}
    inFlightRef.current = true;
    try {
      const policy = await fetchUpdatePolicy();
      // Unreadable: keep the last answer (see the header). Not stamped, so the next return
      // to the foreground tries again.
      if (!policy) {return;}
      lastCheckRef.current = Date.now();
      const next = decideUpdate(policy, build);
      policyVerdictRef.current = next;
      let shown: PromptState = next;
      // Play is asked only when the row says this build is behind — never for the up-to-date.
      if (Platform.OS === 'android' && next.kind !== 'none') {
        const play = await checkPlayUpdate();
        shown = promptWithPlay(next, play);
        if (next.kind === 'soft' && isPlayDownloading(play)) {setWatchingDownload(true);}
      }
      if (shown.kind === 'soft' && (await isUpdateSnoozed(shown.latestBuild))) {
        setVerdict(NO_UPDATE);
        return;
      }
      setVerdict(shown);
    } finally {
      inFlightRef.current = false;
    }
  }, [build]);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {void check();}
    });
    return () => sub.remove();
  }, [check]);

  // Android: the background download. Play's own notification shows progress; this only
  // waits for the end. Native listens to Play only while this subscription is open.
  useEffect(() => {
    if (!watchingDownload) {return;}
    return subscribePlayInstallState(status => {
      if (status === 'downloaded') {
        setWatchingDownload(false);
        setVerdict({ kind: 'ready', blocking: policyVerdictRef.current.kind === 'hard' });
      } else if (status === 'failed' || status === 'canceled' || status === 'installed') {
        setWatchingDownload(false);
        // Stood aside, not snoozed: the next launch or recheck offers the update again.
        if (status === 'failed') {showToast("The update didn't download. We'll try again later.", { kind: 'error' });}
      }
    });
  }, [watchingDownload, showToast]);

  const later = useCallback(() => {
    const v = verdictRef.current;
    if (v.kind === 'soft') {snoozeUpdate(v.latestBuild);}
    // "Update ready": not snoozed — a downloaded update is offered again at the next launch
    // or recheck (Google's guidance; until installed it is taking up storage).
    setVerdict(NO_UPDATE);
  }, []);

  const openStore = useCallback(async () => {
    const { primary, fallback } = storeUrls();
    try {
      await Linking.openURL(primary);
    } catch {
      await Linking.openURL(fallback).catch(() => {});
    }
    // Gentle: stand down — they went to update, and coming back without doing it should
    // not be met by the same card. The next launch or recheck asks again if still behind.
    // Blocking: stays up until the build is new enough.
    if (hasCancel(verdictRef.current)) {setVerdict(NO_UPDATE);}
  }, []);

  /** Android: installs through Play. False = Play couldn't, so open the store listing. */
  const updateThroughPlay = useCallback(async (p: PromptState): Promise<boolean> => {
    if (p.kind === 'none') {return false;}
    const action = p.kind === 'ready' ? 'restart' : chooseUpdateAction(p.kind, await checkPlayUpdate());
    if (action === 'restart') {
      // Play takes over the screen and restarts the app; on success this rarely returns.
      return completePlayUpdate();
    }
    if (action === 'store') {return false;}
    const result = await startPlayUpdate(action);
    if (result === 'failed' || result === 'unavailable') {return false;}
    if (action === 'flexible' && result === 'accepted') {
      // Downloading in the background: step aside until it lands ("Update ready").
      setVerdict(NO_UPDATE);
      setWatchingDownload(true);
      showToast('Downloading the update in the background.', { kind: 'info' });
      return true;
    }
    // Declined in Play's own dialog ("No thanks"), or an immediate update that returned:
    // the gentle prompt counts that as Later; the blocking one stays up.
    if (p.kind === 'soft') {later();}
    return true;
  }, [later, showToast]);

  const update = useCallback(async () => {
    if (Platform.OS === 'android') {
      setBusy(true);
      try {
        if (await updateThroughPlay(verdictRef.current)) {return;}
      } finally {
        setBusy(false);
      }
    }
    await openStore();
  }, [openStore, updateThroughPlay]);

  // On appearing: put the keyboard away — iOS draws it above the whole app, so a focused
  // composer or sign-in field restored on foreground would cover the buttons with no way to
  // dismiss it — and tell VoiceOver/TalkBack the prompt is there.
  useEffect(() => {
    if (verdict.kind === 'none') {return;}
    Keyboard.dismiss();
    AccessibilityInfo.announceForAccessibility(COPY[verdict.kind].title);
  }, [verdict.kind]);

  // Android back: "Later" for the gentle prompt; swallowed while blocking, or it would
  // navigate the screens underneath.
  useEffect(() => {
    if (verdict.kind === 'none') {return;}
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hasCancel(verdictRef.current)) {later();}
      return true;
    });
    return () => sub.remove();
  }, [verdict.kind, later]);

  if (verdict.kind === 'none') {return null;}
  const copy = COPY[verdict.kind];
  const cancellable = hasCancel(verdict);
  // The row's custom message describes the release; "Update ready" says what to do next.
  const body = verdict.kind === 'ready' ? copy.body : verdict.message ?? copy.body;

  return (
    // accessibilityViewIsModal on the BACKDROP: it hides the element's siblings — the app
    // underneath — from VoiceOver (iOS only; Android has no overlay equivalent).
    <View style={styles.backdrop} testID="app-update-prompt" accessibilityViewIsModal>
      {/* A tap outside the card is the "Later" button, exactly. A sibling BEHIND the card,
          not its parent, so taps on the card never reach it. Hidden from screen readers: the
          button itself is the accessible way out. */}
      {!cancellable ? null : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={later}
          accessible={false}
          importantForAccessibility="no"
        />
      )}
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Logo size={34} color={COLORS.purpleLight} />
          </View>
        </View>

        <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
        <Text style={styles.body}>{body}</Text>

        <Button
          label={verdict.kind === 'ready' ? 'Restart' : 'Update'}
          onPress={() => { void update(); }}
          variant="primary"
          size="md"
          fullWidth
          busy={busy}
        />
        {cancellable ? (
          <Button label="Later" onPress={later} variant="ghost" size="md" fullWidth style={styles.later} />
        ) : null}
      </View>
    </View>
  );
}

// Card, icon and type mirror OnboardingNotice / NotificationPermissionModal — the house dialog.
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    // Above the whole navigation tree (its sibling at RootNavigator's root), below the
    // splash overlay (zIndex 10), which covers it during cold start.
    zIndex: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: { alignItems: 'center', marginBottom: 14 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 18,
  },
  later: { marginTop: 8 },
});
