// Core's Clipboard is the fallback for an Android build made before
// @react-native-clipboard/clipboard was added (it logs a one-time "moved" warning in debug
// builds only). iOS never falls back to it — see readCopiedText.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Clipboard as CoreClipboard, Linking, NativeModules, Platform } from 'react-native';

type ClipboardModule = {
  getString: () => Promise<string>;
  setString: (text: string) => void;
  hasWebURL: () => Promise<boolean>;
};

/** ios/livil/LivilPasteboard.m — missing on an iPhone build made before it was added. */
type PasteboardCounter = { changeCount: () => Promise<number> };

/** The last iPhone copy (UIPasteboard.changeCount) the copied-link check has handled. */
export const CHECKED_COPY_KEY = 'livil.clipboard.checkedCopy.v1';
/** Set once the person has opened Livil's page in iPhone Settings from the "not Spotify" note. */
export const PASTE_SETTINGS_OPENED_KEY = 'livil.clipboard.pasteSettingsOpened.v1';
/** Privacy & data → "Detect copied Spotify links", per phone. '0' = off; anything else = on. */
export const DETECT_COPIED_LINKS_KEY = 'livil.clipboard.detectSpotifyLinks.v1';

/**
 * A read faster than this cannot have waited for a tap on iOS's "Allow Paste?" question, so
 * iOS did not ask: Livil's own copy (the share sheet's Copy), or the person already set Paste
 * from Other Apps to Allow. Nobody reads that question and taps in under 0.4 s.
 */
export const ASKED_MIN_MS = 400;

export type CopiedText = {
  text: string;
  /**
   * iOS (probably) showed "Livil would like to paste from …" for this read — the read waited
   * long enough for a tap. Always false on Android, which never asks.
   */
  askedToPaste: boolean;
};

const NOTHING: CopiedText = { text: '', askedToPaste: false };

let lib: ClipboardModule | null | undefined;
let checkedCopy: number | null | undefined;

/**
 * @react-native-clipboard/clipboard, or null on a build that predates it — its JS throws on
 * import when the native half is missing, and Metro serves new JS to an app installed before
 * the rebuild. Required lazily so that case falls back instead of crashing.
 */
function loadClipboard(): ClipboardModule | null {
  if (lib !== undefined) { return lib; }
  try {
    lib = require('@react-native-clipboard/clipboard').default as ClipboardModule;
  } catch {
    lib = null;
  }
  return lib;
}

async function loadCheckedCopy(): Promise<number | null> {
  if (checkedCopy !== undefined) { return checkedCopy; }
  const stored = await AsyncStorage.getItem(CHECKED_COPY_KEY).catch(() => null);
  checkedCopy = stored == null || stored === '' ? null : Number(stored);
  return checkedCopy;
}

function rememberCheckedCopy(count: number): void {
  checkedCopy = count;
  AsyncStorage.setItem(CHECKED_COPY_KEY, String(count)).catch(() => {});
}

/**
 * The next check looks at the current copy again — for a copied Spotify song the person left
 * the app without answering, which asks again on the next open (owner, 2026-10-19).
 */
export function forgetCheckedCopy(): void {
  checkedCopy = null;
  AsyncStorage.removeItem(CHECKED_COPY_KEY).catch(() => {});
}

/**
 * What the person copied, for the copied-Spotify-link check — or NOTHING, without reading it.
 *
 * iOS asks "Livil would like to paste from WhatsApp — Allow?" on every read of another app's
 * copy, whatever it is, so on an iPhone the clipboard is read only when ALL of these hold:
 *   - it is a NEW copy: LivilPasteboard's changeCount moved since the last check. Without
 *     this, a non-Spotify link left on the clipboard asked again on every open (owner,
 *     2026-10-20). The count is remembered BEFORE the read, so "Don't Allow" is an answer too.
 *   - it holds a web link: `hasWebURL` (UIPasteboard detectPatterns) looks without asking, so
 *     a copied door code or password never sets off the question (security review, 2026-10-19).
 * Neither look asks. A build missing either native module returns NOTHING — never core's full
 * read, which asked about EVERY copy on each open (owner, 2026-10-20).
 *
 * Android has no such question; it shows a small "pasted from your clipboard" notice instead,
 * which it does for every read.
 */
export async function readCopiedText(os: string = Platform.OS): Promise<CopiedText> {
  const mod = loadClipboard();
  if (os !== 'ios') {
    const text = ((await (mod ?? CoreClipboard).getString()) as string | null) ?? '';
    return { text, askedToPaste: false };
  }

  const counter = NativeModules.LivilPasteboard as PasteboardCounter | undefined;
  if (!mod || !counter) { return NOTHING; }
  const count = await counter.changeCount().catch(() => null);
  if (count == null || count === (await loadCheckedCopy())) { return NOTHING; }
  rememberCheckedCopy(count);

  const hasLink = await mod.hasWebURL().catch(() => false);
  if (!hasLink) { return NOTHING; }
  const started = Date.now();
  const text = ((await mod.getString()) as string | null) ?? '';
  return { text, askedToPaste: Date.now() - started >= ASKED_MIN_MS };
}

/** Empties the clipboard. */
export function clearCopiedText(): void {
  (loadClipboard() ?? CoreClipboard).setString('');
}

/**
 * The person's own switch for the copied-link check on this phone. On unless they turned it
 * off — an unreadable value counts as on, like every other default here. The server's kill
 * switch (SpotifyAvailability.copiedLinks) is checked separately and wins.
 */
export async function isCopiedLinkDetectionOn(): Promise<boolean> {
  return (await AsyncStorage.getItem(DETECT_COPIED_LINKS_KEY).catch(() => null)) !== '0';
}

/** Throws when it could not be saved, so Settings can put the toggle back. */
export async function setCopiedLinkDetection(on: boolean): Promise<void> {
  await AsyncStorage.setItem(DETECT_COPIED_LINKS_KEY, on ? '1' : '0');
}

/** Whether the person has already been sent to iPhone Settings → Paste from Other Apps. */
export async function hasOpenedPasteSettings(): Promise<boolean> {
  return (await AsyncStorage.getItem(PASTE_SETTINGS_OPENED_KEY).catch(() => null)) === '1';
}

/**
 * Opens Livil's page in iPhone Settings, where "Paste from Other Apps → Allow" stops iOS
 * asking. Livil cannot flip that switch or see it, so having opened the page is remembered
 * instead, and the "not a Spotify song" note stops appearing.
 */
export async function openPasteSettings(): Promise<void> {
  await AsyncStorage.setItem(PASTE_SETTINGS_OPENED_KEY, '1').catch(() => {});
  await Linking.openSettings().catch(() => {});
}
