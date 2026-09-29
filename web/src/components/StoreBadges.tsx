/**
 * "Download on the App Store" + "Get it on Google Play", as logo badges — the same pair
 * the marketing site (docs/index.html) shows. Both are always rendered; `storeOrder()`
 * only puts the visitor's own platform first.
 *
 * The logos are inline SVG rather than image files so they inherit nothing and need no
 * asset pipeline. Google Play keeps its brand colours; the Apple mark is `currentColor`.
 */
import { APP_STORE_URL, PLAY_STORE_URL, storeOrder } from '../auth/signIn';

function PlayLogo() {
  return (
    <svg viewBox="0 0 24 26" aria-hidden="true" focusable="false">
      <path fill="#00D2FF" d="M1.3.6a1.7 1.7 0 0 0-.6 1.3v22.2c0 .5.2 1 .6 1.3L13 13.5 1.3.6z" />
      <path fill="#FFCE00" d="M17.6 9.9 13 13.5l-4.6 3.6 4.6 4.6 6.1-3.5c1.3-.7 1.3-2.6 0-3.3l-1.5-.9z" />
      <path fill="#FF3A44" d="M1.3 25.4c.5.5 1.3.6 2 .2l14.3-8.2-4.6-4-11.7 12z" />
      <path fill="#00E676" d="M3.3.4a1.6 1.6 0 0 0-2 .2L13 13.5l4.6-3.6L3.3.4z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 384 512" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </svg>
  );
}

export function StoreBadges() {
  return (
    <div className="store-badges">
      {storeOrder().map((store) =>
        store === 'apple' ? (
          <a
            key="apple"
            className="store-badge"
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download Livil for iPhone on the App Store"
          >
            <AppleLogo />
            <span className="store-badge__text">
              <i>Download on the</i>
              <b>App Store</b>
            </span>
          </a>
        ) : (
          <a
            key="play"
            className="store-badge"
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download Livil for Android on Google Play"
          >
            <PlayLogo />
            <span className="store-badge__text">
              <i>Get it on</i>
              <b>Google Play</b>
            </span>
          </a>
        ),
      )}
    </div>
  );
}
