import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';
import { SpotifyLogo } from './SpotifyLogo';

/**
 * "We're still onboarding" notices (ADR-0027) — the two moments where Livil's catalogue
 * being young is felt, said honestly and with an invitation to stay:
 *
 *   spotify — before a song is handed to the Spotify app (we lose the listener for a
 *             while: say sorry, say why, say their friends are here);
 *   jam     — before a Jam starts (a Jam can only play songs that live on Livil).
 *
 * ONE host, mounted once in RootNavigator, serves every caller through `requestNotice`,
 * so the feed card, chat card, Search and the ⋯ menu cannot drift into different
 * dialogs. A sheet that can raise a notice while it is OPEN (the comments sheet's song
 * cards) mounts a second host inside itself: on iOS a modal is presented from the screen
 * its host lives on, and the root's host cannot present over an open sheet (below). "Don't show this again" is remembered per notice, per device (AsyncStorage):
 * a convenience, not an account setting — losing it costs one extra dialog, nothing more.
 */
export type NoticeKind = 'spotify' | 'jam';

type NoticeCopy = {
  title: string;
  body: string;
  /** A second line under the body, when one is needed. */
  closing?: string;
  confirm: string;
  cancel: string;
};

const COPY: Record<NoticeKind, NoticeCopy> = {
  spotify: {
    title: 'This one plays on Spotify',
    body: 'Play it there, then come back and tell your friends what you think.',
    closing: "Don't forget to like the repost. It grows your vibe 💜",
    confirm: 'Open Spotify',
    cancel: 'Stay on Livil',
  },
  jam: {
    title: 'Jams play Livil songs only',
    body: 'Pick a Livil song (Indie Vibes) and listen together, in sync 💜',
    confirm: 'Start Jam',
    cancel: 'Not now',
  },
};

const storageKey = (kind: NoticeKind) => `livil.notice.${kind}.dismissed.v1`;
const dismissed: Partial<Record<NoticeKind, boolean>> = {};

/** Whether "Don't show this again" was ticked for this notice on this device. Never throws. */
export async function isNoticeDismissed(kind: NoticeKind): Promise<boolean> {
  if (dismissed[kind] !== undefined) {return dismissed[kind]!;}
  const value = await AsyncStorage.getItem(storageKey(kind)).catch(() => null);
  dismissed[kind] = value === '1';
  return dismissed[kind]!;
}

function rememberDismissed(kind: NoticeKind): void {
  dismissed[kind] = true;
  AsyncStorage.setItem(storageKey(kind), '1').catch(() => {});
}

// ── The request channel ─────────────────────────────────────────────────────

type Request = { kind: NoticeKind; onConfirm: () => void };
/**
 * Every mounted host, newest last; the newest serves the request. A host inside an open
 * sheet is mounted after the root's, so while the sheet is up its notice is presented from
 * the sheet, on top of it. When the sheet closes its host unmounts and the root's serves
 * again.
 *
 * WHY: iOS refuses to present a modal from a screen that is already presenting one, and
 * RN's iOS modal still records itself as presented. A Spotify card tapped inside the
 * comments sheet raised the notice from the ROOT's host: nothing appeared, Spotify never
 * opened, and the notice stayed "open" in JS — the owner then found the app no longer
 * answering taps (iPhone, 2026-10-16).
 */
const listeners: Array<(req: Request) => void> = [];

/**
 * Show the notice (unless dismissed on this device), then run `onConfirm` if they go ahead.
 * Already dismissed → `onConfirm` runs at once. No host mounted (should not happen) → it
 * also runs at once, rather than the button silently doing nothing.
 */
export async function requestNotice(kind: NoticeKind, onConfirm: () => void): Promise<void> {
  if (await isNoticeDismissed(kind)) { onConfirm(); return; }
  const host = listeners[listeners.length - 1];
  if (host) { host({ kind, onConfirm }); } else { onConfirm(); }
}

export function OnboardingNoticeHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [dontShow, setDontShow] = useState(false);
  /**
   * Bumped for every request. It is the Modal's `key`, so each request gets a FRESH native
   * modal rather than a prop change on the old one.
   *
   * WHY: iOS silently refuses to present a modal while another is still animating closed
   * (e.g. a sheet whose button raised this notice), and RN's iOS modal still records itself
   * as presented. `request` is only cleared by this dialog's own buttons, so a refused
   * notice left `visible` stuck at true: every later request — Spotify AND Jam — changed
   * nothing on the native side and showed nothing, until the app restarted. Callers wait
   * for the closing sheet first (useRunAfterDismiss); this is the safety net if one misses.
   */
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    const serve = (req: Request) => {
      setDontShow(false);
      setRequestId(n => n + 1);
      setRequest(req);
    };
    listeners.push(serve);
    return () => {
      const i = listeners.lastIndexOf(serve);
      if (i >= 0) { listeners.splice(i, 1); }
    };
  }, []);

  const close = (go: boolean) => {
    const req = request;
    if (req && dontShow) { rememberDismissed(req.kind); }
    setRequest(null);
    if (go && req) { req.onConfirm(); }
  };

  const copy = request ? COPY[request.kind] : null;

  return (
    <Modal
      key={requestId}
      visible={request !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close(false)}
    >
      <View style={styles.backdrop}>
        {/* A tap outside the card is the cancel button: nothing runs, and a ticked "Don't
            show this again" is still remembered. A sibling BEHIND the card, not its parent,
            so taps on the card never reach it. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => close(false)}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        {copy && request ? (
          <View style={styles.card} accessibilityViewIsModal>
            <View style={styles.iconWrap}>
              <View style={styles.iconCircle}>
                {request.kind === 'spotify' ? (
                  <SpotifyLogo size="md" />
                ) : (
                  <Icon name="musicNotes" size={24} color={COLORS.purpleLight} />
                )}
              </View>
            </View>

            <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
            <Text style={[styles.body, !copy.closing && styles.bodyLast]}>{copy.body}</Text>
            {copy.closing ? <Text style={[styles.body, styles.closing]}>{copy.closing}</Text> : null}

            <Pressable
              onPress={() => setDontShow(v => !v)}
              style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontShow }}
            >
              {/* Solid when ticked: a hollow checkbox reads as unchecked (CLAUDE.md's
                  small-indicator exemption from the no-fill rule). */}
              <View style={[styles.box, dontShow && styles.boxChecked]}>
                {dontShow ? <Icon name="check" size={13} color={COLORS.white} /> : null}
              </View>
              <Text style={styles.checkLabel}>Don't show this again</Text>
            </Pressable>

            {/* Spotify: going is Spotify-green (it hands you to their app) and staying wears
                Livil's own purple outline — two destinations, each in its own colours. The Jam
                notice stays a Livil decision either way: purple confirm, quiet cancel. */}
            <Button
              label={copy.confirm}
              onPress={() => close(true)}
              variant={request.kind === 'spotify' ? 'spotify' : 'primary'}
              size="md"
              fullWidth
            />
            <Button
              label={copy.cancel}
              onPress={() => close(false)}
              variant={request.kind === 'spotify' ? 'primary' : 'ghost'}
              size="md"
              fullWidth
              style={styles.cancel}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// Card, backdrop, icon and type mirror NotificationPermissionModal — the house dialog.
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
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
    marginBottom: 10,
  },
  closing: { color: COLORS.white, marginBottom: 14 },
  bodyLast: { marginBottom: 14 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 44,
    marginBottom: 8,
  },
  pressed: { opacity: 0.7 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  checkLabel: { color: COLORS.white, fontSize: 14 },
  cancel: { marginTop: 8 },
});
