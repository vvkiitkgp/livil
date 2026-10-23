import { useEffect, useRef, useState } from 'react';
import { APPLE_LOGO_CANVAS, APPLE_LOGO_PATH } from '../auth/appleId';
import {
  prepareAppleSignIn,
  signInWithApple,
  type AppleSignInRequest,
} from '../auth/signIn';

/**
 * "Continue with Apple" — a custom Sign in with Apple button, built to Apple's rules for
 * custom buttons (HIG, "Creating a custom Sign in with Apple button"), the same way the
 * app's `src/components/AppleSignInButton.tsx` is. App Review rejected that one once, for an
 * icon-library Apple logo; the web is not reviewed, but the rules are Apple's either way.
 *
 *   * ARTWORK: Apple's own logo file (`APPLE_LOGO_PATH`, hash-pinned), the whole 24x44
 *     canvas drawn at the button's full height. No crop, no vertical padding, no gap before
 *     the title — the file's own padding is the spacing.
 *   * COLOURS: the WHITE style — black logo and title on pure white — which Apple specifies
 *     for dark backgrounds. A deliberate exception to the no-filled-buttons rule, like
 *     `destructive`: Apple sets the appearance.
 *   * TITLE: "Continue with Apple", in the font of the buttons beside it (allowed); at least
 *     8% of the width clear at the sides; never under 140x30.
 *
 * Not Apple's JS-rendered button: that one draws its own title in Apple's font at Apple's
 * size, which would sit beside "Continue with Google" in a different typeface.
 */
export function AppleSignInButton({
  onStart,
  onError,
}: {
  /** Called on click, so the screen can clear an old error. */
  onStart: () => void;
  /** Shown under the form. Never called when the person closes Apple's window. */
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // The prepared request (script + nonce). A ref, not state: it is consumed synchronously
  // in the click handler and must never trigger a render.
  const request = useRef<AppleSignInRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    prepareAppleSignIn()
      .then(r => {
        if (!cancelled) request.current = r;
      })
      // Blocked or offline: leave it null and let the click retry and report.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function onClick() {
    onStart();
    setBusy(true);

    // Single use — a nonce must never be sent twice.
    let prepared = request.current;
    request.current = null;
    if (!prepared) {
      // Not ready yet (slow network, or a blocker refused the script). Preparing now spends
      // the click's user activation, so Safari may block the popup; that comes back as
      // `popup-blocked` with its own message, and the second click has everything ready.
      try {
        prepared = await prepareAppleSignIn();
      } catch {
        setBusy(false);
        onError(
          "Couldn't reach Apple. Check your connection — or a content blocker — and try again.",
        );
        return;
      }
    }

    const result = await signInWithApple(prepared);
    if (result.ok) {
      // Reload rather than let the auth listener swap the screen in place: Apple's script
      // must not stay resident in the signed-in dashboard (see `loadAppleId`). The session
      // is already in storage, so the reload lands signed in.
      window.location.reload();
      return;
    }

    setBusy(false);
    if (result.message) onError(result.message);
    prepareAppleSignIn()
      .then(r => {
        request.current = r;
      })
      .catch(() => undefined);
  }

  return (
    <button
      type="button"
      className="apple-btn"
      onClick={onClick}
      disabled={busy}
      data-busy={busy || undefined}
      aria-label="Continue with Apple"
    >
      <svg
        className="apple-btn__logo"
        viewBox={`0 0 ${APPLE_LOGO_CANVAS.width} ${APPLE_LOGO_CANVAS.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <path d={APPLE_LOGO_PATH} fill="#000000" fillRule="nonzero" />
      </svg>
      <span className="apple-btn__title">Continue with Apple</span>
    </button>
  );
}
