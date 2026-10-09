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
 * dialogs. "Don't show this again" is remembered per notice, per device (AsyncStorage):
 * a convenience, not an account setting — losing it costs one extra dialog, nothing more.
 */
export type NoticeKind = 'spotify' | 'jam';

type NoticeCopy = {
  title: string;
  body: string;
  closing: string;
  confirm: string;
  cancel: string;
};

const COPY: Record<NoticeKind, NoticeCopy> = {
  spotify: {
    title: 'Sorry, this one plays on Spotify',
    body:
      'Livil is still onboarding independent artists, so not every song lives here yet. ' +
      'Until your favourite does, you can keep reposting it from Spotify.',
    closing: "Your music friends are right here. Come back once the song's done 💜",
    confirm: 'Open Spotify',
    cancel: 'Stay on Livil',
  },
  jam: {
    title: 'Jams play Livil songs only',
    body:
      "Sorry, a Jam can only play songs that live on Livil, and we're still onboarding " +
      'independent artists, so your favourite might not be here yet.',
    closing: 'Pick something from Livil and listen together, in sync 💜',
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
let listener: ((req: Request) => void) | null = null;

/**
 * Show the notice (unless dismissed on this device), then run `onConfirm` if they go ahead.
 * Already dismissed → `onConfirm` runs at once. No host mounted (should not happen) → it
 * also runs at once, rather than the button silently doing nothing.
 */
export async function requestNotice(kind: NoticeKind, onConfirm: () => void): Promise<void> {
  if (await isNoticeDismissed(kind)) { onConfirm(); return; }
  if (listener) { listener({ kind, onConfirm }); } else { onConfirm(); }
}

export function OnboardingNoticeHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    listener = req => { setDontShow(false); setRequest(req); };
    return () => { listener = null; };
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
      visible={request !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close(false)}
    >
      <View style={styles.backdrop}>
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
            <Text style={styles.body}>{copy.body}</Text>
            <Text style={[styles.body, styles.closing]}>{copy.closing}</Text>

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

            <Button label={copy.confirm} onPress={() => close(true)} variant="primary" size="md" fullWidth />
            <Button
              label={copy.cancel}
              onPress={() => close(false)}
              variant="ghost"
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
