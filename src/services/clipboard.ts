// Core's Clipboard is the fallback for a build made before @react-native-clipboard/clipboard
// was added (it logs a one-time "moved" warning in debug builds only).
import { Clipboard as CoreClipboard, Platform } from 'react-native';

type ClipboardModule = {
  getString: () => Promise<string>;
  setString: (text: string) => void;
  hasWebURL: () => Promise<boolean>;
};

let lib: ClipboardModule | null | undefined;

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

/**
 * What the person copied — or '' on an iPhone when it holds no web link, WITHOUT reading it.
 *
 * iOS asks "Livil would like to paste from WhatsApp — Allow?" on every read of another app's
 * copy, whatever it is. `hasWebURL` (UIPasteboard detectPatterns) looks without asking, so a
 * copied door code or password never sets off that question — only a copied link does
 * (security review, 2026-10-19). Android has no such check; it shows a small "pasted from your
 * clipboard" notice instead, which it does for every read.
 *
 * An iPhone build without the library has no way to look first, so it returns '' — never
 * core's full read, which asked about EVERY copy on each open (owner, 2026-10-20).
 */
export async function readCopiedText(os: string = Platform.OS): Promise<string> {
  const mod = loadClipboard();
  if (os === 'ios') {
    if (!mod) { return ''; }
    const hasLink = await mod.hasWebURL().catch(() => false);
    if (!hasLink) { return ''; }
  }
  return ((await (mod ?? CoreClipboard).getString()) as string | null) ?? '';
}

/** Empties the clipboard. */
export function clearCopiedText(): void {
  (loadClipboard() ?? CoreClipboard).setString('');
}
