import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Keyboard, Linking, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { APP_VERSION_CODE } from '../constants/appVersion';
import {
  decideUpdate,
  fetchUpdatePolicy,
  isUpdateSnoozed,
  NO_UPDATE,
  snoozeUpdate,
  storeUrls,
  type UpdateVerdict,
} from '../services/appUpdate';
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
 */
const RECHECK_MS = 30 * 60 * 1000;

const COPY = {
  soft: {
    title: 'A new version of Livil is here',
    body: 'Update to get the newest features and fixes.',
  },
  hard: {
    title: 'Please update Livil',
    body: "This version of Livil isn't supported anymore. Update to keep listening with your friends.",
  },
} as const;

export function AppUpdatePrompt({ build = APP_VERSION_CODE }: { build?: number }) {
  const [verdict, setVerdict] = useState<UpdateVerdict>(NO_UPDATE);
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;
  const lastCheckRef = useRef(0);
  const inFlightRef = useRef(false);

  const check = useCallback(async () => {
    if (inFlightRef.current) {return;}
    if (verdictRef.current.kind !== 'hard' && Date.now() - lastCheckRef.current < RECHECK_MS) {return;}
    inFlightRef.current = true;
    try {
      const policy = await fetchUpdatePolicy();
      // Unreadable: keep the last answer (see the header). Not stamped, so the next return
      // to the foreground tries again.
      if (!policy) {return;}
      lastCheckRef.current = Date.now();
      const next = decideUpdate(policy, build);
      if (next.kind === 'soft' && (await isUpdateSnoozed(next.latestBuild))) {
        setVerdict(NO_UPDATE);
        return;
      }
      setVerdict(next);
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

  const later = useCallback(() => {
    const v = verdictRef.current;
    if (v.kind === 'soft') {snoozeUpdate(v.latestBuild);}
    setVerdict(NO_UPDATE);
  }, []);

  const update = useCallback(async () => {
    const { primary, fallback } = storeUrls();
    try {
      await Linking.openURL(primary);
    } catch {
      await Linking.openURL(fallback).catch(() => {});
    }
    // Gentle: stand down — they went to update, and coming back without doing it should
    // not be met by the same card. The next launch or recheck asks again if still behind.
    // Blocking: stays up until the build is new enough.
    if (verdictRef.current.kind === 'soft') {setVerdict(NO_UPDATE);}
  }, []);

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
      if (verdictRef.current.kind === 'soft') {later();}
      return true;
    });
    return () => sub.remove();
  }, [verdict.kind, later]);

  if (verdict.kind === 'none') {return null;}
  const copy = COPY[verdict.kind];

  return (
    // accessibilityViewIsModal on the BACKDROP: it hides the element's siblings — the app
    // underneath — from VoiceOver (iOS only; Android has no overlay equivalent).
    <View style={styles.backdrop} testID="app-update-prompt" accessibilityViewIsModal>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Logo size={34} color={COLORS.purpleLight} />
          </View>
        </View>

        <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
        <Text style={styles.body}>{verdict.message ?? copy.body}</Text>

        <Button label="Update" onPress={() => void update()} variant="primary" size="md" fullWidth />
        {verdict.kind === 'soft' ? (
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
