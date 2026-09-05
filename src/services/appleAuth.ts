/**
 * Sign in with Apple.
 *
 * Not optional: App Store Review guideline 4.8 requires an equivalent
 * Apple-provided login wherever a third-party login is offered, and we offer
 * Google. Without this the app cannot ship on iOS at all.
 *
 * NATIVE flow, not the browser OAuth flow that `googleAuth.ts` uses. Apple's own
 * sheet returns a signed identity token directly, which Supabase verifies against
 * the bundle id listed in its Apple provider "Client IDs" field. That means:
 *   * no `.p8` client secret to configure, and none to rotate every 6 months
 *     (the secret is only needed for the web/redirect flow);
 *   * no round trip through the browser and back over `livil://auth`, so this
 *     path does not depend on the deep-link plumbing at all.
 *
 * We deliberately do NOT use the library's `AppleButton` component: it is a
 * legacy native view (`requireNativeComponent`), and this app runs the New
 * Architecture where legacy view managers only render through the Fabric interop
 * layer. Only the native MODULE is used here; the button is built from our own
 * `Button`/`Icon` components, which is both safer and what the design system
 * requires. Apple permits a custom button as long as it follows their styling.
 */
import { Platform } from 'react-native';
// Constants come off the `appleAuth` INSTANCE, not from named imports.
// `AppleRequestOperation` / `AppleRequestScope` exist only in the library's .d.ts
// as `export declare enum` -- type-only declarations with no runtime counterpart
// in lib/index.js, which exports just `appleAuth`, `appleAuthAndroid` and
// `AppleButton`. Importing them typechecks cleanly and is `undefined` at runtime,
// which fails as "cannot read property 'LOGIN' of undefined" the moment a user
// taps the button. tsc cannot catch this; only running it can.
import appleAuth from '@invertase/react-native-apple-authentication';
import { supabase } from '../../lib/supabase';

/**
 * Whether to render the Apple button at all.
 *
 * `appleAuth.isSupported` is false below iOS 13, and the whole native module is
 * absent on Android — so this must be checked before rendering, not just before
 * calling.
 */
export function isAppleSignInAvailable(): boolean {
  return Platform.OS === 'ios' && appleAuth.isSupported;
}

/**
 * Present Apple's sheet and exchange the result for a Supabase session.
 *
 * Throws on failure so the screen can surface a message. A user cancelling the
 * sheet also throws (code `1001`); `isAppleSignInCancellation` below exists so
 * the caller can stay silent for that case rather than showing an error for
 * something the user did on purpose.
 */
export async function signInWithApple(): Promise<void> {
  const response = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    // EMAIL is what Supabase keys the account on. FULL_NAME is requested purely
    // to seed a readable display name — see the one-shot note below.
    requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
  });

  const { identityToken, nonce, fullName } = response;
  if (!identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    // The library generates a nonce, sends Apple the SHA256 of it, and hands
    // back the RAW value here; Supabase hashes it again to compare against the
    // token's `nonce` claim. Passing the raw value is therefore correct, and
    // passing the hash would fail verification. Omitting it would work too, but
    // skips replay protection.
    nonce,
  });
  if (error) { throw error; }

  await seedDisplayName(data.user?.id, fullName);
}

/** True when the user dismissed Apple's sheet rather than something going wrong. */
export function isAppleSignInCancellation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === appleAuth.Error.CANCELED || code === '1001';
}

/**
 * Persist the name Apple gave us — the ONE time it gives it.
 *
 * Apple returns `fullName` only on the FIRST authorization of this app by this
 * Apple ID, and never again on subsequent sign-ins. It is also absent from the
 * identity token, so Supabase's `raw_user_meta_data` never carries it and
 * `handle_new_user()` falls through to `split_part(email, '@', 1)`. For a user
 * who chose "Hide My Email" that fallback is the relay mailbox id — a string
 * like `8kd93jf0q1` — which would become their display name forever.
 *
 * So: capture it here or lose it. If the user declined to share their name there
 * is nothing to capture, and they can still set one in Edit Profile.
 *
 * Fire-and-forget and never throws: a failure here must not fail a sign-in that
 * has already succeeded. The user is authenticated by this point.
 */
async function seedDisplayName(
  userId: string | undefined,
  fullName: { givenName?: string | null; familyName?: string | null } | null,
): Promise<void> {
  if (!userId || !fullName) { return; }

  const name = [fullName.givenName, fullName.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!name) { return; }

  try {
    // `username_set` is false until ChooseUsernameScreen runs, so this only ever
    // touches a freshly-created profile — it cannot clobber a display name an
    // existing user chose for themselves.
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name })
      .eq('id', userId)
      .eq('username_set', false);
    if (error) {
      console.log('[LIVIL][appleAuth] display_name seed failed:', error.message);
    }
  } catch (e) {
    console.log('[LIVIL][appleAuth] display_name seed threw:', (e as Error)?.message);
  }
}
