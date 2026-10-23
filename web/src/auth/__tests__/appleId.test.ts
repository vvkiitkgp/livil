/**
 * The pure rules of web Sign in with Apple.
 *
 * Each of these fails silently in production rather than loudly in development — the flow
 * cannot run on localhost at all (Apple accepts only registered https return URLs) — so the
 * first person to notice a regression would be someone locked out of their account.
 */
import { createHash, webcrypto } from 'crypto';
import {
  APPLE_LOGO_CANVAS,
  APPLE_LOGO_PATH,
  APPLE_WEB_CLIENT_ID,
  appleClaimDisplayName,
  appleErrorKind,
  appleFullName,
  makeNonce,
  makeState,
} from '../appleId';

const cryptoApi = webcrypto as unknown as Crypto;

describe('makeNonce', () => {
  it('sends Apple the SHA-256 of the raw nonce, as lowercase hex', async () => {
    // GoTrue hashes the value it is given and compares it with the token's `nonce` claim;
    // Apple copies what it is given into that claim. Hashed to Apple, raw to Supabase.
    const { raw, hashed } = await makeNonce(cryptoApi);
    expect(hashed).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashed).not.toBe(raw);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is fresh every time', async () => {
    const a = await makeNonce(cryptoApi);
    const b = await makeNonce(cryptoApi);
    expect(a.raw).not.toBe(b.raw);
    expect(makeState(cryptoApi)).not.toBe(makeState(cryptoApi));
  });
});

describe('appleErrorKind', () => {
  it('treats closing or cancelling Apple’s window as the person’s choice, not a failure', () => {
    expect(appleErrorKind({ error: 'popup_closed_by_user' })).toBe('cancelled');
    expect(appleErrorKind({ error: 'user_cancelled_authorize' })).toBe('cancelled');
  });

  it('recognises a blocked popup so the screen can say how to fix it', () => {
    expect(appleErrorKind({ error: 'popup_blocked_by_browser' })).toBe('popup-blocked');
  });

  it('reports everything else', () => {
    expect(appleErrorKind(new Error('boom'))).toBe('other');
    expect(appleErrorKind(null)).toBe('other');
    expect(appleErrorKind({ error: 'invalid_client' })).toBe('other');
  });
});

describe('appleFullName', () => {
  it('joins the parts Apple shared', () => {
    expect(appleFullName({ name: { firstName: 'Riya', lastName: 'Sharma' } })).toBe('Riya Sharma');
    expect(appleFullName({ name: { firstName: ' Riya ', middleName: '', lastName: 'S' } })).toBe(
      'Riya S',
    );
  });

  it('is null when Apple sent no name (every sign-in after the first)', () => {
    expect(appleFullName(undefined)).toBeNull();
    expect(appleFullName({ email: 'x@privaterelay.appleid.com' })).toBeNull();
    expect(appleFullName({ name: { firstName: '  ' } })).toBeNull();
  });
});

describe('appleClaimDisplayName', () => {
  const relay = '8kd93jf0q1@privaterelay.appleid.com';

  it('never keeps the Hide My Email relay id as the display name', () => {
    expect(appleClaimDisplayName('8kd93jf0q1', relay, 'riya')).toBe('riya');
  });

  it('uses the username when there is no name at all', () => {
    expect(appleClaimDisplayName(null, relay, 'riya')).toBe('riya');
    expect(appleClaimDisplayName('  ', relay, 'riya')).toBe('riya');
  });

  it('keeps the name Apple shared (undefined = keep current)', () => {
    expect(appleClaimDisplayName('Riya Sharma', relay, 'riya')).toBeUndefined();
  });
});

describe('Apple artwork and identity', () => {
  it("draws Apple's own logo artwork, unmodified — the same file as the app's button", () => {
    // Same hash as src/components/__tests__/AppleSignInButton.test.tsx. If this fails,
    // someone edited, rounded or replaced the artwork: re-copy it from Apple's file
    // ("Logo - SIWA - Left-aligned - Black - Small.svg"); do not update the hash.
    expect(createHash('sha256').update(APPLE_LOGO_PATH).digest('hex')).toBe(
      'd1fc966b3f45b4b831ae22b089bc2a114b2c8b9e0b0b5957ed60838464ae943f',
    );
    expect(APPLE_LOGO_CANVAS).toEqual({ width: 24, height: 44 });
  });

  it('uses the Services ID registered for the website, never the iOS bundle id', () => {
    // `com.livil` is the iPhone app. A web token minted for it would come from the wrong
    // Apple configuration; the Services ID is what Supabase's Client IDs list adds for web.
    expect(APPLE_WEB_CLIENT_ID).toBe('com.livil.web');
  });
});
