import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import ConfirmActionModal from './ConfirmActionModal';
import {
  artistLine,
  getSpotifyTrack,
  resolveSpotifyLinkCached,
  useSpotifyAvailability,
  type SpotifyTrack,
} from '../services/spotify';
import { spotifyLinkInClipboard } from '../utils/spotifyLinks';
import {
  clearCopiedText,
  forgetCheckedCopy,
  hasOpenedPasteSettings,
  isCopiedLinkDetectionOn,
  openPasteSettings,
  readCopiedText,
} from '../services/clipboard';
import { navigateWhenReady, navigationRef } from '../navigation/navigationRef';

/**
 * Android only lets the app on screen read the clipboard, and "active" arrives a moment before
 * the window has focus — a read straight away comes back empty.
 */
const READ_DELAY_MS = 500;
/** Already on a screen for adding a Spotify song: the person is doing it themselves. */
const SKIP_ON = new Set(['SpotifyRepost', 'AddToLivil']);
/** Read fresh at each use: it changes while a check awaits (TypeScript would assume it can't). */
const appStateNow = (): AppStateStatus => AppState.currentState;

/**
 * "Repost the song you copied?" — when Livil opens (or comes back) with a Spotify song link on
 * the clipboard (owner, 2026-10-19: read on every open). Only while Spotify reposts are
 * switched on, and only once the person is in the app (not during sign-up or the guide).
 *
 * Whichever button they press, the clipboard is then cleared, so the same link does not ask
 * again on every open (owner, 2026-10-19). Leaving the app with the question still up counts
 * as no answer: nothing is cleared, and the next open asks again.
 *
 * On an iPhone the clipboard is read only for a NEW copy that holds a web link (readCopiedText),
 * so the system's "Allow Paste?" question never appears for a copied code or message, and at
 * most once per copied link. When the person allowed it and the link is not a Spotify song,
 * "Not a Spotify song" says why we asked and offers iPhone Settings → Paste from Other Apps →
 * Allow (owner, 2026-10-20: "on allow, we don't do anything if it's not spotify link"). Once
 * they have opened Settings from it, it stops appearing — Livil cannot see that switch.
 *
 * Two off switches, either one stops every clipboard check: the server's kill switch
 * (spotify_copied_links_enabled(), for everyone at once — owner, 2026-10-21) and the person's
 * own "Detect copied Spotify links" in Privacy & data (this phone).
 *
 * Privacy: the clipboard text is read and parsed on the phone; it is never stored or logged.
 * Only a spotify.link short link — the clipboard's whole content, and only when it is one —
 * goes to the server, which turns it into a song id.
 */
