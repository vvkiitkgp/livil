import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
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
 * Privacy: the clipboard text is read and parsed on the phone; it is never stored or logged.
 * Only a spotify.link short link — the clipboard's whole content, and only when it is one —
 * goes to the server, which turns it into a song id.
 */
export default function SpotifyClipboardPrompt({ active }: { active: boolean }) {
  const { reposts } = useSpotifyAvailability();
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
  // Clipboard texts already answered this session — in case clearing it did not stick.
  const answeredRef = useRef(new Set<string>());
  const textRef = useRef('');

  const check = useCallback(async () => {
    if (!active || !reposts || checkingRef.current || shownRef.current) {return;}
    const route = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
    if (route && SKIP_ON.has(route)) {return;}
    checkingRef.current = true;
    try {
      const { text, askedToPaste } = await readCopiedText();
      if (answeredRef.current.has(text)) {return;}
      const link = spotifyLinkInClipboard(text);
      if (!link) {
        // "Don't Allow" reads as '' — they said no, so there is nothing to explain.
        if (askedToPaste && text.trim() !== '' && !(await hasOpenedPasteSettings())
          && AppState.currentState !== 'background') {
          setSorryVisible(true);
        }
        return;
      }
      const id = link.id ?? (await resolveSpotifyLinkCached(link.shortUrl));
      const found = id ? await getSpotifyTrack(id) : null;
      if (!found) {return;}
      // Left the app while the song was being looked up.
      if (AppState.currentState === 'background') {
        forgetCheckedCopy();
        return;
      }
      textRef.current = text;
      setTrack(found);
      setVisible(true);
    } catch {
      // Nothing to offer — never an error over a clipboard.
    } finally {
      checkingRef.current = false;
    }
  }, [active, reposts]);

  // On open (once the app is ready and the switch is known) and every return to the app.
  useEffect(() => {
    if (!active || !reposts) {return;}
    let timer = setTimeout(() => { void check(); }, READ_DELAY_MS);
    const sub = AppState.addEventListener('change', state => {
      // 'inactive' (iOS only) is not leaving: Livil is still on screen, behind iOS's own "Allow
      // Paste?" question — which this check sets off — or Control Center or the notification
      // shade. Treating it as gone closed nothing but made the check drop its answer: Allow
      // was tapped and no dialog followed (owner's iPhone, 2026-10-21).
      if (state === 'active') {
        clearTimeout(timer);
        timer = setTimeout(() => { void check(); }, READ_DELAY_MS);
      } else if (state === 'background') {
        clearTimeout(timer);
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
  }, [active, reposts, check]);

  const answer = useCallback((repost: boolean) => {
    const id = track?.id;
    answeredRef.current.add(textRef.current);
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
