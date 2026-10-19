import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';
import { usePlayback } from '../contexts/PlaybackContext';
import { canReach, subscribeToOffline } from '../services/network';
import { SUPABASE_URL } from '../../lib/supabase';

/** A switch from Wi-Fi to mobile data reads as offline for a moment; don't cover the app for that. */
const SHOW_AFTER_MS = 1500;
/** Any answer from our own server proves the connection works (a 401 without a key included). */
const PROBE_URL = `${SUPABASE_URL}/auth/v1/health`;

/**
 * "No internet connection", over the WHOLE app while the phone is offline (owner,
 * 2026-10-19: nothing works offline, so nothing should be tappable). A Modal, so it also
 * covers sheets and dialogs, and Android's back button does nothing. Music is paused when it
 * appears — offline, the engine would only fail on every track.
 *
 * Goes away by itself when the connection is back. "Try again" asks our server directly, and
 * if it answers the screen goes away even while the phone still says offline: Android marks
 * some working networks "no internet", and that must never lock anyone out.
 */
export default function OfflineScreen() {
  const { activePostId, handlersRef, pauseAll } = usePlayback();
  const [offline, setOffline] = useState(false);
  const [shown, setShown] = useState(false);
  // "Try again" got an answer while the phone still says offline: trust the answer until the
  // phone's own state changes.
  const [overruled, setOverruled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const [pausedMusic, setPausedMusic] = useState(false);

  useEffect(() => subscribeToOffline(next => {
    setOffline(next);
    setOverruled(false);
  }), []);

  useEffect(() => {
    if (!offline || overruled) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [offline, overruled]);

  // Read at the moment the screen appears, not as a dependency: pausing changes them.
  const playbackRef = useRef({ activePostId, handlersRef, pauseAll });
  playbackRef.current = { activePostId, handlersRef, pauseAll };
  useEffect(() => {
    if (!shown) { setStillOffline(false); return; }
    Keyboard.dismiss();
    const p = playbackRef.current;
    if (p.activePostId) {
      // The in-app pause button's own path; pauseAll if the engine has not registered yet.
      if (p.handlersRef.current) { p.handlersRef.current.pause(); } else { p.pauseAll(); }
      setPausedMusic(true);
    } else {
      setPausedMusic(false);
    }
  }, [shown]);

  const tryAgain = useCallback(async () => {
    setChecking(true);
    setStillOffline(false);
    const reachable = await canReach(PROBE_URL);
    setChecking(false);
    if (reachable) { setOverruled(true); } else { setStillOffline(true); }
  }, []);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      // Back does nothing: there is nothing to go back to offline.
      onRequestClose={() => {}}
    >
      <View style={styles.screen} accessibilityViewIsModal>
        <View style={styles.iconCircle}>
          <Icon name="offline" size={36} color={COLORS.purpleLight} />
        </View>
        <Text style={styles.title} accessibilityRole="header">No internet connection</Text>
        <Text style={styles.body}>Check your Wi-Fi or mobile data, then try again.</Text>
        {pausedMusic ? <Text style={styles.note}>Your music is paused.</Text> : null}
        <Button
          label="Try again"
          variant="primary"
          size="lg"
          busy={checking}
          onPress={() => { void tryAgain(); }}
          style={styles.button}
        />
        <Text style={[styles.note, !stillOffline && styles.hidden]}>Still offline</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { color: COLORS.white, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: {
    color: COLORS.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  note: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 12 },
  button: { marginTop: 28, minWidth: 180 },
  // Reserves the line so the button never jumps when "Still offline" appears.
  hidden: { opacity: 0 },
});