export default function SpotifyClipboardPrompt({ active }: { active: boolean }) {
  const { reposts, copiedLinks } = useSpotifyAvailability();
  const enabled = reposts && copiedLinks;
  // The song stays set while the dialog fades out; `visible` is what opens and closes it.
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [visible, setVisible] = useState(false);
  // "Not a Spotify song": iOS asked to paste and the copy was some other link.
  const [sorryVisible, setSorryVisible] = useState(false);
  const shownRef = useRef(false);
  shownRef.current = visible || sorryVisible;
  const songShownRef = useRef(false);
  songShownRef.current = visible;
  const checkingRef = useRef(false);
  // Android: clipboard texts already answered this session — in case clearing it did not stick.
  const answeredRef = useRef(new Set<string>());
  const textRef = useRef('');
  // iPhone: a copied Spotify link, already allowed, whose song lookup failed (offline). Retried
  // on the next return without reading the clipboard again — the copy is already used up, and a
  // re-read would ask again. Memory only, like every clipboard text here.
  const pendingRef = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!active || !enabled || checkingRef.current || shownRef.current) {return;}
    // Not on screen (opened in the background, or a shade is down): starting a read here would
    // use up the copy on an iPhone without the person seeing anything.
    if (appStateNow() === 'background' || appStateNow() === 'inactive') {return;}
    const route = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
    if (route && SKIP_ON.has(route)) {return;}
    checkingRef.current = true;
    try {
      if (!(await isCopiedLinkDetectionOn())) {return;}
      const read = await readCopiedText();
      const { askedToPaste } = read;
      let { text } = read;
      if (text) {
        pendingRef.current = null;
      } else if (pendingRef.current) {
        text = pendingRef.current;
      }
      // iPhone: the copy counter already stops a re-read, and this would swallow a deliberate
      // re-copy of the same link (iOS asks, Allow, then nothing).
      if (Platform.OS !== 'ios' && answeredRef.current.has(text)) {return;}
      const link = spotifyLinkInClipboard(text);
      if (!link) {
        // "Don't Allow" reads as '' — they said no, so there is nothing to explain.
        if (askedToPaste && text.trim() !== '' && !(await hasOpenedPasteSettings())
          && appStateNow() !== 'background') {
          shownRef.current = true;
          setSorryVisible(true);
        }
        return;
      }
      const id = link.id ?? (await resolveSpotifyLinkCached(link.shortUrl));
      const found = id ? await getSpotifyTrack(id) : null;
      if (!found) {
        if (Platform.OS === 'ios') { pendingRef.current = text; }
        return;
      }
      // Left the app while the song was being looked up.
      if (appStateNow() === 'background') {
        forgetCheckedCopy();
        return;
      }
      pendingRef.current = null;
      textRef.current = text;
      setTrack(found);
      // Set now, not on the next render: a 'background' right after must see the question.
      shownRef.current = true;
      songShownRef.current = true;
      setVisible(true);
    } catch {
      // Nothing to offer — never an error over a clipboard.
    } finally {
      checkingRef.current = false;
    }
  }, [active, enabled]);

  // On open (once the app is ready and the switch is known) and every return to the app.
  useEffect(() => {
    if (!active || !enabled) {return;}
    let timer = setTimeout(() => { void check(); }, READ_DELAY_MS);
    const sub = AppState.addEventListener('change', state => {
      // 'inactive' (iOS only) is not leaving: Livil is still on screen, behind iOS's own "Allow
      // Paste?" question — which a running check sets off — or Control Center or the shade. It
      // only cancels a check not yet started; treating it as gone made a running check drop its
      // answer: Allow was tapped and no dialog followed (2026-10-21). 'active' re-arms it.
      clearTimeout(timer);
      if (state === 'active') {
        timer = setTimeout(() => { void check(); }, READ_DELAY_MS);
      } else if (state === 'background') {
        // Gone without answering: ask again next time, and clear nothing.
        if (songShownRef.current) { forgetCheckedCopy(); }
        setVisible(false);
        setSorryVisible(false);
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [active, enabled, check]);

  const answer = useCallback((repost: boolean) => {
    const id = track?.id;
    answeredRef.current.add(textRef.current);
    pendingRef.current = null;
    clearCopiedText();
    setVisible(false);
    if (repost && id) { navigateWhenReady('SpotifyRepost', { spotifyTrackId: id }); }
  }, [track]);

  return (
    <>
      <ConfirmActionModal
        visible={visible && active}
        icon="repost"
        tone="primary"
        title="Repost the song you copied?"
        message={track ? `${track.title} · ${artistLine(track)}` : undefined}
        // Not "Repost": it opens the repost screen (caption first), it does not post (owner, 2026-10-19).
        confirmLabel="New repost"
        cancelLabel="Not now"
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
      <ConfirmActionModal
        visible={sorryVisible && active}
        icon="info"
        tone="primary"
        title="Not a Spotify song"
        message={
          "We asked because it looked like you'd copied a link. When it's a Spotify song, you can "
          + 'repost it in one tap. To stop this question: Settings → Paste from Other Apps → Allow.'
        }
        confirmLabel="Open Settings"
        cancelLabel="Got it"
        onConfirm={() => {
          setSorryVisible(false);
          void openPasteSettings();
        }}
        onCancel={() => setSorryVisible(false)}
      />
    </>
  );
}
